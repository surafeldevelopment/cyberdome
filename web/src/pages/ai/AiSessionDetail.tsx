import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle2, ShieldAlert, XCircle, Link2, FileText } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { PageHeader, Panel, Notice, Loading, ErrorState, Field, KV, Badge, Provenance, Tabs } from '../../components/ui';
import { Modal, useToast } from '../../components/overlay';
import { Markdown, type CitationResolver } from '../../components/Markdown';
import { EvidenceChips } from '../../components/evidence';
import { CaptureButton } from '../../components/CaptureButton';
import { fmtDateTime, humanize } from '../../lib/format';
import { ReviewPill, type AiSessionDetail as Detail } from './shared';
import { KpiCard, KpiRow, AssetCell, StatusPill } from '../../components/kit';
import type { Engagement } from '../../lib/types';
import '../../styles/ai.css';

function CitationSummary({ s }: { s: Detail }) {
  const c = s.citations;
  const idOf = (code: string) => s.evidence.find((e) => e.code === code)?.id ?? null;
  const box = (label: string, codes: string[], render: (code: string) => JSX.Element, icon: JSX.Element, empty: string) => (
    <div className="cite-box">
      <div className="cb-head">{icon}<span>{label}</span><strong>{codes.length}</strong></div>
      <div className="chips">{codes.length ? codes.map(render) : <span className="faint small">{empty}</span>}</div>
    </div>
  );
  return (
    <div className="stack tight">
      <div className="cite-grid">
        {box('Valid: included in this request', c.valid ?? [], (code) => (idOf(code) ? <Link key={code} to={`/evidence/${idOf(code)}`} className="ev-chip">{code}</Link> : <span key={code} className="ev-chip">{code}</span>), <CheckCircle2 size={15} style={{ color: 'var(--ok)' }} aria-hidden />, 'none cited')}
        {box('Exists but was not sent', c.not_in_context ?? [], (code) => <span key={code} className="ev-chip invalid">{code}</span>, <AlertTriangle size={15} style={{ color: 'var(--warn)' }} aria-hidden />, 'none')}
        {box('Unknown ID (does not exist)', c.unknown ?? [], (code) => <span key={code} className="ev-chip invalid">{code}</span>, <XCircle size={15} style={{ color: 'var(--bad)' }} aria-hidden />, 'none')}
        {box('Sent but never cited', c.uncited_included ?? [], (code) => <span key={code} className="badge tone-muted mono">{code}</span>, <Link2 size={15} style={{ color: 'var(--text-3)' }} aria-hidden />, 'none')}
      </div>
      <Notice tone="warn">{s.citation_note}</Notice>
    </div>
  );
}

