import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, Download, FileDown, FileText, Lock, Printer, Sparkles, Unlock, XCircle, Package, Save } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { PageHeader, Panel, Notice, Loading, ErrorState, Tabs, useTab, Badge, Provenance, EmptyState } from '../../components/ui';
import { ConfirmDialog, Modal, useToast } from '../../components/overlay';
import { CaptureButton } from '../../components/CaptureButton';
import { KpiCard, KpiRow, AssetCell, StatusPill } from '../../components/kit';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { SECTIONS, ReportDoc, useRendered, type ReportResp, type Readiness } from './shared';
import type { AiSessionSummary } from '../ai/shared';
import '../../styles/reports.css';

function ReadinessPanel({ r }: { r: Readiness }) {
  const blockers = r.issues.filter((i) => i.severity === 'blocker');
  const warnings = r.issues.filter((i) => i.severity === 'warning');
  return (
    <Panel
      title="Report Readiness"
      actions={r.ready ? <StatusPill tone="ok">Ready</StatusPill> : <StatusPill tone="bad">{blockers.length} blocking</StatusPill>}
    >
      {r.ready && !warnings.length && <Notice tone="ok">Every readiness check passes.</Notice>}
      {r.ready && !!warnings.length && <Notice tone="ok">No blocking issues. Review the warnings before submitting.</Notice>}
      <ul className="readiness">
        {[...blockers, ...warnings].map((i, n) => {
          const body = (
            <>
              <span className={`rd-ic ${i.severity === 'blocker' ? 'rb' : 'rw'}`} aria-label={i.severity === 'blocker' ? 'Blocking' : 'Warning'}>
                {i.severity === 'blocker' ? <XCircle /> : <AlertTriangle />}
              </span>
              <span className="rd-t">
                <span className="rd-area">{i.area} · {i.severity === 'blocker' ? 'Blocking' : 'Warning'}</span>
                <span className="rd-msg">{i.message}</span>
              </span>
              {i.link && <span className="rd-go" aria-hidden><ArrowUpRight size={16} /></span>}
            </>
          );
          return (
            <li key={n}>
              {i.link ? <Link to={i.link} className="rd-row" aria-label={`Fix: ${i.message}`}>{body}</Link> : <div className="rd-row">{body}</div>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function SectionEditor({ k, title, help, value, source, disabled, onSave, onInsert, saving }: {
  k: string; title: string; help: string; value: string; source: any; disabled: boolean; saving: boolean;
  onSave: (k: string, v: string) => void; onInsert: (k: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const dirty = text !== value;
  return (
    <div className="section-editor">
      <div className="row between se-head">
        <label htmlFor={`sec-${k}`} className="row" style={{ gap: 10 }}>
          <span className="se-ic" aria-hidden><FileText size={16} /></span>
          <h3>{title}</h3>
          {value.trim() ? <StatusPill tone="ok">Written</StatusPill> : <StatusPill tone="muted">Empty</StatusPill>}
        </label>
        <span className="row" style={{ gap: 8 }}>
          {source?.type === 'ai_session' && <Provenance kind="verified" detail={`From ${source.code}, verified by ${source.reviewer}`} />}
          {source?.type === 'ai_session' && <span className="tiny faint">From verified AI {source.code} · {source.reviewer}</span>}
          {source?.type === 'manual' && <Provenance kind="entered" detail={`By ${source.by} ${fmtRelative(source.at)}`} />}
          {source?.type === 'manual' && source.edited_from && <span className="tiny faint">edited from {source.edited_from}</span>}
        </span>
      </div>
      <p className="small faint" style={{ margin: '4px 0 10px' }}>{help}</p>
      <textarea id={`sec-${k}`} value={text} onChange={(e) => setText(e.target.value)} rows={k === 'executive_summary' ? 9 : 5} disabled={disabled} placeholder="Write this section, or insert verified AI text." />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm primary" disabled={!dirty || disabled || saving} onClick={() => onSave(k, text)}><Save /> Save section</button>
        {dirty && <button className="btn sm ghost" onClick={() => setText(value)}>Discard changes</button>}
        <button className="btn sm" disabled={disabled} onClick={() => onInsert(k)} style={{ marginLeft: 'auto' }}><Sparkles /> Insert verified AI text</button>
      </div>
    </div>
  );
}

function InsertAiModal({ section, onClose }: { section: string | null; onClose: () => void }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const verified = useQuery({ queryKey: ['ai-sessions', eid, 'verified'], queryFn: () => api.get<AiSessionSummary[]>(`${base}/ai/sessions?review_status=verified_any`), enabled: !!section });
  const m = useMutation({
    mutationFn: (sid: string) => api.post(`${base}/report/sections/${section}/from-ai`, { session_id: sid }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report', eid] });
      qc.invalidateQueries({ queryKey: ['report-render', eid] });
      toast.success('Inserted the reviewed AI text. The section records which session and reviewer it came from.');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const title = SECTIONS.find((s) => s.key === section)?.title;
  return (
    <Modal open={!!section} onClose={onClose} title={`Insert verified AI text: ${title}`} size="wide">
      <div className="stack">
        <Notice tone="info">Only AI drafts that a team member verified are listed. The reviewed (edited) text replaces this section’s current content.</Notice>
        {verified.isLoading && <Loading />}
        {verified.data && !verified.data.length && (
          <EmptyState title="No verified AI drafts" actions={<Link className="btn" to="/ai" onClick={onClose}>Open AI Security Analyst</Link>}>
            Generate a draft and record a verification review first.
          </EmptyState>
        )}
        <ul className="list-plain">
          {(verified.data ?? []).map((s) => (
            <li key={s.id}>
              <div className="row between">
                <span className="row" style={{ gap: 8 }}><span className="mono" style={{ color: 'var(--accent-strong)' }}>{s.code}</span> {s.task_label} <Badge tone="ok">{s.review_status === 'verified_with_edits' ? 'Verified with edits' : 'Verified'}</Badge></span>
                <button className="btn sm primary" disabled={m.isPending} onClick={() => m.mutate(s.id)}>Use this text</button>
              </div>
              <p className="small muted clamp-2" style={{ margin: '4px 0 0' }}>{(s.reviewed_text ?? '').slice(0, 400)}</p>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function ExportsPanel({ base, ready }: { base: string; ready: boolean }) {
  const ex = (path: string) => `${base}${path}`;
  const items: { icon: any; label: string; help: string; href: string; internal?: boolean }[] = [
    { icon: Printer, label: 'Technical report → PDF', help: 'Opens the print layout. Use your browser’s “Save as PDF”.', href: '/reports/print', internal: true },
    { icon: Printer, label: 'One-page executive summary → PDF', help: 'Print layout for management.', href: '/reports/executive', internal: true },
    { icon: FileText, label: 'Report (HTML file)', help: 'Self-contained, screenshots embedded.', href: ex('/exports/report.html') },
    { icon: FileText, label: 'Report (Markdown)', help: 'For editing in Word/Docs or a repository.', href: ex('/exports/report.md') },
    { icon: FileText, label: 'Executive summary (HTML file)', help: 'One page.', href: ex('/exports/executive-summary.html') },
    { icon: FileDown, label: 'Evidence index (CSV)', help: 'All evidence records, not just one page.', href: ex('/evidence-index.csv') },
    { icon: FileDown, label: 'Evidence index (JSON)', help: 'All evidence records.', href: ex('/evidence-index.json') },
    { icon: FileDown, label: 'Complete engagement data (JSON)', help: 'Every record with source labels.', href: ex('/exports/engagement.json') },
    { icon: Package, label: 'Evidence package (ZIP)', help: 'Evidence files, index, report, data, manifest with SHA-256. Excludes items marked sensitive.', href: ex('/exports/package.zip') },
    { icon: Package, label: 'Evidence package: sanitized only (ZIP)', help: 'Only evidence reviewed as sanitized or no-sensitive-data.', href: ex('/exports/package.zip?sanitized_only=1') },
  ];
  return (
    <Panel title="Exports" hint={ready ? 'All records, never one page' : 'Draft exports are labeled DRAFT'}>
      <ul className="exports">
        {items.map((i) => (
          <li key={i.label} className="ex-row">
            <AssetCell icon={<i.icon />} title={i.label} sub={i.help} />
            {i.internal ? (
              <Link className="btn sm" to={i.href}><Printer /> Open</Link>
            ) : (
              <a className="btn sm" href={i.href} download><Download /> Download</a>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function ReportsPage() {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useTab('build');
  const [insertFor, setInsertFor] = useState<string | null>(null);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<'full' | 'executive'>('full');

  const q = useQuery({ queryKey: ['report', eid], queryFn: () => api.get<ReportResp>(`${base}/report`), enabled: !!eid });
  const rendered = useRendered(previewKind);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['report', eid] });
    qc.invalidateQueries({ queryKey: ['report-render', eid] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const save = useMutation({
    mutationFn: (body: any) => api.put(`${base}/report`, body),
    onSuccess: () => { invalidate(); toast.success('Report saved.'); setTitleDraft(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const finalize = useMutation({
    mutationFn: () => api.post(`${base}/report/finalize`),
    onSuccess: () => { invalidate(); setConfirmFinal(false); toast.success('Report finalized.'); },
    onError: (e) => { setConfirmFinal(false); toast.error(errorMessage(e)); },
  });
  const reopen = useMutation({
    mutationFn: () => api.post(`${base}/report/reopen`),
    onSuccess: () => { invalidate(); toast.info('Report reopened for editing.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const final = d.report.status === 'final';
  const written = SECTIONS.filter((x) => (d.narrative[x.key] ?? '').trim()).length;
  const fromAi = SECTIONS.filter((x) => d.narrative_sources[x.key]?.type === 'ai_session').length;

  return (
    <div className="rep-page">
      <PageHeader
        title="Reports"
        subtitle="The report is assembled from your engagement records. Write the narrative sections yourself or insert AI drafts that a team member has verified. Unverified AI text can never enter the report."
        actions={
          <>
            <CaptureButton title="Final report preview" label="Capture view" />
            {final ? (
              <button className="btn" onClick={() => reopen.mutate()}><Unlock /> Reopen for editing</button>
            ) : (
              <button className="btn primary" disabled={!d.readiness.ready} onClick={() => setConfirmFinal(true)} title={d.readiness.ready ? undefined : 'Resolve blocking issues first'}>
                <Lock /> Finalize report
              </button>
            )}
          </>
        }
      />
      <KpiRow>
        <KpiCard
          icon={<XCircle />}
          label="Blocking issues"
          value={d.readiness.blockers ?? 0}
          pill={d.readiness.ready ? { text: 'Ready to finalize', tone: 'ok' } : { text: 'Not ready', tone: 'bad' }}
          calc="Readiness checks that must pass before the report can be finalized (scope, authorization, evidence links, prioritization, executive summary, unverified AI text in sections)."
        />
        <KpiCard
          icon={<AlertTriangle />}
          label="Warnings"
          value={d.readiness.warnings ?? 0}
          pill={{ text: final ? `Final · ${fmtRelative(d.report.finalized_at)}` : 'Draft', tone: final ? 'ok' : 'warn' }}
          calc="Non-blocking readiness findings. Draft exports are labeled DRAFT until the report is finalized."
        />
        <KpiCard
          icon={<FileText />}
          label="Narrative sections written"
          value={`${written}/${SECTIONS.length}`}
          pill={{ text: `${fromAi} from verified AI`, tone: 'neutral' }}
          calc="Narrative sections with saved text. Sections inserted from AI drafts are counted separately; only verified AI text can be inserted."
        />
        <KpiCard
          icon={<FileDown />}
          label="Evidence references"
          value={d.evidence.length}
          pill={{ text: `${d.findings.length} finding${d.findings.length === 1 ? '' : 's'}`, tone: 'neutral' }}
          to="/evidence"
          calc="Evidence records referenced in the report's evidence index, and findings included in the technical findings section (false positives excluded)."
        />
      </KpiRow>
      <p className="small faint rep-ai-line">
        AI drafts: {d.ai.verified} verified · {d.ai.unverified} unverified · {d.ai.rejected} rejected. Unverified drafts never enter the report.
      </p>

      <Tabs label="Report views" value={tab} onChange={setTab} tabs={[{ id: 'build', label: 'Build' }, { id: 'preview', label: 'Preview' }, { id: 'export', label: 'Export' }]} />

      {tab === 'build' && (
        <div className="grid span-main">
          <div className="stack">
            <Panel title="Report Title">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input aria-label="Report title" value={titleDraft ?? d.report.title} disabled={final} onChange={(e) => setTitleDraft(e.target.value)} />
                <button className="btn primary" disabled={final || titleDraft === null || !titleDraft.trim() || save.isPending} onClick={() => save.mutate({ title: titleDraft })}>Save</button>
              </div>
            </Panel>
            <Panel title="Narrative Sections" hint="Everything else in the report is generated from your records">
              {final && <Notice tone="info">The report is finalized. Reopen it to edit.</Notice>}
              <div className="stack">
                {SECTIONS.map((s) => (
                  <SectionEditor
                    key={s.key}
                    k={s.key}
                    title={s.title}
                    help={s.help}
                    value={d.narrative[s.key] ?? ''}
                    source={d.narrative_sources[s.key]}
                    disabled={final}
                    saving={save.isPending}
                    onSave={(k, v) => save.mutate({ narrative: { [k]: v } })}
                    onInsert={setInsertFor}
                  />
                ))}
              </div>
            </Panel>
          </div>
          <div className="stack">
            <ReadinessPanel r={d.readiness} />
            <Panel title="Generated From Records">
              <ol className="gen-list">
                {[
                  ['Scope, authorization, testing window, rules', 'Engagement', '/engagement'],
                  ['Recon summary', 'Recon', '/recon'],
                  ['Asset & service inventory', 'Scan & Enumeration', '/scan'],
                  [`${d.findings.length} findings, top-three priorities, remediation`, 'Vulnerabilities', '/vulnerabilities'],
                  ['Attack timeline, indicators, verified ATT&CK mappings', 'Attack Evidence', '/attack'],
                  [`${d.evidence.length} evidence references and figures`, 'Evidence Locker', '/evidence'],
                  ['AI use & human verification statement', 'Calculated from AI sessions and reviews', null],
                  ['Team contributions', 'Engagement team', '/engagement?tab=team'],
                ].map(([t, sub, to], i) => (
                  <li key={i}>
                    {to ? (
                      <Link to={to} className="num-row gen-row">
                        <span className="n">{i + 1}</span>
                        <span className="t"><strong>{t}</strong><span>{sub}</span></span>
                        <span className="go" aria-hidden><ArrowUpRight size={15} /></span>
                      </Link>
                    ) : (
                      <div className="num-row gen-row">
                        <span className="n">{i + 1}</span>
                        <span className="t"><strong>{t}</strong><span>{sub}</span></span>
                        <span />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'preview' && (
        <div className="stack">
          <div className="row">
            <div className="btn-group" role="radiogroup" aria-label="Preview">
              <button role="radio" aria-checked={previewKind === 'full'} className={`btn sm ${previewKind === 'full' ? 'on' : ''}`} onClick={() => setPreviewKind('full')}>Technical report</button>
              <button role="radio" aria-checked={previewKind === 'executive'} className={`btn sm ${previewKind === 'executive' ? 'on' : ''}`} onClick={() => setPreviewKind('executive')}>Executive summary</button>
            </div>
            <Link className="btn sm" to={previewKind === 'full' ? '/reports/print' : '/reports/executive'} style={{ marginLeft: 'auto' }}><Printer /> Print / Save as PDF</Link>
          </div>
          {rendered.isLoading && <Loading />}
          {rendered.error && <ErrorState error={rendered.error} retry={() => rendered.refetch()} />}
          {rendered.data && (
            <div className="paper-wrap panel">
              <div className="paper">
                <ReportDoc html={rendered.data.html} />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div className="grid span-main">
          <ExportsPanel base={base} ready={d.readiness.ready} />
          <ReadinessPanel r={d.readiness} />
        </div>
      )}

      <InsertAiModal section={insertFor} onClose={() => setInsertFor(null)} />
      <ConfirmDialog
        open={confirmFinal}
        onClose={() => setConfirmFinal(false)}
        onConfirm={() => finalize.mutate()}
        title="Finalize report?"
        confirmLabel="Finalize"
        danger={false}
        busy={finalize.isPending}
      >
        <p>Finalizing removes the DRAFT label from exports and locks the narrative sections. You can reopen the report later.</p>
        {!!d.readiness.warnings && <Notice tone="warn">{d.readiness.warnings} warning(s) remain.</Notice>}
      </ConfirmDialog>
    </div>
  );
}
