import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle2, Eye, FileText, Lock, PlugZap, Search, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { PageHeader, Panel, Notice, EmptyState, Loading, ErrorState, Field, SanitizationBadge, SourceBadge, Badge, HowCalculated } from '../../components/ui';
import { KpiCard, KpiRow, AssetCell, RowAction } from '../../components/kit';
import { Ring, PALETTE, type Segment } from '../../components/charts';
import { Drawer, useToast } from '../../components/overlay';
import { CaptureButton } from '../../components/CaptureButton';
import { fmtRelative } from '../../lib/format';
import { TASKS, ReviewPill, type AiSessionSummary } from './shared';
import { AskPanel } from './AskPanel';
import '../../styles/ai.css';

interface EligibleEvidence {
  id: string;
  code: string;
  title: string;
  status: string;
  kind: string;
  detected_type: string | null;
  source_category: string;
  source_tool: string;
  sanitization_status: string;
  eligible: boolean;
  reason: string | null;
  modules: string[];
}
interface AiStatusResp {
  ai: { state: string; provider: string; model: string | null; message?: string };
  setup: { summary: string; steps: string[]; env: string[] };
  policy: { note: string; excerpt_per_item_bytes: number; excerpt_total_bytes: number };
}
interface Preview {
  system: string;
  user: string;
  included: { id: string; code: string; title: string; sanitization_status: string; excerpt_bytes: number; excerpt_truncated: boolean }[];
  refused: { id: string; code: string; title: string; reason: string }[];
  chars: number;
  sha256: string;
  provider: string | null;
  model: string | null;
}

const GUARDRAILS: [string, string][] = [
  ['Selected, sanitized evidence only', 'Only items marked sanitized or no-sensitive-data are sent; nothing is sent automatically.'],
  ['Evidence is untrusted data', 'Evidence text is delimited; instructions inside logs or files are ignored.'],
  ['Citations are checked', 'Every cited Evidence ID is checked: it must exist and have been included.'],
  ['No autonomous actions', 'The AI cannot run commands or change records; ATT&CK ideas become proposals only when you choose.'],
  ['Human verification first', 'Drafts enter the report only after a team member verifies them with a note.'],
];

const MODULES: [string, string][] = [
  ['scan', 'Scan'],
  ['findings', 'Findings'],
  ['recon', 'Recon'],
  ['timeline', 'Timeline & logs'],
  ['indicators', 'Indicators'],
];