function MappingModal({ s, technique, onClose }: { s: Detail; technique: string | null; onClose: () => void }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<'finding' | 'timeline' | 'indicator'>('finding');
  const [target, setTarget] = useState('');
  const [rationale, setRationale] = useState('');
  const targets = useQuery({ queryKey: ['ai-targets', eid], queryFn: () => api.get<Record<string, { id: string; code: string; label: string }[]>>(`${base}/ai/mapping-targets`), enabled: !!technique });
  useEffect(() => { setTarget(''); }, [type, technique]);
  const m = useMutation({
    mutationFn: () => api.post(`${base}/ai/sessions/${s.id}/proposed-mapping`, { technique_id: technique, target_type: type, target_id: target, rationale }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-session', s.id] });
      toast.success(`Proposed ${technique}. Verify or reject it on the Attack Evidence page.`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = targets.data?.[type] ?? [];
  return (
    <Modal
      open={!!technique}
      onClose={onClose}
      title={`Create proposed mapping: ${technique}`}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!target || m.isPending} onClick={() => m.mutate()}>Create proposed mapping</button></>}
    >
      <div className="stack">
        <Notice tone="ai">The mapping is saved as <strong>proposed</strong> with origin “AI-suggested”. It stays out of the report until a team member verifies it against the evidence.</Notice>
        <div className="form-grid">
          <Field label="Record type" htmlFor="map-type">
            <select id="map-type" value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="finding">Finding</option>
              <option value="timeline">Timeline event</option>
              <option value="indicator">Indicator</option>
            </select>
          </Field>
          <Field label="Record" htmlFor="map-target">
            <select id="map-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{targets.isLoading ? 'Loading…' : list.length ? 'Choose a record' : 'No records of this type'}</option>
              {list.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.label?.slice(0, 80)}</option>)}
            </select>
          </Field>
          <Field label="Why the evidence supports this mapping" htmlFor="map-r" full>
            <textarea id="map-r" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Cite the Evidence IDs that show the behavior" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function ReviewPanel({ s }: { s: Detail }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [decision, setDecision] = useState<'verified' | 'verified_with_edits' | 'rejected'>('verified');
  const [notes, setNotes] = useState('');
  const [edited, setEdited] = useState(s.reviewed_text ?? s.response_text ?? '');
  const [reviewer, setReviewer] = useState('');
  const eng = useQuery({ queryKey: ['engagement', eid], queryFn: () => api.get<Engagement>(base) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, string>>('/api/settings') });
  useEffect(() => { if (!reviewer && settings.data?.analyst_name) setReviewer(settings.data.analyst_name); }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api.post(`${base}/ai/sessions/${s.id}/review`, { decision, notes, edited_text: decision === 'verified_with_edits' ? edited : undefined, reviewer: reviewer.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-session', s.id] });
      qc.invalidateQueries({ queryKey: ['ai-sessions', eid] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setNotes('');
      toast.success(decision === 'rejected' ? `${s.code} rejected.` : `${s.code} verified. It can now be used in the report.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (s.status !== 'completed') return null;
  return (
    <Panel title="Human Review" hint="Required before any of this text can be used">
      <div className="stack">
        <div className="btn-group" role="radiogroup" aria-label="Review decision">
          {([['verified', 'Verify as written'], ['verified_with_edits', 'Verify with edits'], ['rejected', 'Reject']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={decision === k} className={`btn sm ${decision === k ? 'on' : ''}`} onClick={() => setDecision(k)}>{l}</button>
          ))}
        </div>
        {decision === 'verified_with_edits' && (
          <Field label="Corrected text (this is what the report will use)" htmlFor="rv-edit">
            <textarea id="rv-edit" value={edited} onChange={(e) => setEdited(e.target.value)} rows={10} className="mono-input" />
          </Field>
        )}
        <Field label="Verification note (required)" htmlFor="rv-notes" help="Explain what you checked against which evidence, and what you corrected or rejected.">
          <textarea id="rv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Confirmed SSH failures and source IP against EV-004; removed claim about EV-009 which was not provided." />
        </Field>
        <Field label="Reviewer" htmlFor="rv-who" help="Self-declared identity. This local app has no login.">
          <input id="rv-who" list="team-names" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" />
          <datalist id="team-names">{(eng.data?.team ?? []).map((t) => <option key={t.id} value={t.name} />)}</datalist>
        </Field>
        <div className="row">
          <button className={`btn ${decision === 'rejected' ? 'danger' : 'primary'}`} disabled={notes.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            {decision === 'rejected' ? <XCircle /> : <CheckCircle2 />} Record review
          </button>
        </div>
        {!!s.reviews.length && (
          <div>
            <h3 style={{ marginBottom: 6 }}>Review history</h3>
            <ul className="list-plain small ai-review-history">
              {s.reviews.map((r) => (
                <li key={r.id}>
                  <StatusPill tone={r.decision === 'rejected' ? 'bad' : 'ok'}>{humanize(r.decision)}</StatusPill>
                  <span>
                    <span className="faint">{r.reviewer} · {fmtDateTime(r.created_at)}</span>
                    <span className="muted" style={{ display: 'block' }}>{r.notes}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function AiSessionDetail() {
  const { id = '' } = useParams();
  const { base } = useEngagement();
  const [mapTech, setMapTech] = useState<string | null>(null);
  const [view, setView] = useState('reviewed');
  const q = useQuery({ queryKey: ['ai-session', id], queryFn: () => api.get<Detail>(`${base}/ai/sessions/${id}`), enabled: !!base });
  const s = q.data;

  const resolve: CitationResolver = useMemo(() => {
    const valid = new Set(s?.citations.valid ?? []);
    const notIn = new Set(s?.citations.not_in_context ?? []);
    return (code) => {
      if (valid.has(code)) return { state: 'valid', id: s?.evidence.find((e) => e.code === code)?.id ?? undefined };
      if (notIn.has(code)) return { state: 'not_in_context' };
      return { state: 'unknown' };
    };
  }, [s]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!s) return null;
  const verified = ['verified', 'verified_with_edits'].includes(s.review_status);
  const hasEdits = s.review_status === 'verified_with_edits' && s.reviewed_text && s.reviewed_text !== s.response_text;
  const shown = hasEdits && view === 'reviewed' ? s.reviewed_text! : s.response_text ?? '';
  const latest = s.reviews[0];

  const flagged = (s.citations.not_in_context?.length ?? 0) + (s.citations.unknown?.length ?? 0);
  const knownAttack = s.attack_ids.filter((a) => a.status === 'known').length;
  const uncheckedAttack = s.attack_ids.filter((a) => a.status === 'unchecked').length;

  return (
    <div className="ai-detail">
      <PageHeader
        crumbs={[{ label: 'AI Security Analyst', to: '/ai' }, { label: s.code }]}
        title={<span className="row" style={{ gap: 12 }}>{s.task_label} <ReviewPill s={s} /></span>}
        subtitle={s.question ? <>Question: {s.question}</> : undefined}
        actions={<CaptureButton title="Evidence-grounded AI response" label="Capture view" />}
      />

      {s.status === 'failed' && (
        <Notice tone="bad" title="The AI request failed.">{s.error} No response text was stored. The request context below is kept for troubleshooting.</Notice>
      )}
      {s.status === 'completed' && !verified && s.review_status !== 'rejected' && (
        <div className="ai-draft-banner" role="note">
          <span className="ai-plug" aria-hidden><Bot size={18} /></span>
          <div>
            <strong>Unverified AI Draft</strong>
            <div className="small">Generated by {s.provider} / {s.model}. Check every claim against the cited evidence before using it. It cannot enter the report until a team member verifies it.</div>
          </div>
        </div>
      )}
      {verified && latest && (
        <Notice tone="ok" title={s.review_status === 'verified_with_edits' ? 'Verified with edits.' : 'Verified.'}>
          Reviewed by {latest.reviewer} on {fmtDateTime(latest.created_at)}. Note: “{latest.notes}”
        </Notice>
      )}
      {s.review_status === 'rejected' && latest && <Notice tone="warn" title="Rejected.">By {latest.reviewer}: “{latest.notes}”. This draft will not be used.</Notice>}

      <KpiRow>
        <KpiCard icon={<FileText />} label="Evidence sent" value={s.evidence.length} pill={{ text: `${(s.usage?.refused_evidence ?? []).length} withheld`, tone: 'neutral' }} calc="Evidence records included in the request context. Withheld items were selected but refused (not sanitized, withdrawn, or sensitive)." />
        <KpiCard icon={<CheckCircle2 />} label="Valid citations" value={s.status === 'completed' ? s.citations.valid?.length ?? 0 : '—'} pill={s.status === 'completed' ? { text: `${s.citations.total_mentions ?? 0} mentions`, tone: 'neutral' } : null} calc="Distinct Evidence IDs cited in the response that exist and were included in this request. A valid ID does not prove the evidence supports the statement." />
        <KpiCard icon={<AlertTriangle />} label="Flagged citations" value={s.status === 'completed' ? flagged : '—'} pill={s.status === 'completed' ? (flagged ? { text: 'Check before use', tone: 'bad' } : { text: 'None', tone: 'ok' }) : null} calc="Cited IDs that exist but were not sent, plus IDs that do not exist in this engagement." />
        <KpiCard icon={<ShieldAlert />} label="ATT&CK IDs mentioned" value={s.status === 'completed' ? s.attack_ids.length : '—'} pill={s.status === 'completed' ? (uncheckedAttack ? { text: `${uncheckedAttack} not checked`, tone: 'neutral' } : { text: `${knownAttack} in ATT&CK data`, tone: 'neutral' }) : null} calc="Technique IDs (T####) found in the response, checked against the cached MITRE ATT&CK data when it is loaded. Mentions are suggestions only." />
      </KpiRow>

      <div className="grid span-main">
        <div className="stack">
          {s.status === 'completed' && (
            <Panel
              title="Response"
              actions={verified ? <Provenance kind="verified" detail="Reviewed by a team member" /> : <Provenance kind="ai" />}
            >
              {hasEdits && (
                <Tabs label="Response version" value={view} onChange={setView} tabs={[{ id: 'reviewed', label: 'Reviewed text' }, { id: 'original', label: 'Original AI response' }]} />
              )}
              <div className={`ai-response ${verified ? 'verified' : ''}`}>
                <Markdown text={shown} resolve={resolve} />
              </div>
              {!!s.report_sections.length && (
                <p className="small muted" style={{ marginTop: 12 }}>
                  <FileText size={13} /> Used in report sections: {s.report_sections.map(humanize).join(', ')} · <Link to="/reports">Open report</Link>
                </p>
              )}
            </Panel>
          )}
          {s.status === 'completed' && (
            <Panel title="Citation Check" hint={`${s.citations.total_mentions ?? 0} Evidence ID mentions`}>
              <CitationSummary s={s} />
            </Panel>
          )}
          {s.status === 'completed' && (
            <Panel title="MITRE ATT&CK Suggestions" hint="Proposals only: a human must verify" flush={!!s.attack_ids.length} className="ai-attack">
              {!s.attack_ids.length ? (
                <p className="muted small" style={{ margin: 0 }}>No technique IDs were mentioned in this response.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data nowrap-cells">
                    <caption className="sr-only">ATT&amp;CK technique suggestions</caption>
                    <thead><tr><th>Technique</th><th>ATT&amp;CK data</th><th>Mappings</th><th className="act">Action</th></tr></thead>
                    <tbody>
                      {s.attack_ids.map((a) => {
                        const made = s.mappings.filter((m) => m.technique_id === a.id);
                        return (
                          <tr key={a.id}>
                            <td><AssetCell icon={<ShieldAlert />} title={<span className="mono">{a.id}</span>} sub={a.name ? `${a.name}${a.tactics ? ` · ${a.tactics}` : ''}` : 'Name unavailable. ATT&CK data not loaded'} /></td>
                            <td>
                              {a.status === 'known' && <StatusPill tone="info">Found</StatusPill>}
                              {a.status === 'unknown' && <StatusPill tone="bad">Not in ATT&amp;CK data</StatusPill>}
                              {a.status === 'unchecked' && <StatusPill tone="muted">Not checked</StatusPill>}
                            </td>
                            <td>{made.length ? made.map((m) => <Badge key={m.id} tone="ai">{humanize(m.status)}</Badge>) : <span className="faint">None</span>}</td>
                            <td className="act">
                              <button className="btn sm" disabled={a.status === 'unknown'} onClick={() => setMapTech(a.id)} title={a.status === 'unknown' ? 'Unknown technique IDs cannot be mapped' : 'Create a proposed mapping'}>
                                <Link2 /> Propose
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {s.attack_ids.some((a) => a.status === 'unchecked') && <p className="small faint" style={{ padding: '10px 22px 14px', margin: 0 }}>“Not checked” means the ATT&amp;CK reference data is not loaded (Settings → reference data).</p>}
                </div>
              )}
            </Panel>
          )}
          <Panel title="Exact Context Sent" hint="System rules and evidence, as transmitted">
            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>System prompt</summary>
              <pre className="code-block wrap" style={{ marginTop: 8 }}>{s.system_prompt}</pre>
            </details>
            <details style={{ marginTop: 10 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>User prompt with evidence ({s.user_prompt.length.toLocaleString()} characters)</summary>
              <pre className="code-block wrap" style={{ marginTop: 8 }}>{s.user_prompt}</pre>
            </details>
          </Panel>
        </div>
        <div className="stack">
          <ReviewPanel key={s.id + s.review_status} s={s} />
          <Panel title="Request Details">
            <KV
              items={[
                ['Session', <span className="mono">{s.code}</span>],
                ['Generated', fmtDateTime(s.created_at)],
                ['Requested by', s.created_by ?? '—'],
                ['Provider / model', `${s.provider} / ${s.model}`],
                ['Evidence sent', <EvidenceChips items={s.evidence.filter((e) => e.id).map((e) => ({ id: e.id!, code: e.code, status: e.status }))} />],
                ['Withheld', (s.usage?.refused_evidence ?? []).length ? <span className="mono small">{s.usage.refused_evidence.join(', ')}</span> : 'none'],
                ['Context SHA-256', <span className="mono small" style={{ wordBreak: 'break-all' }}>{s.context_sha256}</span>],
                ['Usage', s.usage?.input_tokens || s.usage?.prompt_tokens ? <span className="mono small">{JSON.stringify(Object.fromEntries(Object.entries(s.usage).filter(([k]) => k !== 'refused_evidence')))}</span> : '—'],
              ]}
            />
          </Panel>
        </div>
      </div>
      <MappingModal s={s} technique={mapTech} onClose={() => setMapTech(null)} />
    </div>
  );
}
