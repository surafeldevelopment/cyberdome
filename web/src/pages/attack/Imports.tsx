import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Cpu, PackageOpen, FileText, FileJson, Network as NetIcon } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { download, fmtBytes, fmtDateTime, humanize } from '../../lib/format';
import { Panel, EmptyState, ErrorState, Loading, Field, Select, Notice, KV, Badge } from '../../components/ui';
import { DataTable } from '../../components/DataTable';
import { Drawer, ConfirmDialog, useToast } from '../../components/overlay';
import { FileDrop } from '../../components/evidence';
import { IssueList } from '../Recon';
import { ImportStatusBadge, ImportStatusPill, KebabButton, TsStatusBadge, hp, timezoneOptions, useEngagementDetail, type LogImport } from './shared';
import { AssetCell } from '../../components/kit';

const FORMATS = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'csv', label: 'Generic CSV (template)' },
  { value: 'jsonl', label: 'JSON Lines' },
  { value: 'json', label: 'JSON array' },
  { value: 'wireshark_csv', label: 'Wireshark CSV export' },
  { value: 'tshark_fields', label: 'tshark -T fields CSV' },
  { value: 'tshark_json', label: 'tshark -T json' },
  { value: 'tshark_ek', label: 'tshark -T ek' },
];
const FORMAT_LABEL: Record<string, string> = Object.fromEntries([...FORMATS.map((f) => [f.value, f.label]), ['tshark_processed', 'Processed by tshark (local)']]);