export function SetupInstructions({ setup }: { setup: AiStatusResp['setup'] }) {
  return (
    <div className="stack tight">
      <p className="muted small" style={{ margin: 0 }}>{setup.summary}</p>
      <ol className="ai-steps">
        {setup.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <Link className="btn primary sm" to="/settings#set-ai" style={{ alignSelf: 'flex-start' }}>Open AI settings</Link>
    </div>
  );
}

export default function AiPage() {
  const { base, eid } = useEngagement();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const [task, setTask] = useState(params.get('task') ?? 'assessment_summary');
  const [question, setQuestion] = useState('');
  const [excerpts, setExcerpts] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [showBlocked, setShowBlocked] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [historyFilter, setHistoryFilter] = useState('');

  const status = useQuery({ queryKey: ['ai-status', eid], queryFn: () => api.get<AiStatusResp>(`${base}/ai/status`) });
  const evidence = useQuery({ queryKey: ['ai-eligibility', eid], queryFn: () => api.get<EligibleEvidence[]>(`${base}/ai/eligibility`) });
  const sessions = useQuery({ queryKey: ['ai-sessions', eid], queryFn: () => api.get<AiSessionSummary[]>(`${base}/ai/sessions`) });

  // Prefill selection from ?evidence=EV-001,EV-002
  useEffect(() => {
    const pre = params.get('evidence');
    if (!pre || !evidence.data) return;
    const codes = pre.split(',').map((s) => s.trim().toUpperCase());
    setSelected(new Set(evidence.data.filter((e) => e.eligible && (codes.includes(e.code) || codes.includes(e.id.toUpperCase()))).map((e) => e.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence.data]);

  const all = evidence.data ?? [];
  const eligible = all.filter((e) => e.eligible);
  const blocked = all.filter((e) => !e.eligible && e.status === 'active');
  const visible = useMemo(
    () => (showBlocked ? [...eligible, ...blocked] : eligible).filter((e) => !filter || `${e.code} ${e.title} ${e.source_tool}`.toLowerCase().includes(filter.toLowerCase())),
    [eligible, blocked, showBlocked, filter],
  );
  const connected = status.data?.ai.state === 'configured';
  const body = () => ({ task, evidence_ids: [...selected], question: question.trim() || undefined, include_file_excerpts: excerpts });

  const previewM = useMutation({
    mutationFn: () => api.post<Preview>(`${base}/ai/context-preview`, body()),
    onSuccess: (p) => setPreview(p),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const generate = useMutation({
    mutationFn: () => api.post<{ id: string; code: string }>(`${base}/ai/sessions`, body()),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['ai-sessions', eid] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`${s.code} generated. It is an unverified AI draft until a team member reviews it.`);
      nav(`/ai/${s.id}`);
    },
    onError: (e: any) => {
      const sid = e?.details?.session_id;
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: ['ai-sessions', eid] });
      if (sid) nav(`/ai/${sid}`);
    },
  });

  const toggle = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };
  const quick = (m: string | null) => setSelected(new Set(eligible.filter((e) => !m || e.modules.includes(m)).map((e) => e.id)));
  const needQuestion = task === 'custom' && !question.trim();
  const history = (sessions.data ?? []).filter((s) => !historyFilter || (historyFilter === 'verified' ? ['verified', 'verified_with_edits'].includes(s.review_status) : s.review_status === historyFilter));

  const sess = sessions.data ?? [];
  const counts = {
    unverified: sess.filter((x) => x.status === 'completed' && x.review_status === 'unverified').length,
    verified: sess.filter((x) => x.review_status === 'verified').length,
    edits: sess.filter((x) => x.review_status === 'verified_with_edits').length,
    rejected: sess.filter((x) => x.review_status === 'rejected').length,
    failed: sess.filter((x) => x.status === 'failed').length,
  };
  const activeCount = all.filter((e) => e.status === 'active').length;
  const ringSegs: Segment[] = [
    { key: 'unverified', label: 'Unverified drafts', value: counts.unverified, color: PALETTE.amber, onClick: () => setHistoryFilter('unverified') },
    { key: 'verified', label: 'Verified', value: counts.verified + counts.edits, color: PALETTE.green, onClick: () => setHistoryFilter('verified') },
    { key: 'rejected', label: 'Rejected', value: counts.rejected, color: PALETTE.red, onClick: () => setHistoryFilter('rejected') },
    { key: 'failed', label: 'Failed requests', value: counts.failed, color: PALETTE.grey },
  ];
  const providerLabel = connected ? `Powered by ${status.data?.ai.provider} · ${status.data?.ai.model}` : status.data ? 'AI provider not configured' : 'Checking provider…';

  return (
    <div className="ai-page">
      <PageHeader
        title="AI Security Analyst"
        subtitle="Ask general security questions with no evidence, or have the AI analyze sanitized evidence you select. Evidence-based answers must cite Evidence IDs, and every answer stays an unverified draft until a team member reviews it."
        actions={<CaptureButton title="AI Analyst page" label="Capture view" />}
      />

      <KpiRow>
        <KpiCard
          icon={<ShieldCheck />}
          label="Eligible sanitized evidence"
          value={evidence.data ? eligible.length : '—'}
          pill={evidence.data ? { text: `of ${activeCount} active`, tone: 'neutral' } : null}
          to="/evidence?sanitization_status=not_reviewed"
          calc="Active evidence whose sanitization status is “sanitized” or “no sensitive data”. Only these items can be sent to the AI provider. Click to review items still awaiting sanitization review."
        />
        <KpiCard
          icon={<Bot />}
          label="Unverified AI drafts"
          value={sessions.data ? counts.unverified : '—'}
          pill={sessions.data ? (counts.unverified ? { text: 'Needs review', tone: 'warn' } : { text: 'None pending', tone: 'ok' }) : null}
          onClick={() => setHistoryFilter('unverified')}
          calc="Completed AI responses that no team member has reviewed yet. They cannot enter the report."
        />
        <KpiCard
          icon={<CheckCircle2 />}
          label="Human-verified drafts"
          value={sessions.data ? counts.verified + counts.edits : '—'}
          pill={sessions.data ? { text: `${counts.edits} with edits`, tone: 'ok' } : null}
          onClick={() => setHistoryFilter('verified')}
          calc="AI responses a named reviewer verified with a verification note, either as written or with edits. Only these can be inserted into report sections."
        />
        <KpiCard
          icon={<XCircle />}
          label="Rejected drafts"
          value={sessions.data ? counts.rejected : '—'}
          pill={sessions.data ? { text: `${counts.failed} failed request${counts.failed === 1 ? '' : 's'}`, tone: counts.failed ? 'bad' : 'neutral' } : null}
          onClick={() => setHistoryFilter('rejected')}
          calc="Responses a reviewer rejected. Failed requests (provider errors) store no response text and are counted separately."
        />
      </KpiRow>

      {status.isLoading && <Loading rows={1} />}
      {status.data && !connected && (
        <Panel
          className="ai-disconnected"
          title={<span className="row" style={{ gap: 10 }}><span className="ai-plug" aria-hidden><PlugZap size={18} /></span> AI provider disconnected</span>}
          actions={<span className={`pill ${status.data.ai.state === 'misconfigured' ? 'bad' : 'warn'}`}><span>{status.data.ai.state === 'misconfigured' ? 'Configuration error' : 'Not configured'}</span></span>}
        >
          <Notice tone={status.data.ai.state === 'misconfigured' ? 'bad' : 'warn'}>
            {status.data.ai.message ?? 'No AI provider is configured.'} You can still select evidence and preview exactly what would be sent. Generating responses is unavailable. CyberDome never substitutes pre-written text for model output.
          </Notice>
          <div style={{ marginTop: 14 }}>
            <SetupInstructions setup={status.data.setup} />
          </div>
        </Panel>
      )}

      <AskPanel connected={!!connected} />

      <div className="grid span-main ai-row">
        <Panel
          title="Evidence-grounded analysis"
          className="ai-new"
          actions={
            <>
              <span className={`ai-powered ${connected ? '' : 'off'}`} title={connected ? 'Configured on the server' : 'Connect a provider in Settings'}>
                <Sparkles size={14} aria-hidden /> {providerLabel}
              </span>
            </>
          }
        >
          <div className="stack">
            <Field label="Task" htmlFor="ai-task">
              <select id="ai-task" value={task} onChange={(e) => setTask(e.target.value)}>
                {TASKS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.lab ? `${t.lab} · ` : ''}
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={task === 'custom' ? 'Question (required)' : 'Additional question or focus (optional)'} htmlFor="ai-q">
              <textarea id="ai-q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Focus on the SSH service on the web server" rows={3} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={excerpts} onChange={(e) => setExcerpts(e.target.checked)} />
              Include raw file excerpts for text evidence (first {Math.round((status.data?.policy.excerpt_per_item_bytes ?? 6144) / 1024)} KB each)
            </label>
            <div className="ai-actions" data-no-capture="true">
              <span className="ai-sel">
                <strong>{selected.size}</strong> evidence selected
              </span>
              <button className="btn" onClick={() => previewM.mutate()} disabled={!selected.size || needQuestion || previewM.isPending}>
                {previewM.isPending ? <span className="spinner" /> : <Eye />} Preview context
              </button>
              <button
                className="btn primary"
                onClick={() => generate.mutate()}
                disabled={!connected || !selected.size || needQuestion || generate.isPending}
                title={!connected ? 'Configure an AI provider on the server to generate responses' : undefined}
              >
                {generate.isPending ? <span className="spinner" /> : <Sparkles />} {generate.isPending ? 'Waiting for the model…' : 'Generate draft'}
              </button>
            </div>
            {(needQuestion || (!connected && status.data) || !selected.size) && (
              <p className="small faint" style={{ margin: 0 }}>
                {needQuestion ? 'Enter a question for a custom analysis. ' : ''}
                {!selected.size ? 'Select evidence below to preview or generate. ' : ''}
                {!connected && status.data ? 'Generation needs a configured provider.' : ''}
              </p>
            )}
          </div>
        </Panel>
        <Panel title="AI Drafts" hint="By Review Status" actions={<HowCalculated text="All AI sessions in this engagement grouped by review state. Click a legend row to filter the history table." />}>
          {sess.length ? (
            <Ring segments={ringSegs} center={sess.length} sub="Sessions" size={180} ariaLabel="AI sessions by review status" />
          ) : (
            <EmptyState icon={<Bot />} title="No AI sessions yet">Generated drafts and their review status appear here.</EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid span-main ai-row">
        <Panel
          title="Evidence to Send"
          hint={`${selected.size} selected · ${eligible.length} eligible`}
          actions={
            <span className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => quick(null)} disabled={!eligible.length}>All eligible</button>
              <button className="btn sm ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear</button>
            </span>
          }
          flush
        >
          <div className="filters ai-filters">
            <div className="search-box ai-search">
              <Search aria-hidden />
              <input type="search" placeholder="Filter evidence" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter evidence" />
            </div>
            {MODULES.map(([m, label]) => {
              const n = eligible.filter((e) => e.modules.includes(m)).length;
              return (
                <button key={m} className="btn sm" disabled={!n} onClick={() => quick(m)} title={`Select all eligible ${label.toLowerCase()} evidence`}>
                  {label} <span className="faint">{n}</span>
                </button>
              );
            })}
            <label className="check small" style={{ marginLeft: 'auto' }}>
              <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} /> Show blocked ({blocked.length})
            </label>
          </div>
          {evidence.isLoading && <div style={{ padding: 20 }}><Loading /></div>}
          {evidence.error && <div style={{ padding: 20 }}><ErrorState error={evidence.error} retry={() => evidence.refetch()} /></div>}
          {evidence.data && !all.length && (
            <EmptyState title="No evidence yet" icon={<Lock />} actions={<Link to="/evidence?upload=1" className="btn">Add evidence</Link>}>
              The analyst can only work from evidence in the Evidence Locker. Import or upload your lab evidence first.
            </EmptyState>
          )}
          {evidence.data && !!all.length && !eligible.length && (
            <div style={{ padding: '0 20px 16px' }}>
              <Notice tone="warn" title="No evidence is eligible yet.">
                Only active evidence reviewed as “sanitized” or “no sensitive data” can be sent. Review sanitization in the <Link to="/evidence?sanitization_status=not_reviewed">Evidence Locker</Link>.
              </Notice>
            </div>
          )}
          {!!visible.length && (
            <div className="table-wrap ai-evtable">
              <table className="data">
                <caption className="sr-only">Evidence that can be sent to the AI provider</caption>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}><span className="sr-only">Select</span></th>
                    <th>Evidence</th>
                    <th>Source</th>
                    <th>Sanitization</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.id} className={`${e.eligible ? 'clickable' : 'blocked'} ${selected.has(e.id) ? 'selected' : ''}`} onClick={(ev) => { if ((ev.target as HTMLElement).closest('input,a')) return; if (e.eligible) toggle(e.id); }}>
                      <td>
                        <input type="checkbox" disabled={!e.eligible} checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.code}`} />
                      </td>
                      <td>
                        <AssetCell
                          icon={<FileText />}
                          title={e.title}
                          sub={<><span className="mono">{e.code}</span>{e.modules.length ? ` · ${e.modules.join(', ')}` : ''}{!e.eligible && e.reason ? <span className="ai-reason"> · {e.reason}</span> : null}</>}
                        />
                      </td>
                      <td className="nowrap"><SourceBadge value={e.source_category} /></td>
                      <td className="nowrap"><SanitizationBadge value={e.sanitization_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title={<span className="row" style={{ gap: 8 }}><ShieldCheck size={18} /> Guardrails</span>}>
          <ol className="ai-guard">
            {GUARDRAILS.map((g, i) => (
              <li key={i} className="num-row ai-guard-row">
                <span className="n" aria-hidden>{i + 1}</span>
                <span className="t"><strong>{g[0]}</strong><span>{g[1]}</span></span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel
        title="Analysis History"
        flush
        className="ai-history-panel"
        actions={
          <select className="select-pill" aria-label="Filter history by review status" value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)}>
            <option value="">All review states</option>
            <option value="unverified">Unverified</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
        }
      >
        {sessions.isLoading && <div style={{ padding: 20 }}><Loading /></div>}
        {sessions.error && <div style={{ padding: 20 }}><ErrorState error={sessions.error} retry={() => sessions.refetch()} /></div>}
        {sessions.data && !history.length && (
          <EmptyState title={sess.length ? 'No sessions match this filter' : 'No AI analyses yet'} icon={<Bot />}>
            {sess.length ? 'Choose another review state.' : 'Generated drafts appear here with their review status.'}
          </EmptyState>
        )}
        {!!history.length && (
          <div className="table-wrap">
            <table className="data nowrap-cells">
              <caption className="sr-only">AI analysis history</caption>
              <thead>
                <tr>
                  <th>Analysis</th>
                  <th>Evidence sent</th>
                  <th>Citations</th>
                  <th>Provider / model</th>
                  <th>Review status</th>
                  <th className="act">Action</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => {
                  const flagged = (s.citations.not_in_context?.length ?? 0) + (s.citations.unknown?.length ?? 0);
                  return (
                    <tr key={s.id} className="clickable" onClick={() => nav(`/ai/${s.id}`)}>
                      <td>
                        <AssetCell icon={<Bot />} to={`/ai/${s.id}`} title={s.task_label} sub={<><span className="mono">{s.code}</span> · {fmtRelative(s.created_at)}</>} />
                      </td>
                      <td>{s.evidence_codes.length}</td>
                      <td>
                        {s.status === 'failed' ? <span className="faint">—</span> : (
                          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <span className="alert-count"><CheckCircle2 style={{ color: 'var(--ok)' }} aria-hidden /> {s.citations.valid?.length ?? 0} valid</span>
                            {flagged > 0 && <span className="alert-count"><AlertTriangle style={{ color: 'var(--warn)' }} aria-hidden /> {flagged} flagged</span>}
                          </span>
                        )}
                      </td>
                      <td className="muted">{s.provider} · {s.model}</td>
                      <td><ReviewPill s={s} /></td>
                      <td className="act"><RowAction to={`/ai/${s.id}`} label={`Open ${s.code}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Drawer
        open={!!preview}
        onClose={() => setPreview(null)}
        title="Context preview"
        subtitle={preview ? `${preview.included.length} records · ${preview.chars.toLocaleString()} characters · ${preview.provider ? `${preview.provider} / ${preview.model}` : 'no provider configured'}` : undefined}
        footer={
          <>
            <button className="btn ghost" onClick={() => setPreview(null)}>Close</button>
            <button className="btn primary" disabled={!connected || generate.isPending} onClick={() => { setPreview(null); generate.mutate(); }}>
              <Sparkles /> Send this context
            </button>
          </>
        }
      >
        {preview && (
          <div className="stack">
            <Notice tone="info">This is exactly what will be sent to the provider. Context SHA-256: <span className="mono">{preview.sha256.slice(0, 16)}…</span></Notice>
            <div>
              <h3 style={{ marginBottom: 6 }}>Included evidence</h3>
              <div className="chips">
                {preview.included.map((i) => (
                  <span key={i.id} className="ev-chip" title={i.title}>{i.code}{i.excerpt_bytes ? ` +${Math.round(i.excerpt_bytes / 1024)}KB${i.excerpt_truncated ? '…' : ''}` : ''}</span>
                ))}
              </div>
            </div>
            {!!preview.refused.length && (
              <div>
                <h3 style={{ marginBottom: 6 }}>Not sent</h3>
                <ul className="list-plain small">
                  {preview.refused.map((r) => (
                    <li key={r.id}><span className="mono">{r.code}</span> · {r.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>System prompt (application rules)</summary>
              <pre className="code-block wrap" style={{ marginTop: 8 }}>{preview.system}</pre>
            </details>
            <div>
              <h3 style={{ marginBottom: 6 }}>User prompt with evidence</h3>
              <pre className="code-block wrap">{preview.user}</pre>
            </div>
            <Badge tone="muted">Nothing has been sent yet.</Badge>
          </div>
        )}
      </Drawer>
    </div>
  );
}
