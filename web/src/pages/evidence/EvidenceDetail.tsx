import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, Copy, Download, FileSearch, GitBranch, Link2, Pencil, RotateCcw, ShieldCheck, ShieldAlert, Trash2, WrapText, Waypoints, Monitor, HardDrive, Bot, ShieldX } from 'lucide-react';
import { KpiCard, KpiRow, StatusPill } from '../../components/kit';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { download, fmtBytes, fmtDateTime, fromLocalInput, humanize, toLocalInput } from '../../lib/format';
import {
  Badge, ConfidenceBadge, EmptyState, ErrorState, Field, KV, Loading, Notice, PageHeader, Panel, Provenance, SanitizationBadge, Select, SourceBadge,
  SeverityBadge, ValidationBadge,
} from '../../components/ui';
import { ConfirmDialog, Drawer, Modal, useToast } from '../../components/overlay';
import { FileDrop } from '../../components/evidence';
import { CaptureButton } from '../../components/CaptureButton';
import { HASH_CAVEAT, MetadataFields, type MetaState } from './shared';
import '../../styles/evidence.css';

const REVIEW_LABEL: Record<string, string> = {
  imported: 'Imported',
  reference_recorded: 'Reference recorded',
  metadata_edited: 'Metadata edited',
  reviewed: 'Reviewed',
  verified_against_source: 'Verified against source',
  needs_follow_up: 'Needs follow-up',
  note: 'Note',
  withdrawn: 'Withdrawn',
  restored: 'Restored',
  sanitized_derivative_created: 'Sanitized derivative created',
  hash_verified: 'Hash re-verified (match)',
  hash_mismatch: 'Hash MISMATCH',
  hash_check_failed: 'Hash check failed',
};
const reviewLabel = (a: string) => (a.startsWith('sanitization:') ? `Sanitization set to “${humanize(a.split(':')[1])}”` : REVIEW_LABEL[a] ?? humanize(a));

