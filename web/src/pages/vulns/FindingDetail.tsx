import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ExternalLink, Gauge, Globe, Plus, RefreshCw, Save, Search, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtDate, fmtDateTime, humanize } from '../../lib/format';
import {
  Badge, EmptyState, ErrorState, Field, KV, Loading, Notice, PageHeader, Panel, Provenance, SEV_ORDER, SeverityBadge, ValidationBadge,
} from '../../components/ui';
import { EvidencePicker } from '../../components/evidence';
import { CaptureButton } from '../../components/CaptureButton';
import { ConfirmDialog, useToast } from '../../components/overlay';
import { FACTORS, STATUS_LABEL, VALIDATION_HELP, ValidationPill, factorTotal, useAssets, useServices, type FindingDetailData } from './shared';
import { KpiCard, KpiRow, StatusPill } from '../../components/kit';
import '../../styles/vulns.css';

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;

export default function FindingDetail() {
  const { id = '' } = useParams();
  const { base, eid } = useEngagement();
  const q = useQuery({ queryKey: ['finding', eid, id], queryFn: () => api.get<FindingDetailData>(`${base}/findings/${id}`), enabled: !!eid && id !== 'new', retry: 0 });
  if (id === 'new') return <FindingEditor finding={null} />;
  if (q.isLoading) return <Loading label="Loading finding" />;
  if (q.isError)
    return (
      <>
        <PageHeader title="Finding" crumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: id }]} />
        <ErrorState error={q.error} retry={() => q.refetch()} />
      </>
    );
  return <FindingEditor key={q.data!.id + q.data!.updated_at} finding={q.data!} />;
}

interface FormState {
  title: string;
  description: string;
  severity: string;
  cves: string;
  cvss_score: string;
  cvss_version: string;
  cvss_vector: string;
  cvss_source: string;
  impact: string;
  remediation: string;
  owner: string;
  status: string;
  retest_notes: string;
  priority_rationale: string;
  asset_ids: string[];
  service_ids: string[];
  evidence_ids: string[];
  factors: Record<string, number | null>;
}

function toForm(f: FindingDetailData | null): FormState {
  return {
    title: f?.title ?? '',
    description: f?.description ?? '',
    severity: f?.severity ?? 'medium',
    cves: (f?.cves ?? []).join(', '),
    cvss_score: f?.cvss_score !== null && f?.cvss_score !== undefined ? String(f.cvss_score) : '',
    cvss_version: f?.cvss_version ?? '',
    cvss_vector: f?.cvss_vector ?? '',
    cvss_source: f?.cvss_source ?? '',
    impact: f?.impact ?? '',
    remediation: f?.remediation ?? '',
    owner: f?.owner ?? '',
    status: f?.status ?? 'open',
    retest_notes: f?.retest_notes ?? '',
    priority_rationale: f?.priority_rationale ?? '',
    asset_ids: f?.assets.map((a) => a.id) ?? [],
    service_ids: f?.services.map((s) => s.id) ?? [],
    evidence_ids: f?.evidence.map((e) => e.id) ?? [],
    factors: Object.fromEntries(FACTORS.map((x) => [x.key, (f?.[x.key] as number | null) ?? null])),
  };
}