export function ImportsTab({ onViewEvents }: { onViewEvents: (importId: string) => void }) {
  const { base, eid, isDemo } = useEngagement();
  const eng = useEngagementDetail();
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('auto');
  const [tz, setTz] = useState('');
  const [sourceCategory, setSourceCategory] = useState('instructor_supplied');
  const [preview, setPreview] = useState<any>(null);
  const [dupOf, setDupOf] = useState<string | null>(null);
  const [open, setOpen] = useState<LogImport | null>(null);
  const zone = tz || eng.data?.timezone || 'UTC';
  const history = useQuery({ queryKey: ['log-imports', eid], queryFn: () => api.get<LogImport[]>(`${base}/log-imports`), enabled: !!eid });

  const form = (allowDup = false) => {
    const fd = new FormData();
    fd.append('file', file!);
    fd.append('format', format);
    fd.append('source_timezone', zone);
    fd.append('source_category', isDemo ? 'demo' : sourceCategory);
    if (allowDup) fd.append('allow_duplicate', 'true');
    return fd;
  };
  const reset = () => { setFile(null); setPreview(null); setDupOf(null); };
  const doPreview = useMutation({ mutationFn: () => api.upload(`${base}/log-imports/preview`, form()), onSuccess: setPreview, onError: (e) => toast.error(errorMessage(e)) });
  const doImport = useMutation({
    mutationFn: (allowDup: boolean) => api.upload<LogImport>(`${base}/log-imports`, form(allowDup)),
    onSuccess: (r) => {
      ['log-imports', 'log-events', 'evidence', 'tracker', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k, eid] }));
      toast.success(`${r.code}: imported ${r.rows_imported} of ${r.rows_total} record(s) (${r.status}); file stored as ${r.evidence_code}`);
      reset();
      setOpen(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setDupOf((e.details as any)?.duplicate_of ?? 'an earlier import');
      else toast.error(errorMessage(e));
    },
  });

  return (
    <div className="stack">
      <div className="grid cols-2">
        <Panel title="Import logs or packet export" actions={<button className="btn ghost sm" onClick={() => download(`${base}/logs-template.csv`)}><FileDown /> Template</button>}>
          <div className="stack">
            <FileDrop file={file} onFile={(f) => { setFile(f); setPreview(null); setDupOf(null); }} label="Drop a log file or Wireshark/tshark export" hint="CSV, JSON Lines, JSON, Wireshark CSV, tshark fields/JSON/EK" accept=".csv,.json,.jsonl,.ndjson,.log,.txt" />
            <div className="form-grid">
              <Field label="Format" htmlFor="li-fmt"><Select id="li-fmt" value={format} onChange={(v) => { setFormat(v); setPreview(null); }} options={FORMATS} /></Field>
              <Field label="Source timezone" htmlFor="li-tz" help="Used only for timestamps without an offset"><Select id="li-tz" value={zone} onChange={(v) => { setTz(v); setPreview(null); }} options={timezoneOptions(zone)} /></Field>
              {!isDemo && (
                <Field label="Source category" htmlFor="li-sc"><Select id="li-sc" value={sourceCategory} onChange={setSourceCategory} options={[{ value: 'instructor_supplied', label: 'Instructor-supplied' }, { value: 'authorized_lab', label: 'Authorized lab evidence' }]} /></Field>
              )}
            </div>
            <div className="row">
              <button className="btn" disabled={!file || doPreview.isPending} onClick={() => doPreview.mutate()}>{doPreview.isPending && <span className="spinner" />} Preview</button>
              <button className="btn primary" disabled={!file || !preview?.row_count || doImport.isPending} onClick={() => doImport.mutate(false)}>{doImport.isPending && <span className="spinner" />} Import {preview?.row_count ? `${preview.row_count} record${preview.row_count === 1 ? '' : 's'}` : ''}</button>
              {file && <button className="btn ghost" onClick={reset}>Clear</button>}
            </div>
            {preview?.duplicate_of && <Notice tone="warn">This exact file was already imported as <strong>{preview.duplicate_of.code}</strong> (evidence {preview.duplicate_of.evidence_code}). Importing it again would duplicate events.</Notice>}
          </div>
        </Panel>
        <PcapPanel />
      </div>

      {preview && (
        <Panel title="Preview" hint="Nothing has been saved yet">
          <div className="stack tight">
            <Notice tone={preview.errors.length || preview.truncated ? 'warn' : 'ok'}>
              Detected <strong>{FORMAT_LABEL[preview.format] ?? preview.format}</strong>: {preview.total} record(s), <strong>{preview.row_count} usable</strong>
              {preview.skipped ? `, ${preview.skipped} skipped` : ''}. Times: {Object.entries(preview.ts_summary).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${n} ${humanize(k).toLowerCase()}`).join(', ') || 'none'}.
            </Notice>
            <p className="small muted"><strong>What will be analyzed:</strong> {preview.analysis_scope}</p>
            <IssueList errors={preview.errors} warnings={preview.warnings} />
            {preview.rows.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table className="data">
                  <caption className="sr-only">Log import preview</caption>
                  <thead><tr><th>Row</th><th>Original time</th><th>Normalized (UTC)</th><th>Status</th><th>Source → destination</th><th>Proto</th><th>Event</th><th>Message</th></tr></thead>
                  <tbody>
                    {preview.rows.map((r: any) => (
                      <tr key={r.row_number}>
                        <td className="mono">{r.row_number}</td>
                        <td className="mono small nowrap">{r.original_timestamp ?? '∅'}</td>
                        <td className="mono small nowrap">{r.normalized_ts ?? '—'}</td>
                        <td><TsStatusBadge status={r.ts_status} /></td>
                        <td className="mono small nowrap">{hp(r.source, r.src_port)} → {hp(r.destination, r.dst_port)}</td>
                        <td className="mono small">{r.protocol ?? '—'}</td>
                        <td className="small">{r.event_type ?? '—'}</td>
                        <td className="small clip" style={{ maxWidth: '40ch' }}>{r.message ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.row_count > preview.rows.length && <div className="table-foot">Showing the first {preview.rows.length} of {preview.row_count} usable rows.</div>}
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Import History" flush className="imp-panel">
        {history.isError ? (
          <div style={{ padding: 16 }}><ErrorState error={history.error} retry={() => history.refetch()} /></div>
        ) : history.isLoading ? (
          <div style={{ padding: 16 }}><Loading /></div>
        ) : (
          <DataTable
            caption="Log import history"
            rows={history.data ?? []}
            rowKey={(r) => r.id}
            onRowClick={setOpen}
            initialSort={{ key: 'created_at', dir: 'desc' }}
            columns={[
              { key: 'code', header: 'Import', sortValue: (r) => Number(r.code.replace(/\D/g, '')), render: (r) => (
                <AssetCell
                  icon={/json|ek/.test(r.format) ? <FileJson /> : /tshark|wireshark/.test(r.format) ? <NetIcon /> : <FileText />}
                  title={<span className="mono">{r.original_filename ?? r.code}</span>}
                  sub={`${r.code} · ${FORMAT_LABEL[r.format] ?? r.format}`}
                />
              ) },
              { key: 'status', header: 'Status', render: (r) => <ImportStatusPill status={r.status} /> },
              { key: 'rows_imported', header: 'Rows', className: 'num', render: (r) => <span className="nowrap">{r.rows_imported} / {r.rows_total}</span> },
              { key: 'source_timezone', header: 'Source TZ', render: (r) => <span className="small nowrap">{r.source_timezone ?? '—'}</span> },
              { key: 'evidence_code', header: 'Evidence', render: (r) => (r.evidence_id ? <Link className="ev-chip" to={`/evidence/${r.evidence_id}`}>{r.evidence_code}</Link> : '—') },
              { key: 'created_at', header: 'Imported', render: (r) => <span className="small nowrap">{fmtDateTime(r.created_at)}</span> },
              { key: 'action', header: 'Action', sortable: false, className: 'act', render: (r) => <KebabButton label={`Open ${r.code}`} onClick={() => setOpen(r)} /> },
            ]}
            empty={<EmptyState icon={<PackageOpen />} title="No imports yet">Imported log files and packet exports are listed here with their status, warnings and the evidence record that preserves the original file.</EmptyState>}
          />
        )}
      </Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${open.code} · ${FORMAT_LABEL[open.format] ?? open.format}` : ''} subtitle={open && <ImportStatusBadge status={open.status} />}
        footer={open && <button className="btn primary" onClick={() => { onViewEvents(open.id); setOpen(null); }}>View these events</button>}>
        {open && <ImportDetail id={open.id} />}
      </Drawer>

      <ConfirmDialog open={!!dupOf} onClose={() => setDupOf(null)} onConfirm={() => { setDupOf(null); doImport.mutate(true); }} danger={false} title="File already imported" confirmLabel="Import again anyway">
        <p>This exact file (same SHA-256) was already imported as <strong>{dupOf}</strong>. Importing again creates a second copy of every event. Only continue if that is intentional.</p>
      </ConfirmDialog>
    </div>
  );
}

function ImportDetail({ id }: { id: string }) {
  const { base, eid } = useEngagement();
  const q = useQuery({ queryKey: ['log-imports', eid, id], queryFn: () => api.get<LogImport & { sha256?: string }>(`${base}/log-imports/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data!;
  return (
    <div className="stack">
      <KV items={[
        ['Evidence', d.evidence_id ? <Link className="ev-chip" to={`/evidence/${d.evidence_id}`}>{d.evidence_code}</Link> : '—'],
        ['Original file SHA-256', <span className="mono tiny">{(d as any).sha256 ?? '—'}</span>],
        ['Rows', `${d.rows_imported} imported of ${d.rows_total} (${d.rows_skipped} skipped)`],
        ['Source timezone', d.source_timezone ?? '—'],
        ['Event time range', d.first_event ? `${fmtDateTime(d.first_event)} → ${fmtDateTime(d.last_event)}` : 'No placeable times'],
        ['Imported', fmtDateTime(d.created_at)],
      ]} />
      <div className="row" style={{ gap: 6 }}>
        {Object.entries(d.ts_summary ?? {}).map(([k, n]) => <span key={k} className="row" style={{ gap: 4 }}><TsStatusBadge status={k} /><span className="small">{n}</span></span>)}
      </div>
      <Notice tone="info" title="Analysis scope.">{d.analysis_scope}</Notice>
      <IssueList errors={d.errors} warnings={d.warnings} />
    </div>
  );
}

function PcapPanel() {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<any>(null);
  const q = useQuery({ queryKey: ['pcap-evidence', eid], queryFn: () => api.get<any>(`${base}/pcap-evidence`), enabled: !!eid });
  const run = useMutation({
    mutationFn: (id: string) => api.post(`${base}/evidence/${id}/tshark-process`, {}),
    onSuccess: (r: any) => {
      ['pcap-evidence', 'log-imports', 'log-events', 'evidence', 'tracker'].forEach((k) => qc.invalidateQueries({ queryKey: [k, eid] }));
      toast.success(`${r.code}: tshark extracted ${r.rows_imported} packet summaries into ${r.derived_evidence.code}`);
      setConfirm(null);
    },
    onError: (e) => { toast.error(errorMessage(e)); setConfirm(null); },
  });
  const d = q.data;
  return (
    <Panel title="Packet captures (PCAP)" hint={d ? (d.tshark.available ? 'tshark available' : 'tshark not available') : undefined}>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> : (
        <div className="stack tight">
          {d.tshark.available ? (
            <Notice tone="ok" title="tshark detected.">{String(d.tshark.version).replace(/\.$/, '')}. Processing runs locally with fixed arguments (no shell), limited to {d.limits.max_packets.toLocaleString()} packets, {d.limits.max_file_mb} MB and {d.limits.timeout_s} s, and extracts packet summary fields only. Payloads are not analyzed.</Notice>
          ) : (
            <Notice tone="warn" title="tshark is not installed.">Stored captures are kept unchanged and only their file headers (packet count, time range) are read. No packet analysis is performed. Install Wireshark/tshark or import a tshark export instead.</Notice>
          )}
          {!d.captures.length ? (
            <EmptyState icon={<Cpu />} title="No PCAP evidence stored" actions={<Link className="btn" to="/evidence?upload=1">Upload a capture to the Evidence Locker</Link>}>
              Upload the instructor-provided .pcap/.pcapng (or record it by reference) in the Evidence Locker. It will be listed here.
            </EmptyState>
          ) : (
            <ul className="list-plain">
              {d.captures.map((c: any) => (
                <li key={c.id} className="pcap-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <Link className="ev-chip" to={`/evidence/${c.id}`}>{c.code}</Link>
                      <span className="clip" style={{ maxWidth: '28ch' }}>{c.title}</span>
                      {c.kind === 'reference' ? <Badge tone="muted">Reference only</Badge> : <span className="tiny faint">{fmtBytes(c.size_bytes)}</span>}
                    </div>
                    <div className="tiny muted" style={{ marginTop: 4 }}>
                      <strong>{c.analysis_status === 'tshark_processed' ? 'Packet summaries extracted by tshark' : c.analysis_status === 'metadata_read' ? 'Stored; file headers read only (no packet analysis)' : c.kind === 'reference' ? 'Not stored here; no analysis performed' : 'Stored only; no packet analysis performed'}.</strong>{' '}
                      {c.analysis_note}
                    </div>
                    {c.processed_imports.length > 0 && <div className="tiny" style={{ marginTop: 4 }}>Imports: {c.processed_imports.map((i: any) => i.code).join(', ')}</div>}
                  </div>
                  {c.kind === 'file' && d.tshark.available && c.status === 'active' && (
                    <button className="btn sm" onClick={() => setConfirm(c)} disabled={run.isPending}><Cpu /> {c.processed_imports.length ? 'Process again' : 'Process with tshark'}</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => run.mutate(confirm.id)} busy={run.isPending} danger={false} title={`Process ${confirm?.code} with tshark?`} confirmLabel="Run tshark locally">
        <p>tshark will read the stored capture on this computer and extract frame time, IP addresses, TCP/UDP ports, protocol and the Info column for up to {d?.limits.max_packets.toLocaleString()} packets. The output is saved as a new, separately hashed evidence item linked to {confirm?.code}, and imported as log events. The original capture is not modified.</p>
        {confirm?.processed_imports.length > 0 && <Notice tone="warn">This capture was already processed; running again creates a second set of events.</Notice>}
      </ConfirmDialog>
    </Panel>
  );
}
