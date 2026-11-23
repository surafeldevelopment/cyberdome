import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Camera, ExternalLink, ImagePlus, Link2, Paperclip, Terminal, Unlink, Upload, BadgeCheck, Save, ListChecks, PackageCheck, FileText } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import { PageHeader, Panel, Loading, ErrorState, Notice, Field } from '../components/ui';
import { KpiCard, KpiRow, AssetCell, StatusPill } from '../components/kit';
import { Modal, ConfirmDialog, useToast } from '../components/overlay';
import { EvidenceSelectModal, useEvidenceOptions, FileDrop } from '../components/evidence';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useTracker, RequirementList, LabStatusBadge, type LabStatus, type ScreenshotReq, type Deliverable } from './tracker/shared';
import '../styles/tracker.css';

const IMAGE_TYPES = ['png', 'jpeg', 'gif', 'webp'];

function useInvalidate() {
  const qc = useQueryClient();
  const { eid } = useEngagement();
  return () => {
    qc.invalidateQueries({ queryKey: ['tracker', eid] });
    qc.invalidateQueries({ queryKey: ['dashboard', eid] });
    qc.invalidateQueries({ queryKey: ['evidence', eid] });
  };
}

function TrackerKpis({ t }: { t: { final_due: string; today: string; labs: LabStatus[]; screenshots: ScreenshotReq[]; deliverables: Deliverable[] } }) {
  const days = Math.round((Date.parse(t.final_due) - Date.parse(t.today)) / 86400000);
  const met = t.labs.reduce((a, l) => a + l.met, 0);
  const total = t.labs.reduce((a, l) => a + l.total, 0);
  const shots = t.screenshots.filter((s) => s.evidence_id && s.evidence_status === 'active').length;
  const done = t.deliverables.filter((d) => d.status === 'done').length;
  const weekday = new Date(t.final_due + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <KpiRow>
      <KpiCard
        icon={<CalendarClock />}
        label={days >= 0 ? 'Days until final submission' : 'Days past final submission'}
        value={Math.abs(days)}
        pill={{ text: weekday, tone: days < 0 ? 'bad' : days <= 7 ? 'warn' : 'neutral' }}
        calc={`Final due date from the NWIT 246 packet (${fmtDate(t.final_due)}) minus today's date (${fmtDate(t.today)}).`}
      />
      <KpiCard
        icon={<ListChecks />}
        label="Lab requirements met"
        value={`${met}/${total}`}
        pill={{ text: `${Math.round((met / Math.max(1, total)) * 100)}%`, tone: met === total ? 'ok' : 'neutral' }}
        calc="Requirements across the six labs, each checked by the server against stored records (counts, evidence links, verified AI reviews, attached screenshots). A page existing never counts."
      />
      <KpiCard
        icon={<Camera />}
        label="Required screenshots attached"
        value={`${shots}/${t.screenshots.length}`}
        pill={{ text: shots === t.screenshots.length ? 'Complete' : `${t.screenshots.length - shots} missing`, tone: shots === t.screenshots.length ? 'ok' : 'warn' }}
        calc="Packet screenshot requirements that have an active image from the Evidence Locker attached."
      />
      <KpiCard
        icon={<PackageCheck />}
        label="Deliverables done"
        value={`${done}/${t.deliverables.length}`}
        pill={{ text: 'Self-reported', tone: 'neutral' }}
        calc="Final submission deliverables your team marked as done. This status is self-reported, not verified by the app."
      />
    </KpiRow>
  );
}

