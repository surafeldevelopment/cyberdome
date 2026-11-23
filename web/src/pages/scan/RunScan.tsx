import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Radar, X, ShieldCheck, ShieldAlert, Terminal } from 'lucide-react';
import { Panel, Notice, Field, Badge, EmptyState, Loading, ErrorState, Mono } from '../../components/ui';
import { DataTable, type Column } from '../../components/DataTable';
import { AssetCell } from '../../components/kit';
import { EvidenceChips } from '../../components/evidence';
import { Modal, useToast } from '../../components/overlay';
import { api, errorMessage, PREVIEW } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import '../../styles/run.css';

export interface ScanRun {
  id: string;
  code: string;
  profile: string;
  target_input: string;
  addresses: { ip: string; hostname: string | null; matched: string }[];
  excluded: { ip: string; matched: string }[];
  args: string[];
  nmap_version: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  progress: number | null;
  progress_note: string | null;
  warnings: string[];
  error: string | null;
  scan_import_id: string | null;
  scan_import_code: string | null;
  evidence_id: string | null;
  evidence_code: string | null;
  requested_by: string;
  started_at: string;
  finished_at: string | null;
}

interface Capability {
  nmap: { available: boolean; version: string | null };
  platform: string;
  is_demo: boolean;
  window: { start: string | null; end: string | null };
  targets: { id: string; target: string; target_type: string }[];
  exclusions: { id: string; target: string }[];
  profiles: { key: string; label: string; description: string; args: string[] }[];
  limits: { max_hosts: number; timeout_minutes: number };
  running: { id: string; code: string } | null;
}

interface Plan {
  ok: boolean;
  addresses: { ip: string; hostname: string | null; matched: string }[];
  excluded: { ip: string; matched: string }[];
  refused: { ip: string; reason: string }[];
  blockers: string[];
  warnings: string[];
  command: string;
}

export function useScanRuns() {
  const { base, eid } = useEngagement();
  return useQuery({
    queryKey: ['scan-runs', eid],
    queryFn: () => api.get<ScanRun[]>(`${base}/scan-runs`),
    refetchInterval: (q) => ((q.state.data as ScanRun[] | undefined)?.some((r) => r.status === 'running') ? 2000 : 30_000),
  });
}

const PROFILE_LABEL: Record<string, string> = { discovery: 'Host discovery', quick: 'Quick service scan', standard: 'Standard service scan' };

export function RunStatus({ run }: { run: ScanRun }) {
  if (run.status === 'running')
    return (
      <span className="run-progress" title={run.progress_note ?? ''}>
        <span className="run-bar"><span style={{ width: `${Math.max(3, Math.min(100, run.progress ?? 0))}%` }} /></span>
        <span className="tiny faint">{run.progress ? `${Math.round(run.progress)}%` : 'Starting'}</span>
      </span>
    );
  const tone = run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'bad' : 'warn';
  const label = { completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }[run.status];
  return <Badge tone={tone}>{label}</Badge>;
}