function FindingEditor({ finding }: { finding: FindingDetailData | null }) {
  const { base } = useEngagement();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(finding));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(finding));

  const cveList = form.cves.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
  const badCves = cveList.filter((c) => !CVE_RE.test(c));
  const score = form.cvss_score.trim() === '' ? null : Number(form.cvss_score);
  const badScore = score !== null && (Number.isNaN(score) || score < 0 || score > 10);
  const canSave = !!form.title.trim() && !badCves.length && !badScore;

  const save = useMutation({
    mutationFn: () => {
      const body: any = {
        title: form.title.trim(), description: form.description, severity: form.severity, cves: cveList,
        cvss_score: score, cvss_version: form.cvss_version || null, cvss_vector: form.cvss_vector.trim() || null, cvss_source: form.cvss_source.trim() || null,
        impact: form.impact, remediation: form.remediation, owner: form.owner, status: form.status, retest_notes: form.retest_notes,
        priority_rationale: form.priority_rationale, asset_ids: form.asset_ids, service_ids: form.service_ids, evidence_ids: form.evidence_ids, ...form.factors,
      };
      return finding ? api.patch<FindingDetailData>(`${base}/findings/${finding.id}`, body) : api.post<FindingDetailData>(`${base}/findings`, body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast.success(finding ? `Saved ${r.code}.` : `Created ${r.code}.`);
      if (!finding) nav(`/vulnerabilities/${r.id}`, { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del(`${base}/findings/${finding!.id}`, { confirm: finding!.code }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success(`Deleted ${finding!.code}. Linked evidence was kept.`);
      nav('/vulnerabilities');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const saveButton = (
    <button className="btn primary" disabled={!canSave || !dirty || save.isPending} onClick={() => save.mutate()}>
      {save.isPending ? <span className="spinner" /> : <Save />} {finding ? 'Save changes' : 'Create finding'}
    </button>
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: finding?.code ?? 'New finding' }]}
        title={finding ? <span><span className="fd-title-code">{finding.code}</span>{finding.title}</span> : 'New finding'}
        subtitle={
          finding ? (
            <span className="row" style={{ gap: 6 }}>
              {finding.priority_rank && <Badge tone="accent">Priority #{finding.priority_rank}</Badge>}
              <Provenance kind={finding.origin === 'import' ? 'imported' : 'entered'} detail={finding.origin === 'import' ? `Imported via ${finding.import?.code ?? 'report import'}` : 'Recorded manually by an analyst'} />
              <span className="faint small">{finding.origin === 'import' ? `via ${finding.import?.code ?? 'report import'}` : 'recorded manually'}</span>
            </span>
          ) : (
            'Record a finding from your own authorized analysis. It starts as “Potential (requires verification)” until you validate it against evidence.'
          )
        }
        actions={
          <>
            {finding && <CaptureButton title={`Finding ${finding.code}`} />}
            {finding && (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </button>
            )}
            {saveButton}
          </>
        }
      />
      {finding && (
        <div className="fd-kpis">
          <KpiRow>
            <KpiCard icon={<ShieldAlert />} label="Severity" value={humanize(finding.severity)} pill={{ text: finding.severity_basis === 'scanner' ? 'Scanner basis' : finding.severity_basis === 'cvss' ? 'CVSS basis' : 'Analyst basis', tone: 'neutral' }} calc="Saved severity of this finding and where it came from (scanner report, CVSS score, or analyst judgement)." />
            <KpiCard icon={<Gauge />} label="CVSS score" value={finding.cvss_score !== null ? finding.cvss_score.toFixed(1) : '—'} pill={finding.cvss_score !== null ? { text: `${finding.cvss_version ? 'v' + finding.cvss_version : 'version n/a'}${finding.cvss_source ? ' · ' + finding.cvss_source.slice(0, 18) : ''}`, tone: 'neutral' } : { text: 'Not recorded', tone: 'neutral' }} calc="CVSS base score saved on this finding, with its version and source. It describes the vulnerability in general, not this asset's exposure." />
            <KpiCard icon={<ShieldCheck />} label="Validation" value={finding.validation_status === 'validated' ? 'Validated' : finding.validation_status === 'false_positive' ? 'False positive' : finding.validation_status === 'potential' ? 'Potential' : 'Scanner-reported'} pill={finding.validated_by ? { text: `by ${finding.validated_by}`, tone: finding.validation_status === 'validated' ? 'ok' : 'neutral' } : { text: 'Needs review', tone: 'warn' }} calc="Current validation state and who recorded the decision. Validation requires linked active evidence and written notes." />
            <KpiCard icon={<Activity />} label="Status" value={STATUS_LABEL[finding.status]} pill={{ text: `${finding.tasks.filter((t) => t.status === 'done').length}/${finding.tasks.length} tasks done`, tone: finding.status === 'remediated' ? 'ok' : 'neutral' }} calc="Remediation status of this finding and how many of its remediation tasks are marked done." />
          </KpiRow>
        </div>
      )}
      {dirty && finding && <div className="unsaved-bar" data-no-capture="true"><span>Unsaved changes</span> <button className="btn ghost sm" onClick={() => setForm(toForm(finding))}>Discard</button> {saveButton}</div>}

      <div className="grid span-main">
        <div className="stack">
          <Panel title="Finding details">
            <div className="form-grid">
              <Field label="Title" htmlFor="f-title" full error={!form.title.trim() ? 'A title is required.' : undefined}>
                <input id="f-title" value={form.title} onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label="Severity" htmlFor="f-sev" help={finding ? `Basis: ${finding.severity_basis === 'scanner' ? 'scanner-reported severity' : finding.severity_basis === 'cvss' ? 'CVSS score' : 'analyst judgement'}. Changing it records an analyst judgement.` : 'Your judgement of severity for this lab.'}>
                <select id="f-sev" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                  {SEV_ORDER.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </select>
              </Field>
              <Field label="Status" htmlFor="f-status">
                <select id="f-status" value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Description" htmlFor="f-desc" full>
                <textarea id="f-desc" rows={6} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What was observed, on which service, and how it was detected." />
              </Field>
              <Field label="Potential impact" htmlFor="f-impact" full>
                <textarea id="f-impact" rows={3} value={form.impact} onChange={(e) => set('impact', e.target.value)} placeholder="What could happen to CyberDome if this were exploited." />
              </Field>
              <Field label="Remediation" htmlFor="f-rem" full>
                <textarea id="f-rem" rows={3} value={form.remediation} onChange={(e) => set('remediation', e.target.value)} placeholder="Defensive fix or mitigation." />
              </Field>
              <Field label="Owner" htmlFor="f-owner">
                <input id="f-owner" value={form.owner} onChange={(e) => set('owner', e.target.value)} placeholder="Who is responsible for the fix" />
              </Field>
              <Field label="CVE identifiers" htmlFor="f-cves" help="Comma-separated. A CVE match alone does not confirm the asset is vulnerable." error={badCves.length ? `Not a CVE ID: ${badCves.join(', ')}` : undefined}>
                <input id="f-cves" className="mono-input" value={form.cves} onChange={(e) => set('cves', e.target.value)} placeholder="CVE-2021-41617" />
              </Field>
              <Field label="CVSS score" htmlFor="f-cvss" error={badScore ? 'Enter a number from 0 to 10.' : undefined}>
                <input id="f-cvss" type="number" step="0.1" min={0} max={10} value={form.cvss_score} onChange={(e) => set('cvss_score', e.target.value)} />
              </Field>
              <Field label="CVSS version" htmlFor="f-cvssv">
                <select id="f-cvssv" value={form.cvss_version} onChange={(e) => set('cvss_version', e.target.value)}>
                  <option value="">Not specified</option>
                  {['4.0', '3.1', '3.0', '2.0'].map((v) => <option key={v} value={v}>CVSS v{v}</option>)}
                </select>
              </Field>
              <Field label="CVSS vector" htmlFor="f-vec" full>
                <input id="f-vec" className="mono-input" value={form.cvss_vector} onChange={(e) => set('cvss_vector', e.target.value)} placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N" />
              </Field>
              <Field label="CVSS source" htmlFor="f-cvsss" full help="Where the score came from (scanner name, NVD with retrieval date, or analyst).">
                <input id="f-cvsss" value={form.cvss_source} onChange={(e) => set('cvss_source', e.target.value)} />
              </Field>
            </div>
          </Panel>

          <AffectedPicker assetIds={form.asset_ids} serviceIds={form.service_ids} onAssets={(v) => set('asset_ids', v)} onServices={(v) => set('service_ids', v)} />

          <Panel title="Supporting evidence">
            <EvidencePicker
              value={form.evidence_ids}
              onChange={(v) => set('evidence_ids', v)}
              label="Evidence IDs"
              help="Link the scanner output, screenshots, or command output that supports this finding. Validation requires at least one active evidence item."
            />
          </Panel>

          <Panel title="Prioritization inputs" actions={finding?.priority_rank ? <Link className="btn sm" to="/vulnerabilities?tab=priorities">Rank #{finding.priority_rank}. Edit ranking</Link> : <Link className="btn sm" to="/vulnerabilities?tab=priorities">Open top-three ranking</Link>}>
            <div className="factor-grid">
              {FACTORS.map((x) => (
                <Field key={x.key} label={x.label} htmlFor={`fx-${x.key}`} help={x.help}>
                  <select id={`fx-${x.key}`} value={form.factors[x.key] ?? ''} onChange={(e) => set('factors', { ...form.factors, [x.key]: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">Not rated</option>
                    {x.scale.map((lbl, n) => <option key={n} value={n}>{n} · {lbl}</option>)}
                  </select>
                </Field>
              ))}
              <div className="field">
                <span className="label">Factor total (analyst inputs)</span>
                <span className="mono big-num">{(() => { const t = factorTotal(form.factors as any); return t.filled ? `${t.total} / ${t.filled * 3}` : '—'; })()}</span>
                <span className="help">A plain sum of your ratings, not a security score.</span>
              </div>
            </div>
            <Field label="Prioritization rationale" htmlFor="f-rat" full>
              <textarea id="f-rat" rows={3} value={form.priority_rationale} onChange={(e) => set('priority_rationale', e.target.value)} placeholder="Why this finding should (or should not) be addressed first." />
            </Field>
          </Panel>

          <Panel title="Retest notes">
            <Field label="Retest notes" htmlFor="f-retest" help="After remediation, record how the fix was verified (command, date, evidence ID).">
              <textarea id="f-retest" rows={3} value={form.retest_notes} onChange={(e) => set('retest_notes', e.target.value)} />
            </Field>
          </Panel>
          <div className="row" style={{ justifyContent: 'flex-end' }}>{saveButton}</div>
        </div>

        <div className="stack">
          {finding ? (
            <>
              <ValidationPanel finding={finding} dirty={dirty} />
              <ReferencePanel cves={finding.cves} onApply={(m) => setForm((f) => ({ ...f, cvss_score: String(m.base_score ?? ''), cvss_version: m.version, cvss_vector: m.vector, cvss_source: `NVD (${m.source}, ${m.type}) retrieved ${fmtDate(m.retrieved_at)}` }))} />
              <TasksPanel finding={finding} />
              <Panel title="ATT&CK mappings" hint="Read-only here">
                {finding.attack_mappings.length ? (
                  <ul className="list-plain small">
                    {finding.attack_mappings.map((m) => (
                      <li key={m.id}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="mono">{m.technique_id}</span> {m.technique_name}
                          <StatusPill tone={m.status === 'verified' ? 'ok' : m.status === 'rejected' ? 'muted' : 'warn'}>{humanize(m.status)}</StatusPill>
                          {m.origin === 'ai_suggested' && <Provenance kind="ai" />}
                        </div>
                        {m.rationale && <div className="faint tiny">{m.rationale}</div>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No ATT&CK mappings. Map techniques only when the evidence supports them (Attack Evidence → mappings).</p>
                )}
              </Panel>
              <Panel title="Origin">
                <KV
                  items={[
                    ['Recorded', finding.origin === 'import' ? 'Imported from a report' : 'Entered by an analyst'],
                    ...(finding.import ? ([[
                      'Import', <span key="i"><span className="mono">{finding.import.code}</span> · {humanize(finding.import.format)} · <Link className="ev-chip" to={`/evidence/${finding.import.evidence_id}`}>{finding.import.evidence_code}</Link></span>,
                    ]] as [any, any][]) : []),
                    ...(finding.scanner_name ? ([['Scanner', `${finding.scanner_name}${finding.scanner_plugin_id ? ` · plugin ${finding.scanner_plugin_id}` : ''}`]] as [any, any][]) : []),
                    ['Created', fmtDateTime(finding.created_at)],
                    ['Updated', fmtDateTime(finding.updated_at)],
                  ]}
                />
              </Panel>
              <Panel title="Review history">
                {finding.reviews.length ? (
                  <ul className="list-plain small">
                    {finding.reviews.map((r) => (
                      <li key={r.id}>
                        <div className="row" style={{ gap: 6 }}>
                          <strong>{humanize(r.decision.replace(':', ' → '))}</strong>
                          <span className="faint">by {r.reviewer} · {fmtDateTime(r.created_at)}</span>
                        </div>
                        {r.notes && <div className="muted">{r.notes}</div>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No validation or status decisions recorded yet.</p>
                )}
              </Panel>
            </>
          ) : (
            <Notice title="After creating the finding">you can validate it against evidence, look up CVE reference data, add remediation tasks, and include it in the top-three ranking.</Notice>
          )}
        </div>
      </div>
      {finding && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => del.mutate()}
          busy={del.isPending}
          title={`Delete ${finding.code}?`}
          confirmLabel="Delete finding"
          requireText={finding.code}
        >
          <p className="muted">The finding, its remediation tasks, and its ATT&CK mappings are removed. Linked evidence stays in the Evidence Locker. The ID {finding.code} will not be reused.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/* ---------- Affected assets / services ---------- */
function AffectedPicker({ assetIds, serviceIds, onAssets, onServices }: { assetIds: string[]; serviceIds: string[]; onAssets: (v: string[]) => void; onServices: (v: string[]) => void }) {
  const assets = useAssets();
  const services = useServices();
  const [q, setQ] = useState('');
  const svc = useMemo(
    () => (services.data ?? []).filter((s) => !q || `${s.asset_code} ${s.ip} ${s.port}/${s.protocol} ${s.service_name ?? ''} ${s.product ?? ''}`.toLowerCase().includes(q.toLowerCase())),
    [services.data, q],
  );
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const loading = assets.isLoading || services.isLoading;
  return (
    <Panel title="Affected assets and services" hint={`${assetIds.length} assets · ${serviceIds.length} services`}>
      {loading && <Loading rows={2} />}
      {(assets.isError || services.isError) && <ErrorState error={assets.error ?? services.error} />}
      {!loading && !assets.data?.length && (
        <EmptyState title="No assets in the inventory yet" actions={<Link className="btn sm" to="/scan?tab=import">Import scan results</Link>}>
          Assets come from scan imports in Scan & Enumeration. Findings can be saved without an asset, but Lab 4 requires the affected asset.
        </EmptyState>
      )}
      {!!assets.data?.length && (
        <div className="stack tight">
          <div className="pick-list" role="group" aria-label="Affected assets">
            {assets.data.map((a) => (
              <label key={a.id} className={`pick ${assetIds.includes(a.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={assetIds.includes(a.id)} onChange={() => onAssets(toggle(assetIds, a.id))} />
                <span className="mono">{a.code}</span> <span className="mono faint">{a.ip ?? ''}</span> <span className="small">{a.hostname}</span>
              </label>
            ))}
          </div>
          <div className="search-box" style={{ maxWidth: 'none' }}>
            <Search />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter services by host, port, or name" aria-label="Filter services" />
          </div>
          <div className="pick-scroll" role="group" aria-label="Affected services">
            {svc.map((s) => (
              <label key={s.id} className={`pick row-pick ${serviceIds.includes(s.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => {
                  onServices(toggle(serviceIds, s.id));
                  if (!serviceIds.includes(s.id) && !assetIds.includes(s.asset_id)) onAssets([...assetIds, s.asset_id]);
                }} />
                <span className="mono">{s.asset_code}</span>
                <span className="mono">{s.port}/{s.protocol}</span>
                <span>{s.service_name ?? 'unknown'}</span>
                <span className="faint small">{[s.product, s.version].filter(Boolean).join(' ')}</span>
                {s.state !== 'open' && <Badge tone="muted">{s.state}</Badge>}
              </label>
            ))}
            {!svc.length && <p className="muted small" style={{ padding: 8 }}>No services match.</p>}
          </div>
          <span className="help tiny faint">Selecting a service also marks its asset as affected.</span>
        </div>
      )}
    </Panel>
  );
}

/* ---------- Validation ---------- */
function ValidationPanel({ finding, dirty }: { finding: FindingDetailData; dirty: boolean }) {
  const { base } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<string>(finding.validation_status);
  const [notes, setNotes] = useState(finding.validation_notes ?? '');
  useEffect(() => { setTarget(finding.validation_status); setNotes(finding.validation_notes ?? ''); }, [finding.validation_status, finding.validation_notes]);
  const activeEvidence = finding.evidence.filter((e) => e.status === 'active').length;
  const needsNotes = target === 'validated' || target === 'false_positive';
  const blocked = (target === 'validated' && !activeEvidence) || (needsNotes && notes.trim().length < 10) || target === finding.validation_status && notes === finding.validation_notes;
  const record = useMutation({
    mutationFn: () => api.patch(`${base}/findings/${finding.id}`, { validation_status: target, validation_notes: notes }),
    onSuccess: () => { qc.invalidateQueries(); toast.success('Validation decision recorded.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Validation" actions={<ValidationPill value={finding.validation_status} />}>
      <div className="stack tight">
        <p className="small muted">{VALIDATION_HELP[finding.validation_status]}</p>
        {finding.validated_by && (
          <p className="small"><Provenance kind="verified" /> {finding.validation_status === 'false_positive' ? 'Ruled out' : 'Validated'} by <strong>{finding.validated_by}</strong> on {fmtDateTime(finding.validated_at)}</p>
        )}
        <Notice tone="info">A version string, banner, or CVE match alone is <strong>not</strong> validation. Validate only after reproducing or confirming the issue and linking the evidence that shows it.</Notice>
        <Field label="Decision" htmlFor="v-target">
          <select id="v-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="scanner_reported">Scanner-reported</option>
            <option value="potential">Potential (requires verification)</option>
            <option value="validated">Analyst-validated</option>
            <option value="false_positive">False positive</option>
          </select>
        </Field>
        <Field label="How was this verified?" htmlFor="v-notes" help={needsNotes ? 'Required (at least 10 characters): the command, test, or evidence that confirms or rules it out.' : 'Optional notes.'}>
          <textarea id="v-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {target === 'validated' && !activeEvidence && <span className="small" style={{ color: 'var(--warn)' }}>Link at least one active evidence item (and save) before validating.</span>}
        {dirty && <span className="tiny faint">Save your other edits first. This records only the validation decision.</span>}
        <button className="btn" disabled={blocked || record.isPending} onClick={() => record.mutate()}>
          {record.isPending ? <span className="spinner" /> : <ShieldCheck />} Record decision
        </button>
      </div>
    </Panel>
  );
}

/* ---------- External reference data ---------- */
interface Metric { version: string; source: string; type: string; vector: string; base_score: number | null; base_severity: string | null }

function ReferencePanel({ cves, onApply }: { cves: string[]; onApply: (m: Metric & { retrieved_at: string }) => void }) {
  return (
    <Panel title="Reference data" hint="NVD · CISA KEV">
      {!cves.length ? (
        <p className="muted small">No CVE identifiers on this finding. Add CVEs (and save) to look up reference data.</p>
      ) : (
        <div className="stack">
          {cves.map((c) => <CveRef key={c} cve={c} onApply={onApply} />)}
        </div>
      )}
      <p className="tiny faint" style={{ marginTop: 10 }}>Reference data describes the CVE in general; it does not prove this lab asset is vulnerable. Only the CVE identifier is sent to NVD. Never evidence.</p>
    </Panel>
  );
}

function CveRef({ cve, onApply }: { cve: string; onApply: (m: Metric & { retrieved_at: string }) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['ref-cve', cve];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<any>(`/api/references/cve/${cve}?cached_only=1`) });
  const lookup = useMutation({
    mutationFn: (refresh: boolean) => api.get<any>(`/api/references/cve/${cve}${refresh ? '?refresh=1' : ''}`),
    onSuccess: (r) => qc.setQueryData(key, r),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const kevRefresh = useMutation({
    mutationFn: () => api.post<any>('/api/references/kev/refresh'),
    onSuccess: (r) => {
      (r.state === 'ok' ? toast.success : toast.error)(r.message);
      qc.invalidateQueries({ queryKey: ['ref-cve'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const r = q.data;
  const stateTone: Record<string, any> = { ok: 'ok', not_found: 'muted', rate_limited: 'warn', unavailable: 'bad', error: 'bad', disabled: 'muted', not_loaded: 'muted' };
  const primary: Metric | undefined = r?.data?.metrics?.find((m: Metric) => m.type === 'Primary' && m.version.startsWith('3')) ?? r?.data?.metrics?.[0];
  return (
    <div className="cve-ref">
      <div className="row" style={{ gap: 6 }}>
        <span className="mono">{cve}</span>
        {r && <Badge tone={stateTone[r.state]}>{r.state === 'ok' ? (r.cached ? 'Cached' : 'Newly retrieved') : humanize(r.state)}</Badge>}
        {r?.origin === 'imported' && <Badge tone="ext">Imported dataset</Badge>}
        <span className="spacer" />
        <button className="btn sm" disabled={lookup.isPending} onClick={() => lookup.mutate(r?.state === 'ok')}>
          {lookup.isPending ? <span className="spinner" /> : r?.state === 'ok' ? <RefreshCw /> : <Globe />} {r?.state === 'ok' ? 'Refresh' : 'Look up on NVD'}
        </button>
      </div>
      {q.isLoading && <Loading rows={1} />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {r && (
        <div className="stack tight small" style={{ marginTop: 6 }}>
          {r.state !== 'ok' && <p className={r.state === 'rate_limited' || r.state === 'unavailable' || r.state === 'error' ? 'warn-text' : 'muted'}>{r.message}</p>}
          {r.refresh_error && <p className="warn-text">Refresh failed: {r.refresh_error}</p>}
          {r.data && (
            <>
              <p className="clamp-3">{r.data.description}</p>
              {r.data.metrics?.length > 0 && (
                <ul className="list-plain metric-list">
                  {r.data.metrics.slice(0, 4).map((m: Metric, i: number) => (
                    <li key={i}>
                      <span className="mono">v{m.version} {m.base_score ?? '—'}</span> {m.base_severity && <span className="faint">{humanize(m.base_severity.toLowerCase())}</span>}
                      <span className="faint tiny"> · {m.type} · {m.source}</span>
                      <div className="mono tiny faint vec">{m.vector}</div>
                    </li>
                  ))}
                </ul>
              )}
              {primary && (
                <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onApply({ ...primary, retrieved_at: r.retrieved_at })}>
                  Use NVD v{primary.version} score in this finding (then save)
                </button>
              )}
              <div className="faint tiny">
                {r.data.cwes?.length > 0 && <>CWE: <span className="mono">{r.data.cwes.join(', ')}</span> · </>}
                Published {fmtDate(r.data.published)} · modified {fmtDate(r.data.last_modified)}
              </div>
            </>
          )}
          <KevLine kev={r.kev} onRefresh={() => kevRefresh.mutate()} busy={kevRefresh.isPending} />
          <div className="faint tiny">
            Source: {r.source}
            {r.retrieved_at && <> · retrieved {fmtDateTime(r.retrieved_at)}</>} ·{' '}
            <a href={r.url} target="_blank" rel="noopener noreferrer">nvd.nist.gov <ExternalLink size={11} /></a>
          </div>
        </div>
      )}
    </div>
  );
}

function KevLine({ kev, onRefresh, busy }: { kev: any; onRefresh: () => void; busy: boolean }) {
  if (!kev) return null;
  if (kev.state === 'not_loaded')
    return (
      <div className="row" style={{ gap: 6 }}>
        <span className="faint">CISA KEV catalog not loaded.</span>
        <button className="btn ghost sm" onClick={onRefresh} disabled={busy}>{busy ? <span className="spinner" /> : <RefreshCw />} Retrieve KEV catalog</button>
      </div>
    );
  return (
    <div>
      {kev.in_kev ? (
        <Badge tone="bad">Listed in CISA KEV · added {kev.entry?.dateAdded}</Badge>
      ) : (
        <Badge tone="muted">Not in KEV</Badge>
      )}{' '}
      <span className="faint tiny">{kev.message} {kev.origin === 'imported' ? '(imported catalog)' : ''}</span>
      {kev.in_kev && kev.entry?.knownRansomwareCampaignUse === 'Known' && <div className="tiny warn-text">CISA notes known ransomware campaign use.</div>}
    </div>
  );
}

/* ---------- Remediation tasks ---------- */
function TasksPanel({ finding }: { finding: FindingDetailData }) {
  const { base } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const add = useMutation({
    mutationFn: () => api.post(`${base}/findings/${finding.id}/tasks`, { title: title.trim(), owner, due_date: due || null }),
    onSuccess: () => { setTitle(''); setOwner(''); setDue(''); qc.invalidateQueries(); toast.success('Task added.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`${base}/remediation-tasks/${id}`, body),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`${base}/remediation-tasks/${id}`),
    onSuccess: () => { qc.invalidateQueries(); toast.success('Task removed.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Remediation tasks" hint={`${finding.tasks.filter((t) => t.status === 'done').length}/${finding.tasks.length} done`}>
      <div className="stack tight">
        {finding.tasks.map((t) => (
          <div key={t.id} className="task-row">
            <select aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => update.mutate({ id: t.id, body: { status: e.target.value } })}>
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
              <option value="wont_fix">Won't fix</option>
            </select>
            <div style={{ minWidth: 0 }}>
              <div className={t.status === 'done' ? 'done-text' : ''}>{t.title}</div>
              <div className="tiny faint">{t.owner || 'Unassigned'}{t.due_date ? ` · due ${t.due_date}` : ''}</div>
            </div>
            <button className="btn ghost icon sm" aria-label={`Remove task ${t.title}`} onClick={() => remove.mutate(t.id)}><Trash2 /></button>
          </div>
        ))}
        {!finding.tasks.length && <p className="muted small">No tasks yet.</p>}
        <form
          className="task-add"
          onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}
        >
          <input aria-label="New task" placeholder="New task, e.g. Upgrade OpenSSH on db01" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label="Owner" placeholder="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn sm" type="submit" disabled={!title.trim() || add.isPending}><Plus /> Add</button>
        </form>
      </div>
    </Panel>
  );
}