export default function EvidenceDetail() {
  const { id = '' } = useParams();
  const { base, eid, isDemo } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const key = ['evidence', 'detail', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<any>(`${base}/evidence/${id}`), enabled: !!eid, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  const [editOpen, setEditOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [derivOpen, setDerivOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [hashResult, setHashResult] = useState<any>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['evidence'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const withdraw = useMutation({
    mutationFn: () => api.post(`${base}/evidence/${q.data.id}/withdraw`, { reason, confirm: true }),
    onSuccess: () => { toast.success(`${q.data.code} withdrawn. The ID stays retired.`); setWithdrawOpen(false); setReason(''); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: () => api.post(`${base}/evidence/${q.data.id}/restore`),
    onSuccess: () => { toast.success(`${q.data.code} restored.`); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sani = useMutation({
    mutationFn: (status: string) => api.patch(`${base}/evidence/${q.data.id}`, { sanitization_status: status }),
    onSuccess: (_d, status) => {
      toast.success(status === 'no_sensitive_data' ? `${q.data.code} marked: no sensitive data.` : `${q.data.code} marked: contains sensitive data.`);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['ai-eligibility'] });
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const verify = useMutation({
    mutationFn: () => api.post(`${base}/evidence/${q.data.id}/verify-hash`),
    onSuccess: (r) => { setHashResult(r); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading rows={6} />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <EmptyState icon={<FileSearch />} title="Evidence not found" actions={<Link className="btn" to="/evidence">Back to Evidence Locker</Link>}>
          No evidence with ID “{id}” exists in this engagement. It may belong to a different engagement. Check the engagement selector.
        </EmptyState>
      );
    return <ErrorState error={q.error} retry={() => q.refetch()} />;
  }
  const e = q.data;
  const isFile = e.kind === 'file';
  const withdrawn = e.status === 'withdrawn';

  return (
    <div className="ev-detail">
      <PageHeader
        crumbs={[{ label: 'Evidence Locker', to: '/evidence' }, { label: e.code }]}
        title={
          <span className="ev-title">
            <span className="mono ev-code">{e.code}</span>
            <span>{e.title}</span>
          </span>
        }
        subtitle={
          <span className="row" style={{ gap: 6 }}>
            <SourceBadge value={e.source_category} />
            <SanitizationBadge value={e.sanitization_status} />
            <ConfidenceBadge value={e.confidence} />
            {withdrawn ? <StatusPill tone="muted">Withdrawn</StatusPill> : <StatusPill tone="ok">Active</StatusPill>}
            {e.derived_from && <Badge tone="accent" icon={<GitBranch />}>Sanitized derivative</Badge>}
          </span>
        }
        actions={
          <>
            <CaptureButton title={`Evidence ${e.code}`} label="Capture view" />
            {isFile && (
              <button className="btn" onClick={() => download(`${base}/evidence/${e.id}/raw`)}>
                <Download /> Download original
              </button>
            )}
            <button className="btn" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit metadata
            </button>
            {withdrawn ? (
              <button className="btn" onClick={() => restore.mutate()} disabled={restore.isPending}>
                <RotateCcw /> Restore
              </button>
            ) : (
              <button className="btn danger" onClick={() => setWithdrawOpen(true)}>
                <Trash2 /> Withdraw
              </button>
            )}
          </>
        }
      />

      {!withdrawn && e.sanitization_status === 'not_reviewed' && (
        <div className="rq rq-inline" role="region" aria-label="Sanitization decision">
          <div className="rq-head" style={{ cursor: 'default' }}>
            <ShieldAlert aria-hidden />
            <span className="rq-title">
              <strong>Decide whether this item contains sensitive data</strong>
              <span>Check the preview below for passwords, keys or tokens, real names or emails, and real IPs or hostnames outside the lab. Until you decide, it cannot be sent to the AI analyst.</span>
            </span>
            <span className="rq-actions">
              <button className="btn sm rq-ok" disabled={sani.isPending} onClick={() => sani.mutate('no_sensitive_data')}><ShieldCheck /> No sensitive data</button>
              <button className="btn sm rq-bad" disabled={sani.isPending} onClick={() => sani.mutate('contains_sensitive')}><ShieldX /> Contains sensitive</button>
            </span>
          </div>
        </div>
      )}
      {!withdrawn && e.sanitization_status === 'contains_sensitive' && !e.derived_from && (
        <Notice tone="warn" title="Contains sensitive data">
          The AI analyst will not receive this item. Use <strong>Create sanitized copy</strong> to make a redacted version it can use; this original stays unchanged.
        </Notice>
      )}

      <KpiRow>
        <KpiCard
          icon={<Waypoints />}
          label="Linked records"
          value={e.findings.length + e.timeline.length + e.recon.length + e.indicators.length}
          pill={{ text: `${e.findings.length} finding${e.findings.length === 1 ? '' : 's'}`, tone: 'neutral' }}
          calc="Findings, timeline events, recon observations, and indicators that cite this Evidence ID. Secondary value: findings only."
        />
        <KpiCard
          icon={<Monitor />}
          label="Associated assets"
          value={e.assets.length}
          pill={{ text: `${e.services.length} service${e.services.length === 1 ? '' : 's'} observed`, tone: 'neutral' }}
          calc="Assets linked to this artifact. Secondary value: services whose scan observations came from this file."
        />
        <KpiCard
          icon={<Bot />}
          label="AI sessions"
          value={e.ai_sessions.length}
          pill={{ text: `${e.ai_sessions.filter((s: any) => s.cited).length} cited it`, tone: 'neutral' }}
          calc="AI analyses that included this evidence in their request context. Secondary value: sessions whose response cited this Evidence ID (a citation is not proof the evidence supports the statement)."
        />
        <KpiCard
          icon={isFile ? <HardDrive /> : <Link2 />}
          label={isFile ? 'Stored file' : 'Reference'}
          value={isFile ? fmtBytes(e.size_bytes) : 'Not stored'}
          pill={{ text: `${e.reviews.length} review event${e.reviews.length === 1 ? '' : 's'}`, tone: 'neutral' }}
          calc={isFile ? 'Size of the stored original, measured from its bytes. Secondary value: entries in this item’s review history.' : 'Recorded by reference; the file itself is kept elsewhere. Secondary value: entries in this item’s review history.'}
        />
      </KpiRow>

      {withdrawn && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn" title={`Withdrawn ${e.withdrawn_at ? fmtDateTime(e.withdrawn_at) : ''}.`}>
            Reason: {e.withdrawn_reason || '—'}. The ID {e.code} is retired and will never be reused; existing links are kept for traceability but this item no longer counts as supporting evidence.
          </Notice>
        </div>
      )}

      <div className="grid span-main">
        <div className="stack">
          <PreviewPanel ev={e} />

          <Panel title="Analysis" hint={<Provenance kind="entered" />}>
            <div className="stack tight">
              <div>
                <h3 className="ev-sub">Observation: what the evidence actually shows</h3>
                <p className="ev-prose">{e.observation || <span className="faint">Not recorded yet. Use “Edit metadata” to describe what is visible in the artifact.</span>}</p>
              </div>
              <div>
                <h3 className="ev-sub">Interpretation: what the team believes it means</h3>
                <p className="ev-prose">{e.interpretation || <span className="faint">Not recorded yet.</span>}</p>
              </div>
              {e.tags?.length > 0 && (
                <div className="chips">
                  {e.tags.map((t: string) => (
                    <Link key={t} to={`/evidence?tag=${encodeURIComponent(t)}`} className="badge">#{t}</Link>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <LinksPanel ev={e} />
          <ReviewPanel ev={e} onDone={refresh} />
        </div>

        <div className="stack">
          <Panel title="Integrity" hint={isFile ? <Provenance kind="calculated" detail="Calculated from the stored file bytes" /> : undefined}>
            <div className="stack tight">
              <div>
                <div className="row between">
                  <span className="small muted">
                    SHA-256 {isFile ? '(calculated from file bytes)' : e.sha256 ? '(analyst-supplied, not calculated)' : ''}
                  </span>
                  {e.sha256 && (
                    <button
                      className="btn ghost sm"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(e.sha256); toast.success('SHA-256 copied.'); }
                        catch { toast.error('Clipboard is not available; select the hash text instead.'); }
                      }}
                    >
                      <Copy /> Copy
                    </button>
                  )}
                </div>
                <div className="ev-hash">{e.sha256 ?? 'No hash recorded.'}</div>
              </div>
              <KV
                items={[
                  ['Size', fmtBytes(e.size_bytes)],
                  ['Type (from bytes)', isFile ? <span className="mono">{e.detected_type}</span> : 'Reference: not stored here'],
                  ['Stored MIME', e.mime_type ? <span className="mono">{e.mime_type}</span> : '—'],
                  ['Original file', e.original_filename ? <span className="mono">{e.original_filename}</span> : '—'],
                ]}
              />
              {isFile && (
                <button className="btn" onClick={() => verify.mutate()} disabled={verify.isPending}>
                  {verify.isPending ? <span className="spinner" /> : <ShieldCheck />} Re-verify hash
                </button>
              )}
              {hashResult && (
                hashResult.match ? (
                  <Notice tone="ok" title="Hash matches.">Stored bytes re-hashed at {fmtDateTime(hashResult.checked_at)} and match the hash recorded at import.</Notice>
                ) : (
                  <Notice tone="bad" title="Hash does not match.">
                    {hashResult.message ?? <>Computed <span className="mono ev-hash-inline">{hashResult.computed}</span>. The stored file has changed since import. Treat this item as unreliable.</>}
                  </Notice>
                )
              )}
              <p className="tiny faint">{HASH_CAVEAT}</p>
            </div>
          </Panel>

          <Panel title="Provenance">
            <KV
              items={[
                ['Source category', <SourceBadge value={e.source_category} />],
                ['Source / tool', e.source_tool || '—'],
                ['Collected', e.collected_at ? fmtDateTime(e.collected_at) : <span className="faint">Not supplied</span>],
                ...(e.collected_at_note ? [['Collection note', e.collected_at_note] as [string, string]] : []),
                ['Imported', fmtDateTime(e.imported_at)],
                ['Imported by', e.created_by || '—'],
                ['Analysis status', humanize(e.analysis_status)],
                ...(e.kind === 'reference' ? [['Location', <span className="mono">{e.reference_uri}</span>] as [string, any]] : []),
              ]}
            />
            {e.analysis_note && <div style={{ marginTop: 10 }}><Notice tone="info">{e.analysis_note}</Notice></div>}
          </Panel>

          <Panel
            title="Sanitized derivatives"
            actions={!withdrawn && <button className="btn sm" onClick={() => setDerivOpen(true)}><GitBranch /> Create sanitized copy</button>}
          >
            <div className="stack tight">
              {e.derived_from && (
                <div className="small">
                  Derived from <Link to={`/evidence/${e.derived_from.id}`} className="ev-chip">{e.derived_from.code}</Link>
                  <div className="mono tiny faint ev-hash-inline" title="Original SHA-256">{e.derived_from.sha256}</div>
                  {e.derivation_note && <div className="small muted" style={{ marginTop: 4 }}>{e.derivation_note}</div>}
                </div>
              )}
              {e.derivatives.length ? (
                <ul className="list-plain">
                  {e.derivatives.map((d: any) => (
                    <li key={d.id}>
                      <Link to={`/evidence/${d.id}`} className="ev-chip">{d.code}</Link> <span className="small">{d.title}</span>
                      <div className="mono tiny faint ev-hash-inline">{d.sha256}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                !e.derived_from && <p className="small muted">None. Create a redacted copy when the original contains passwords, tokens, or unrelated personal data. The original is preserved and both are hashed separately.</p>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <EditDrawer open={editOpen} onClose={() => setEditOpen(false)} ev={e} isDemo={isDemo} onSaved={refresh} />
      <DerivativeModal open={derivOpen} onClose={() => setDerivOpen(false)} ev={e} onCreated={(r) => { refresh(); navigate(`/evidence/${r.id}`); }} />
      <ConfirmDialog
        open={withdrawOpen}
        confirmDisabled={reason.trim().length < 3}
        onClose={() => setWithdrawOpen(false)}
        onConfirm={() => (reason.trim().length >= 3 ? withdraw.mutate() : toast.error('Enter a reason of at least 3 characters before withdrawing.'))}
        title={`Withdraw ${e.code}?`}
        confirmLabel="Withdraw evidence"
        busy={withdraw.isPending}
      >
        <p className="small muted">
          Withdrawing keeps the file, hash, and every link for traceability, but the item stops counting as supporting evidence. {e.code} is retired permanently. New evidence never reuses it. You can restore it later.
        </p>
        <Field label="Reason (required)" htmlFor="withdraw-reason" error={reason && reason.trim().length < 3 ? 'At least 3 characters.' : undefined}>
          <textarea id="withdraw-reason" value={reason} onChange={(x) => setReason(x.target.value)} placeholder="e.g. Uploaded to the wrong engagement" />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function PreviewPanel({ ev }: { ev: any }) {
  const { base } = useEngagement();
  const [wrap, setWrap] = useState(true);
  const q = useQuery({ queryKey: ['evidence', 'preview', ev.id], queryFn: () => api.get<any>(`${base}/evidence/${ev.id}/preview`) });
  const p = q.data;
  return (
    <Panel
      title="Preview"
      hint="Safe preview: uploaded markup and scripts are never rendered"
      actions={p?.type === 'text' && <button className="btn ghost sm" aria-pressed={wrap} onClick={() => setWrap((w) => !w)}><WrapText /> {wrap ? 'No wrap' : 'Wrap lines'}</button>}
    >
      {q.isLoading && <Loading />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {p?.type === 'image' && (
        <div className="ev-image">
          <img src={`${base}/evidence/${ev.id}/raw?inline=1`} alt={`${ev.code}: ${ev.title}`} loading="lazy" />
        </div>
      )}
      {p?.type === 'text' && (
        <div className="stack tight">
          {p.note && <Notice tone="warn">{p.note}</Notice>}
          <pre className={`code-block ${wrap ? 'wrap' : ''}`} tabIndex={0} aria-label="File contents">{p.text}</pre>
          {p.truncated && <p className="tiny faint">Preview truncated at 200 KB. Download the original for the full file.</p>}
        </div>
      )}
      {p?.type === 'pcap' && (
        <div className="stack tight">
          <Notice tone={ev.analysis_status === 'tshark_processed' ? 'ok' : 'info'} title={ev.analysis_status === 'tshark_processed' ? 'Processed with tshark.' : 'Metadata only: no packet analysis.'}>
            {ev.analysis_status === 'tshark_processed'
              ? ev.analysis_note
              : 'This application read the capture file headers (packet count, link type, time range). It did not decode packet contents. Import a Wireshark/tshark export in Attack Evidence for event-level analysis.'}
          </Notice>
          {p.meta ? (
            <KV
              items={[
                ['Format', <span className="mono">{p.meta.format}</span>],
                ['Link type', p.meta.linkTypeName],
                ['Packets counted', p.meta.packetCount],
                ['First packet', fmtDateTime(p.meta.firstPacketAt)],
                ['Last packet', fmtDateTime(p.meta.lastPacketAt)],
                ['Truncated file', p.meta.truncated ? 'Yes: the last record extends past the end of the file' : 'No'],
              ]}
            />
          ) : (
            <Notice tone="warn">The capture headers could not be read.</Notice>
          )}
        </div>
      )}
      {p?.type === 'reference' && (
        <Notice tone="info" title="Recorded by reference.">
          {p.note} Location: <span className="mono">{p.uri}</span>
        </Notice>
      )}
      {p?.type === 'missing' && <Notice tone="bad" title="File missing.">{p.note}</Notice>}
      {p?.type === 'none' && <Notice tone="info">{p.note}</Notice>}
    </Panel>
  );
}

function LinksPanel({ ev }: { ev: any }) {
  const groups: { label: string; items: any[]; render: (x: any) => JSX.Element }[] = [
    {
      label: 'Findings', items: ev.findings, render: (f) => (
        <Link to={`/vulnerabilities/${f.id}`} className="ev-link-row"><span className="mono">{f.code}</span><span className="clip">{f.title}</span><SeverityBadge severity={f.severity} /><ValidationBadge value={f.validation_status} /></Link>
      ),
    },
    {
      label: 'Timeline events', items: ev.timeline, render: (t) => (
        <Link to={`/attack?tab=timeline&focus=${t.id}`} className="ev-link-row"><span className="mono">{t.code}</span><span className="clip">{t.observation}</span><span className="tiny faint mono">{t.original_timestamp ?? 'time unknown'}</span></Link>
      ),
    },
    {
      label: 'Recon observations', items: ev.recon, render: (r) => (
        <Link to={`/recon?focus=${r.id}`} className="ev-link-row"><span className="mono">{r.code}</span><span className="clip">{r.value}</span><span className="tiny faint">{humanize(r.classification)}</span></Link>
      ),
    },
    {
      label: 'Indicators', items: ev.indicators, render: (i) => (
        <Link to={i.lab === 'lab1' ? `/engagement?tab=indicators&focus=${i.id}` : `/attack?tab=indicators&focus=${i.id}`} className="ev-link-row"><span className="mono">{i.code}</span><span className="clip">{i.title}</span><span className="tiny faint">{humanize(i.assessment)}</span></Link>
      ),
    },
    {
      label: 'Assets', items: ev.assets, render: (a) => (
        <Link to={`/scan/assets/${a.id}`} className="ev-link-row"><span className="mono">{a.code}</span><span className="mono">{a.ip ?? '—'}</span><span className="clip faint">{a.hostname}</span></Link>
      ),
    },
    {
      label: 'Services observed in this evidence', items: ev.services, render: (s) => (
        <Link to={`/scan?tab=services&q=${encodeURIComponent(s.ip ?? s.asset_code)}`} className="ev-link-row"><span className="mono">{s.asset_code}</span><span className="mono">{s.ip}:{s.port}/{s.protocol}</span><span className="clip faint">{s.service_name}</span></Link>
      ),
    },
    {
      label: 'Scan imports', items: ev.scan_imports, render: (s) => (
        <Link to={`/scan/imports/${s.id}`} className="ev-link-row"><span className="mono">{s.code}</span><span>{humanize(s.format)} · {humanize(s.status)}</span><span className="tiny faint">{s.observations_count} observations</span></Link>
      ),
    },
    {
      label: 'Log imports', items: ev.log_imports, render: (l) => (
        <Link to={`/attack?tab=imports&focus=${l.id}`} className="ev-link-row"><span className="mono">{l.code}</span><span>{humanize(l.format)} · {humanize(l.status)}</span><span className="tiny faint">{l.rows_imported} rows</span></Link>
      ),
    },
    {
      label: 'Vulnerability imports', items: ev.finding_imports, render: (f) => (
        <Link to="/vulnerabilities?tab=imports" className="ev-link-row"><span className="mono">{f.code}</span><span>{humanize(f.format)} · {humanize(f.status)}</span><span className="tiny faint">{f.created_count} findings</span></Link>
      ),
    },
    {
      label: 'AI analyses', items: ev.ai_sessions, render: (s) => (
        <Link to={`/ai/${s.id}`} className="ev-link-row"><span className="mono">{s.code}</span><span>{humanize(s.task_type)}</span><span className="tiny faint">{s.cited ? 'included + cited' : 'included, not cited'} · {humanize(s.review_status)}</span></Link>
      ),
    },
  ];
  const nonEmpty = groups.filter((g) => g.items?.length);
  return (
    <Panel title="Linked records" hint="Cross-module traceability">
      {nonEmpty.length ? (
        <div className="stack tight">
          {nonEmpty.map((g) => (
            <div key={g.label}>
              <h3 className="ev-sub">{g.label} <span className="faint">({g.items.length})</span></h3>
              <div className="ev-links">{g.items.map((x: any) => <div key={x.id}>{g.render(x)}</div>)}</div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Link2 />} title="Not linked yet">
          Link this item from a finding, timeline event, recon observation, or indicator so conclusions trace back to it.
        </EmptyState>
      )}
    </Panel>
  );
}

function ReviewPanel({ ev, onDone }: { ev: any; onDone: () => void }) {
  const { base } = useEngagement();
  const toast = useToast();
  const [action, setAction] = useState('reviewed');
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`${base}/evidence/${ev.id}/reviews`, { action, notes }),
    onSuccess: () => { setNotes(''); toast.success('Review recorded.'); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Review history" hint="Who did what, and when">
      <div className="stack">
        <form
          className="ev-review-form"
          onSubmit={(x) => { x.preventDefault(); m.mutate(); }}
        >
          <Select
            ariaLabel="Review action"
            value={action}
            onChange={setAction}
            options={[
              { value: 'reviewed', label: 'Reviewed' },
              { value: 'verified_against_source', label: 'Verified against source' },
              { value: 'needs_follow_up', label: 'Needs follow-up' },
              { value: 'note', label: 'Note' },
            ]}
          />
          <input type="text" aria-label="Review notes" placeholder="What did you check?" value={notes} onChange={(x) => setNotes(x.target.value)} maxLength={4000} />
          <button className="btn" type="submit" disabled={m.isPending}>Add entry</button>
        </form>
        <ol className="ev-history">
          {ev.reviews.map((r: any) => (
            <li key={r.id} className={r.action === 'hash_mismatch' ? 'bad' : r.action === 'hash_verified' ? 'ok' : ''}>
              <div className="row between">
                <strong className="small">
                  {r.action === 'hash_mismatch' && <ShieldAlert size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />}
                  {reviewLabel(r.action)}
                </strong>
                <span className="tiny faint">{fmtDateTime(r.created_at)}</span>
              </div>
              <div className="tiny muted">by {r.reviewer}</div>
              {r.notes && <div className="small" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>{r.notes}</div>}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

function EditDrawer({ open, onClose, ev, isDemo, onSaved }: { open: boolean; onClose: () => void; ev: any; isDemo: boolean; onSaved: () => void }) {
  const { base } = useEngagement();
  const toast = useToast();
  const init = (): MetaState => ({
    title: ev.title ?? '',
    source_category: ev.source_category,
    source_tool: ev.source_tool ?? '',
    collected_at: toLocalInput(ev.collected_at),
    collected_at_note: ev.collected_at_note ?? '',
    observation: ev.observation ?? '',
    interpretation: ev.interpretation ?? '',
    confidence: ev.confidence,
    tags: (ev.tags ?? []).join(', '),
    sanitization_status: ev.sanitization_status,
    asset_ids: (ev.assets ?? []).map((a: any) => a.id),
  });
  const [m, setM] = useState<MetaState>(init);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setM(init());
  }
  const save = useMutation({
    mutationFn: () =>
      api.patch(`${base}/evidence/${ev.id}`, {
        title: m.title,
        source_tool: m.source_tool,
        collected_at: fromLocalInput(m.collected_at),
        collected_at_note: m.collected_at_note,
        observation: m.observation,
        interpretation: m.interpretation,
        confidence: m.confidence,
        tags: m.tags,
        sanitization_status: m.sanitization_status,
        asset_ids: m.asset_ids,
      }),
    onSuccess: () => { toast.success(`${ev.code} updated. The change is logged in review history.`); onSaved(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit ${ev.code}`}
      subtitle="Metadata changes are logged. The stored file and its hash never change."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <span className="spinner" />} Save changes</button></>}
    >
      <MetadataFields m={m} set={(p) => setM((x) => ({ ...x, ...p }))} isDemo={isDemo} lockSource />
    </Drawer>
  );
}

function DerivativeModal({ open, onClose, ev, onCreated }: { open: boolean; onClose: () => void; ev: any; onCreated: (r: any) => void }) {
  const { base } = useEngagement();
  const toast = useToast();
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const f = new FormData();
      if (mode === 'file' && file) f.append('file', file);
      else f.append('text', text);
      f.append('derivation_note', note);
      const r = await api.upload(`${base}/evidence/${ev.id}/derivative`, f);
      toast.success(`Created ${r.code}, derived from ${ev.code}.`);
      setText(''); setFile(null); setNote('');
      onClose();
      onCreated(r);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Create sanitized derivative of ${ev.code}`}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (mode === 'file' ? !file : !text.trim())} onClick={submit}>{busy && <span className="spinner" />} Create derivative</button></>}
    >
      <div className="stack">
        <Notice tone="info">
          The original {ev.code} is preserved unchanged. The derivative gets its own Evidence ID and its own SHA-256, is marked “sanitized”, and keeps a link back to the original.
        </Notice>
        <div className="btn-group" role="group" aria-label="Derivative source">
          <button className={`btn sm ${mode === 'text' ? 'on' : ''}`} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Paste redacted text</button>
          <button className={`btn sm ${mode === 'file' ? 'on' : ''}`} aria-pressed={mode === 'file'} onClick={() => setMode('file')}>Upload redacted file</button>
        </div>
        {mode === 'text' ? (
          <Field label="Redacted content" htmlFor="deriv-text">
            <textarea id="deriv-text" className="mono-input" style={{ minHeight: 180 }} value={text} onChange={(x) => setText(x.target.value)} spellCheck={false} />
          </Field>
        ) : (
          <FileDrop file={file} onFile={setFile} hint="e.g. a screenshot with the password field blurred" />
        )}
        <Field label="What was removed or changed?" htmlFor="deriv-note" help="Recorded in the review history of both items.">
          <input id="deriv-note" type="text" value={note} onChange={(x) => setNote(x.target.value)} placeholder="Replaced usernames and the API token with [REDACTED]" />
        </Field>
        {err && <Notice tone="bad" title="Not created.">{err}</Notice>}
        <p className="tiny faint"><Archive size={12} style={{ verticalAlign: '-2px' }} /> {HASH_CAVEAT}</p>
      </div>
    </Modal>
  );
}