/* ------------------------------------------------------------------ Runs tab */
export function RunsTab({ onRun }: { onRun: () => void }) {
  const { base } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useScanRuns();
  const cancel = async (r: ScanRun) => {
    try {
      await api.post(`${base}/scan-runs/${r.id}/cancel`);
      qc.invalidateQueries({ queryKey: ['scan-runs'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const cols: Column<ScanRun>[] = [
    { key: 'code', header: 'Run', render: (r) => <AssetCell icon={<Radar />} title={<span className="mono">{r.code}</span>} sub={PROFILE_LABEL[r.profile] ?? r.profile} />, sortValue: (r) => Number(r.code.replace(/\D/g, '')) },
    { key: 'target_input', header: 'Target', render: (r) => <span className="mono nowrap" title={r.addresses.map((a) => a.ip).join(', ')}>{r.target_input}<span className="faint"> · {r.addresses.length} host{r.addresses.length === 1 ? '' : 's'}</span></span> },
    { key: 'started_at', header: 'Started', render: (r) => <span className="nowrap" title={fmtDateTime(r.started_at)}>{fmtRelative(r.started_at)}</span> },
    { key: 'status', header: 'Status', render: (r) => <RunStatus run={r} /> },
    {
      key: 'result', header: 'Result', sortable: false,
      render: (r) =>
        r.scan_import_id ? (
          <span className="nowrap"><Link className="mono" to={`/scan/imports/${r.scan_import_id}`} onClick={(e) => e.stopPropagation()}>{r.scan_import_code}</Link></span>
        ) : r.error ? <span className="small faint" title={r.error}>{r.error.length > 70 ? r.error.slice(0, 70) + '…' : r.error}</span> : <span className="faint">—</span>,
    },
    { key: 'evidence_code', header: 'Evidence', render: (r) => (r.evidence_id ? <EvidenceChips items={[{ id: r.evidence_id, code: r.evidence_code ?? '', status: 'active' }]} /> : <span className="faint">—</span>) },
    { key: 'act', header: '', sortable: false, className: 'act', render: (r) => (r.status === 'running' ? <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); cancel(r); }}><X /> Cancel</button> : null) },
  ];
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <Panel
      title="Scans run from CyberDome"
      hint="Nmap output is stored as evidence and imported automatically"
      actions={<button className="btn primary sm" onClick={onRun} disabled={PREVIEW}><Play /> Run scan</button>}
      flush
    >
      <DataTable
        caption="Scan runs"
        rows={q.data ?? []}
        columns={cols}
        rowKey={(r) => r.id}
        initialSort={{ key: 'started_at', dir: 'desc' }}
        empty={
          <EmptyState icon={<Radar />} title="No scans run yet" actions={<button className="btn primary" onClick={onRun} disabled={PREVIEW}><Play /> Run scan</button>}>
            Run Nmap against an in-scope target. The XML output is hashed, stored in the Evidence Locker and imported, so assets and services come from your real scan.
          </EmptyState>
        }
      />
    </Panel>
  );
}

/* ------------------------------------------------------------------ Run dialog */
export function RunScanModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const cap = useQuery({ queryKey: ['scan-capability', eid], queryFn: () => api.get<Capability>(`${base}/scan-runs/capability?refresh=1`), enabled: open });
  const [target, setTarget] = useState('');
  const [profile, setProfile] = useState('quick');
  const [skip, setSkip] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planErr, setPlanErr] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmedTargets = cap.data?.targets ?? [];
  useEffect(() => {
    if (open && !target && confirmedTargets[0]) setTarget(confirmedTargets[0].target);
  }, [open, cap.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) { setPlan(null); setPlanErr(''); }
  }, [open]);

  useEffect(() => {
    if (!open || !target.trim()) { setPlan(null); return; }
    const t = setTimeout(async () => {
      try {
        setPlanErr('');
        setPlan(await api.post<Plan>(`${base}/scan-runs/plan`, { target: target.trim(), profile, skip_discovery: skip }));
      } catch (e) {
        setPlan(null);
        setPlanErr(errorMessage(e));
      }
    }, 350);
    return () => clearTimeout(t);
  }, [open, target, profile, skip, base]);

  const start = async () => {
    setBusy(true);
    try {
      const run = await api.post<ScanRun>(`${base}/scan-runs`, { target: target.trim(), profile, skip_discovery: skip, confirm: true });
      toast.success(`${run.code} started against ${run.addresses.length} host(s)`);
      qc.invalidateQueries({ queryKey: ['scan-runs'] });
      onStarted();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const c = cap.data;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Run an Nmap scan"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={start} disabled={busy || !plan?.ok}><Play /> Start scan</button>
        </>
      }
    >
      {cap.isLoading && <Loading />}
      {cap.error && <ErrorState error={cap.error} retry={cap.refetch} />}
      {c && (
        <div className="stack tight run-scan">
          <div className="run-checks">
            <Check ok={c.nmap.available} label={c.nmap.available ? c.nmap.version ?? 'Nmap found' : 'Nmap not found on this computer'} />
            <Check ok={confirmedTargets.length > 0} label={`${confirmedTargets.length} target${confirmedTargets.length === 1 ? '' : 's'} in scope`} to="/engagement?tab=scope" />
          </div>
          {!c.nmap.available && (
            <Notice tone="warn" title="Install Nmap to run scans">
              Download the installer from nmap.org/download (on Windows keep the Npcap option ticked), then restart CyberDome. You can still import scan files you ran yourself.
            </Notice>
          )}
          <Field label="Target" htmlFor="run-target" help="One address, CIDR block, range, or hostname. It must be on the Engagement scope list; exclusions are always skipped.">
            <input id="run-target" className="mono-input" list="run-targets" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Choose or type a target" autoComplete="off" />
            <datalist id="run-targets">{confirmedTargets.map((t) => <option key={t.id} value={t.target} />)}</datalist>
          </Field>
          <div className="run-profiles" role="radiogroup" aria-label="Scan profile">
            {c.profiles.map((p) => (
              <label key={p.key} className={`run-profile ${profile === p.key ? 'on' : ''}`}>
                <input type="radio" name="profile" value={p.key} checked={profile === p.key} onChange={() => setProfile(p.key)} />
                <strong>{p.label}</strong>
                <span className="small faint">{p.description}</span>
              </label>
            ))}
          </div>
          {profile !== 'discovery' && (
            <label className="check-row">
              <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              <span>Treat hosts as up (<code>-Pn</code>). Use when the target blocks ping, which is common for Windows hosts.</span>
            </label>
          )}
          {planErr && <Notice tone="bad">{planErr}</Notice>}
          {plan && (
            <>
              <div className="run-command"><Terminal /><Mono>{plan.command}</Mono></div>
              {plan.blockers.length > 0 && (
                <Notice tone="bad" title="This scan cannot run yet">
                  <ul className="tight-list">{plan.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                  {plan.refused.length > 0 && (
                    <div className="small" style={{ marginTop: 6 }}>
                      {plan.refused.slice(0, 5).map((r) => <div key={r.ip}><Mono>{r.ip}</Mono>: {r.reason}</div>)}
                      {plan.refused.length > 5 && <div className="faint">and {plan.refused.length - 5} more</div>}
                    </div>
                  )}
                </Notice>
              )}
              {plan.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
              {plan.ok && (
                <>
                  <div className="small">
                    <strong>{plan.addresses.length}</strong> in-scope host{plan.addresses.length === 1 ? '' : 's'} will be scanned
                    {plan.excluded.length > 0 && <>, <strong>{plan.excluded.length}</strong> excluded address{plan.excluded.length === 1 ? '' : 'es'} skipped</>}.
                    Time limit {c.limits.timeout_minutes} minutes.
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function Check({ ok, label, to, warnOnly }: { ok: boolean; label: string; to?: string; warnOnly?: boolean }) {
  const icon = ok ? <ShieldCheck /> : <ShieldAlert />;
  const cls = ok ? 'ok' : warnOnly ? 'warn' : 'bad';
  const inner = <>{icon}<span>{label}</span></>;
  return to && !ok ? <Link className={`run-check ${cls}`} to={to}>{inner}</Link> : <span className={`run-check ${cls}`}>{inner}</span>;
}