function LabCard({ lab }: { lab: LabStatus }) {
  const { base } = useEngagement();
  const toast = useToast();
  const inv = useInvalidate();
  const [confirm, setConfirm] = useState(false);
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: (signed: boolean) => api.post(`${base}/tracker/labs/${lab.lab}/signoff`, { signed, notes }),
    onSuccess: (_d, signed) => { inv(); setConfirm(false); toast.success(signed ? `${lab.title} signed off.` : 'Sign-off removed.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const allMet = lab.met === lab.total;
  return (
    <article className="lab-card panel">
      <header className="lab-card-head">
        <span className="lab-num" aria-hidden>{lab.lab.replace('lab', '')}</span>
        <div className="lab-head-text">
          <h2>{lab.title.replace(/^Lab \d: /, '')}</h2>
          <span className="tiny faint">{lab.lab.replace('lab', 'Lab ')} · {lab.met} of {lab.total} requirements met</span>
        </div>
        <LabStatusBadge status={lab.status} />
      </header>
      <div className="progress" aria-label={`${lab.met} of ${lab.total} requirements met`}><div style={{ width: `${(lab.met / Math.max(1, lab.total)) * 100}%` }} /></div>
      <RequirementList reqs={lab.requirements} />
      <footer className="row between" style={{ marginTop: 8 }}>
        {lab.signoff ? (
          <>
            <span className="small muted"><BadgeCheck size={14} style={{ color: 'var(--ok)', verticalAlign: -2 }} /> Signed off by {lab.signoff.signed_off_by}, {fmtDateTime(lab.signoff.signed_off_at)}</span>
            <button className="btn sm ghost" onClick={() => m.mutate(false)} disabled={m.isPending}>Remove sign-off</button>
          </>
        ) : (
          <>
            <span className="tiny faint">{allMet ? 'All requirements met: ready for team sign-off.' : `${lab.total - lab.met} requirement(s) still open.`}</span>
            <button className="btn sm" disabled={!allMet} onClick={() => setConfirm(true)} title={allMet ? undefined : 'Sign-off is available once every requirement is met'}>
              <BadgeCheck /> Sign off
            </button>
          </>
        )}
      </footer>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger={false} title={`Sign off ${lab.title}`} confirmLabel="Sign off" busy={m.isPending} onConfirm={() => m.mutate(true)}>
        <p>Sign-off records that your team reviewed this lab’s evidence and work. It is attributed to the analyst name in Settings.</p>
        <Field label="Notes (optional)" htmlFor={`so-${lab.lab}`}>
          <textarea id={`so-${lab.lab}`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </article>
  );
}

function UploadScreenshot({ req, onClose }: { req: ScreenshotReq; onClose: () => void }) {
  const { base, isDemo } = useEngagement();
  const toast = useToast();
  const inv = useInvalidate();
  const [file, setFile] = useState<File | null>(null);
  const [collected, setCollected] = useState('');
  const [obs, setObs] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      const f = new FormData();
      f.append('file', file!);
      f.append('title', `Screenshot: ${req.label}`);
      f.append('source_category', isDemo ? 'demo' : 'authorized_lab');
      f.append('source_tool', 'Terminal screenshot');
      if (collected) f.append('collected_at', new Date(collected).toISOString());
      f.append('observation', obs);
      f.append('tags', 'screenshot,tool-activity');
      const ev = await api.upload<{ id: string; code: string }>(`${base}/evidence`, f);
      await api.put(`${base}/tracker/screenshots/${req.id}`, { evidence_id: ev.id });
      return ev;
    },
    onSuccess: (ev) => { inv(); toast.success(`Uploaded ${ev.code} and attached it.`); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Upload: ${req.label}`}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!file || m.isPending} onClick={() => m.mutate()}>{m.isPending && <span className="spinner" />} Upload and attach</button>
        </>
      }
    >
      <div className="stack tight">
        <Notice tone="info">
          This requirement needs a screenshot of real tool activity from your authorized lab (for example your terminal showing the <code>nmap</code> command and its result). The app cannot capture or generate it for you. Redact passwords, tokens, and unrelated personal data first.
        </Notice>
        <FileDrop onFile={setFile} file={file} accept="image/png,image/jpeg,image/gif,image/webp" hint="PNG, JPEG, GIF, or WebP" />
        <div className="form-grid">
          <Field label="When was it taken?" htmlFor="u-when" help="Optional; leave blank if unknown.">
            <input id="u-when" type="datetime-local" value={collected} onChange={(e) => setCollected(e.target.value)} />
          </Field>
          <Field label="What does it show?" htmlFor="u-obs" full>
            <textarea id="u-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="e.g. nmap -sV against the assigned lab target and its service table" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Screenshots({ shots }: { shots: ScreenshotReq[] }) {
  const { base } = useEngagement();
  const toast = useToast();
  const inv = useInvalidate();
  const ev = useEvidenceOptions();
  const [picking, setPicking] = useState<ScreenshotReq | null>(null);
  const [uploading, setUploading] = useState<ScreenshotReq | null>(null);
  const attach = useMutation({
    mutationFn: ({ id, evidence_id }: { id: string; evidence_id: string | null }) => api.put(`${base}/tracker/screenshots/${id}`, { evidence_id }),
    onSuccess: () => { inv(); toast.success('Screenshot requirement updated.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const images = useMemo(() => (ev.data?.items ?? []).filter((e) => IMAGE_TYPES.includes(e.detected_type ?? '') && e.status === 'active'), [ev.data]);
  const byLab = useMemo(() => {
    const m = new Map<string, ScreenshotReq[]>();
    for (const s of shots) m.set(s.lab, [...(m.get(s.lab) ?? []), s]);
    return [...m.entries()];
  }, [shots]);
  const attached = shots.filter((s) => s.evidence_id && s.evidence_status === 'active').length;

  return (
    <Panel title="Required screenshots" hint={`${attached} of ${shots.length} attached`} flush>
      <div className="shot-note">
      <Notice tone="info">
        <strong>App views</strong> can be captured with the <Camera size={13} style={{ verticalAlign: -2 }} /> Capture button on the page itself (saved as a project artifact in the Evidence Locker). <strong>Tool activity</strong> screenshots must come from your own terminal or tool. They are never generated here.
      </Notice>
      </div>
      <div className="table-wrap shot-wrap">
        <table className="data shot-table">
          <caption className="sr-only">Required screenshots</caption>
          <thead><tr><th>Requirement</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {byLab.flatMap(([lab, list]) =>
              list.map((s) => {
                const ok = !!s.evidence_id && s.evidence_status === 'active';
                return (
                  <tr key={s.id}>
                    <td>
                      <AssetCell
                        icon={s.capture_kind === 'app_view' ? <Camera /> : <Terminal />}
                        title={s.label}
                        sub={`${lab.replace('lab', 'Lab ')} · ${s.capture_kind === 'app_view' ? 'App view: capture it in CyberDome' : 'Tool activity: from your own terminal or tool'}`}
                      />
                    </td>
                    <td className="nowrap">
                      {s.evidence_id ? (
                        <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <StatusPill tone={ok ? 'ok' : 'muted'}>{ok ? 'Attached' : 'Withdrawn'}</StatusPill>
                          <Link to={`/evidence/${s.evidence_id}`} className={`ev-chip ${s.evidence_status === 'withdrawn' ? 'withdrawn' : ''}`} title={s.evidence_title ?? ''}>{s.evidence_code}</Link>
                        </span>
                      ) : (
                        <StatusPill tone="warn">Not attached</StatusPill>
                      )}
                    </td>
                    <td>
                      <span className="shot-actions">
                        {s.capture_kind === 'app_view' && s.app_route && (
                          <Link className="btn sm" to={s.app_route} title="Open the view, then use its Capture button"><ExternalLink /> Open view</Link>
                        )}
                        {s.capture_kind === 'tool_activity' && (
                          <button className="btn sm" onClick={() => setUploading(s)}><Upload /> Upload</button>
                        )}
                        <button className="btn sm ghost" onClick={() => setPicking(s)}><Paperclip /> Attach</button>
                        {s.evidence_id && (
                          <button className="kebab" aria-label={`Detach screenshot from ${s.label}`} title="Detach" onClick={() => attach.mutate({ id: s.id, evidence_id: null })}><Unlink size={16} /></button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {picking && (
        <EvidenceSelectModal
          open
          title={`Attach image: ${picking.label}`}
          onClose={() => setPicking(null)}
          value={picking.evidence_id ? [picking.evidence_id] : []}
          items={picking.capture_kind === 'tool_activity' ? images.filter((e) => e.source_category !== 'project_artifact') : images}
          loading={ev.isLoading}
          onChange={(ids) => {
            const chosen = ids.find((i) => i !== picking.evidence_id) ?? ids[0] ?? null;
            attach.mutate({ id: picking.id, evidence_id: chosen });
          }}
        />
      )}
      {uploading && <UploadScreenshot req={uploading} onClose={() => setUploading(null)} />}
    </Panel>
  );
}

function DeliverableRow({ d }: { d: Deliverable }) {
  const { base } = useEngagement();
  const toast = useToast();
  const inv = useInvalidate();
  const [notes, setNotes] = useState(d.notes);
  const [pick, setPick] = useState(false);
  const ev = useEvidenceOptions(pick);
  const m = useMutation({
    mutationFn: (body: Partial<{ status: string; notes: string; evidence_id: string | null }>) => api.put(`${base}/tracker/deliverables/${d.id}`, body),
    onSuccess: () => { inv(); toast.success(`Updated “${d.label}”.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <tr>
      <td>
        <AssetCell
          icon={<FileText />}
          title={d.label}
          sub={d.updated_by ? `Last updated by ${d.updated_by}` : 'Not yet updated'}
        />
      </td>
      <td style={{ width: 170 }}>
        <select className="select-pill" aria-label={`Status of ${d.label}`} value={d.status} onChange={(e) => m.mutate({ status: e.target.value })}>
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </td>
      <td style={{ minWidth: 220 }}>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
          <input aria-label={`Notes for ${d.label}`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Location, link, owner…" />
          {notes !== d.notes && <button className="btn sm icon" aria-label="Save notes" onClick={() => m.mutate({ notes })}><Save /></button>}
        </div>
      </td>
      <td className="nowrap">
        {d.evidence_id ? <Link className="ev-chip" to={`/evidence/${d.evidence_id}`}>{d.evidence_code}</Link> : null}{' '}
        <button className="btn sm ghost" onClick={() => setPick(true)}><Link2 /> {d.evidence_id ? 'Change' : 'Link file'}</button>
        {pick && (
          <EvidenceSelectModal
            open
            title={`Link evidence: ${d.label}`}
            onClose={() => setPick(false)}
            value={d.evidence_id ? [d.evidence_id] : []}
            items={(ev.data?.items ?? []).filter((e) => e.status === 'active')}
            loading={ev.isLoading}
            onChange={(ids) => m.mutate({ evidence_id: ids.find((i) => i !== d.evidence_id) ?? ids[0] ?? null })}
          />
        )}
      </td>
      <td className="nowrap"><StatusPill tone={d.status === 'done' ? 'ok' : d.status === 'in_progress' ? 'info' : 'muted'}>{d.status === 'done' ? 'Done' : d.status === 'in_progress' ? 'In progress' : 'Not started'}</StatusPill><div className="tiny faint" style={{ marginTop: 4, paddingLeft: 4 }}>{fmtDate(d.updated_at)}</div></td>
    </tr>
  );
}

export default function Tracker() {
  const q = useTracker();
  if (q.isLoading) return <Loading rows={6} label="Loading tracker" />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const t = q.data!;
  const done = t.deliverables.filter((d) => d.status === 'done').length;
  return (
    <>
      <PageHeader
        title="Project Tracker"
        subtitle="Six labs and the final submission package. Requirements are checked against stored records. A page existing never counts as completion."
      />
      <TrackerKpis t={t} />
      <div className="stack">
        <section aria-label="Labs" className="lab-grid">
          {t.labs.map((l) => <LabCard key={l.lab} lab={l} />)}
        </section>
        <Screenshots shots={t.screenshots} />
        <Panel title="Final submission checklist" hint={`${done} of ${t.deliverables.length} done · due ${fmtDate(t.final_due)}`} flush>
          <div className="table-wrap">
            <table className="data">
              <caption className="sr-only">Final submission deliverables</caption>
              <thead><tr><th>Deliverable</th><th>Set status</th><th>Notes</th><th>Linked file</th><th>Status</th></tr></thead>
              <tbody>{t.deliverables.map((d) => <DeliverableRow key={d.id} d={d} />)}</tbody>
            </table>
          </div>
          <p className="small faint" style={{ padding: '12px 20px', margin: 0, borderTop: '1px solid var(--line)' }}>
            Exports for the report, executive summary, and evidence package are on the <Link to="/reports">Reports</Link> page. Deliverable status is self-reported by the team.
          </p>
        </Panel>
        <Panel title="Checkpoints">
          <ol className="cp-timeline">
            {t.checkpoints.map((c) => {
              const passed = c.date < t.today;
              const isToday = c.date === t.today;
              return (
                <li key={c.key} className={passed ? 'passed' : isToday ? 'today' : ''}>
                  <span className="mono small"><CalendarClock size={13} style={{ verticalAlign: -2 }} /> {fmtDate(c.date)}{isToday ? ' · today' : ''}</span>
                  <span>{c.label}</span>
                  <span className="tiny faint">{c.check}</span>
                </li>
              );
            })}
          </ol>
        </Panel>
        <p className="tiny faint" style={{ margin: 0 }}><ImagePlus size={12} style={{ verticalAlign: -2 }} /> Need more images? Upload them in the <Link to="/evidence?upload=1">Evidence Locker</Link>.</p>
      </div>
    </>
  );
}
