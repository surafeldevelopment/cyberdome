import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, ChevronUp, ChevronsUp, CircleDot, ClipboardList, Download, FileSpreadsheet, FileUp, ListOrdered, Minus, Octagon, Plus, Search, ShieldAlert, ShieldCheck, Upload, Wrench, X } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtDateTime, fromLocalInput, humanize } from '../../lib/format';
import {
  Badge, EmptyState, ErrorState, Field, HowCalculated, Loading, Notice, PageHeader, Panel, SEV_ORDER, SeverityBadge, Tabs, ValidationBadge, useTab, Provenance,
} from '../../components/ui';
import { DataTable, matchText, type Column } from '../../components/DataTable';
import { EvidenceChips, FileDrop } from '../../components/evidence';
import { CaptureButton } from '../../components/CaptureButton';
import { useToast } from '../../components/overlay';
import { FACTORS, STATUS_LABEL, StatusPillFor, VALIDATION_LABEL, ValidationPill, factorTotal, isDocumented, useFindings, type FindingRow, type Task } from './shared';
import { AssetCell, KpiCard, KpiRow, RowAction, StatusPill } from '../../components/kit';
import { Donut, LegendList, Ring, PALETTE, SEVERITY_COLORS, type Segment } from '../../components/charts';
import '../../styles/vulns.css';

export default function VulnsPage() {
  const [tab, setTab] = useTab('findings');
  const q = useFindings();
  const all = q.data?.items ?? [];
  const tasks = useTasks();
  return (
    <>
      <PageHeader
        title="Vulnerabilities"
        subtitle="Lab 4: findings from instructor-approved scanners or instructor-provided reports, validated against evidence and prioritized by analyst judgement."
        actions={
          <>
            {tab !== 'priorities' && <CaptureButton title={tab === 'findings' ? 'Severity dashboard' : 'Vulnerabilities'} />}
            <Link className="btn primary" to="/vulnerabilities/new">
              <Plus /> New finding
            </Link>
          </>
        }
      />
      <Tabs
        label="Vulnerability views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'findings', label: 'Findings', count: all.length },
          { id: 'priorities', label: 'Top-three priorities', count: all.filter((f) => f.priority_rank).length },
          { id: 'imports', label: 'Imports' },
          { id: 'remediation', label: 'Remediation tasks', count: tasks.data?.length },
        ]}
      />
      {q.isLoading && <Loading />}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && tab === 'findings' && <FindingsTab all={all} />}
      {q.data && tab === 'priorities' && <PrioritiesTab all={all} />}
      {tab === 'imports' && <ImportsTab />}
      {tab === 'remediation' && <RemediationTab tasks={tasks} />}
    </>
  );
}

/* ============================== Findings ============================== */

function FindingsTab({ all }: { all: FindingRow[] }) {
  const { base } = useEngagement();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const f = { q: params.get('q') ?? '', severity: params.get('severity') ?? '', validation: params.get('validation') ?? '', status: params.get('status') ?? '' };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };
  const counted = all.filter((x) => x.validation_status !== 'false_positive');
  const sevCounts = SEV_ORDER.map((s) => ({ s, n: counted.filter((x) => x.severity === s).length }));

  const rows = useMemo(
    () =>
      all.filter(
        (x) =>
          (!f.severity || x.severity === f.severity) &&
          (!f.validation || (f.validation === 'unverified' ? ['scanner_reported', 'potential'].includes(x.validation_status) && x.status !== 'remediated' : x.validation_status === f.validation)) &&
          (!f.status || x.status === f.status) &&
          matchText(x, f.q, ['code', 'title', 'description', 'owner', (r) => r.cves.join(' '), (r) => r.assets.map((a) => `${a.code} ${a.ip} ${a.hostname}`).join(' ')]),
      ),
    [all, f.q, f.severity, f.validation, f.status],
  );
  const filtered = !!(f.q || f.severity || f.validation || f.status);
  const exportQs = qs({ severity: f.severity, validation: f.validation, status: f.status, q: f.q });

  const columns: Column<FindingRow>[] = [
    {
      key: 'title', header: 'Finding', sortValue: (r) => Number(r.code.replace(/\D/g, '')),
      render: (r) => {
        const a = r.assets[0];
        const sub = `${r.code}${a ? ` · ${a.ip ?? a.hostname ?? a.code}` : ' · no asset linked'}${r.assets.length > 1 ? ` +${r.assets.length - 1}` : ''}${r.priority_rank ? ` · Priority #${r.priority_rank}` : ''}`;
        return (
          <span className="vf-cell" title={`${r.code} · ${r.title}`}>
            <AssetCell icon={<ShieldAlert />} title={r.title} sub={sub} to={`/vulnerabilities/${r.id}`} />
          </span>
        );
      },
    },
    { key: 'severity', header: 'Severity', render: (r) => <SeverityBadge severity={r.severity} />, sortValue: (r) => SEV_ORDER.indexOf(r.severity) },
    { key: 'validation_status', header: 'Validation', render: (r) => <ValidationPill value={r.validation_status} />, sortValue: (r) => VALIDATION_LABEL[r.validation_status] },
    { key: 'status', header: 'Status', render: (r) => <StatusPillFor status={r.status} />, sortValue: (r) => STATUS_LABEL[r.status] },
    { key: 'evidence', header: 'Evidence', sortable: false, render: (r) => <span className="ev-cell" title={r.evidence.map((e) => e.code).join(', ')}><EvidenceChips items={r.evidence.slice(0, 1)} empty="None" />{r.evidence.length > 1 && <span className="tiny faint"> +{r.evidence.length - 1}</span>}</span> },
    { key: 'cves', header: 'CVEs', sortValue: (r) => r.cves[0], render: (r) => (r.cves.length ? <span className="mono tiny nowrap" title={r.cves.join(', ')}>{r.cves[0]}{r.cves.length > 1 ? ` +${r.cves.length - 1}` : ''}</span> : <span className="faint">—</span>) },
    { key: 'cvss_score', header: 'CVSS', render: (r) => (r.cvss_score !== null ? <span title={`${r.cvss_version ? 'v' + r.cvss_version : ''} ${r.cvss_source ? 'source: ' + r.cvss_source : ''}`}>{r.cvss_score.toFixed(1)}</span> : <span className="faint">—</span>) },
    { key: 'act', header: 'Action', sortable: false, className: 'act', render: (r) => <RowAction to={`/vulnerabilities/${r.id}`} label={`Open ${r.code}`} /> },
  ];

  const SEV_KPI: { s: 'critical' | 'high' | 'medium' | 'low'; icon: any }[] = [
    { s: 'critical', icon: <Octagon /> }, { s: 'high', icon: <ChevronsUp /> }, { s: 'medium', icon: <ChevronUp /> }, { s: 'low', icon: <Minus /> },
  ];
  const SEV_COLOR: Record<string, string> = SEVERITY_COLORS;
  const sevSegs: Segment[] = sevCounts.map(({ s, n }) => ({ key: s, label: humanize(s), value: n, color: SEV_COLOR[s], onClick: () => set('severity', f.severity === s ? '' : s) }));
  const VAL_SEG = [
    { key: 'validated', color: PALETTE.green }, { key: 'scanner_reported', color: PALETTE.blue }, { key: 'potential', color: PALETTE.amber }, { key: 'false_positive', color: PALETTE.grey },
  ];
  const valSegs: Segment[] = VAL_SEG.map((v) => ({ key: v.key, label: VALIDATION_LABEL[v.key], value: all.filter((x) => x.validation_status === v.key).length, color: v.color, onClick: () => set('validation', f.validation === v.key ? '' : v.key) }));
  const sevTotal = sevCounts.reduce((a, x) => a + x.n, 0);

  if (!all.length)
    return (
      <Panel>
        <EmptyState
          icon={<ShieldAlert />}
          title="No findings recorded yet"
          actions={
            <>
              <Link className="btn primary" to="/vulnerabilities?tab=imports"><Upload /> Import a vulnerability report</Link>
              <Link className="btn" to="/vulnerabilities/new"><Plus /> Record a finding manually</Link>
            </>
          }
        >
          Import an instructor-provided report (Nessus, Greenbone/OpenVAS, or the CyberDome CSV/JSON template) or record findings from your own authorized analysis. Lab 4 needs at least five documented findings.
        </EmptyState>
      </Panel>
    );

  return (
    <div className="stack">
      <KpiRow>
        {SEV_KPI.map(({ s: sev, icon }) => {
          const list = counted.filter((x) => x.severity === sev);
          const open = list.filter((x) => x.status !== 'remediated').length;
          const validated = list.filter((x) => x.validation_status === 'validated').length;
          return (
            <div key={sev} className={`kpi-wrap ${f.severity === sev ? 'on' : ''}`}>
              <KpiCard
                icon={icon}
                label={humanize(sev)}
                value={list.length}
                pill={list.length ? { text: validated ? `${validated} validated` : `${open} open`, tone: validated ? 'ok' : sev === 'critical' || sev === 'high' ? 'bad' : sev === 'medium' ? 'warn' : 'neutral' } : { text: 'None', tone: 'neutral' }}
                calc={`Findings with ${sev} severity, excluding false positives. Pill: analyst-validated count, or open count when none are validated yet. Click to filter the table.`}
                onClick={() => set('severity', f.severity === sev ? '' : sev)}
              />
            </div>
          );
        })}
      </KpiRow>

      <details className="dash-more charts-more">
      <summary>Charts</summary>
      <div className="grid vulns-charts" style={{ marginTop: 12 }}>
        <Panel title="Findings" hint="By Severity" actions={<HowCalculated text="Count of findings per severity, excluding findings an analyst marked as false positive. Severity comes from the scanner unless an analyst changed it (see each finding's severity basis). Click a segment or legend row to filter the table." />}>
          {sevTotal ? (
            <div className="donut-row">
              <Donut segments={sevSegs} centerLabel="Total" centerValue={sevTotal} size={200} ariaLabel="Findings by severity" />
              <LegendList segments={sevSegs} />
            </div>
          ) : (
            <p className="muted small">All findings are marked false positive.</p>
          )}
        </Panel>
        <Panel title="Verification" hint="By Validation" actions={<HowCalculated text="Counts of findings by validation state. Scanner-reported and Potential findings still need an analyst to verify them against evidence before they are treated as confirmed. Click a legend row to filter." />}>
          <Ring segments={valSegs} center={valSegs[0].value} sub="Validated" size={190} ariaLabel="Findings by validation status" />
          <div className="small muted" style={{ marginTop: 12 }}>
            <Provenance kind="calculated" /> {all.filter((x) => x.status === 'remediated').length} remediated · {all.filter((x) => isDocumented(x)).length} fully documented for Lab 4
          </div>
        </Panel>
      </div>
      </details>

      <Panel
        title="Findings"
        hint={`${rows.length} of ${all.length}`}
        flush
        className="vulns-table"
        actions={
          <>
            <a className="btn sm" href={`${base}/exports/findings.csv${exportQs}`} download><Download /> CSV</a>
            <a className="btn sm" href={`${base}/exports/findings.json${exportQs}`} download><Download /> JSON</a>
          </>
        }
      >
        <div className="filters">
          <div className="search-box" style={{ maxWidth: 300 }}>
            <Search />
            <input type="search" placeholder="Search ID, title, CVE, host, owner" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Search findings" />
          </div>
          <select aria-label="Severity" value={f.severity} onChange={(e) => set('severity', e.target.value)}>
            <option value="">All severities</option>
            {SEV_ORDER.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
          <select aria-label="Validation" value={f.validation} onChange={(e) => set('validation', e.target.value)}>
            <option value="">All validation states</option>
            <option value="unverified">Awaiting verification</option>
            <option value="scanner_reported">Scanner-reported</option>
            <option value="potential">Potential (verify)</option>
            <option value="validated">Analyst-validated</option>
            <option value="false_positive">False positive</option>
          </select>
          <select aria-label="Status" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {filtered && (
            <button className="btn ghost sm" onClick={() => setParams(new URLSearchParams(params.get('tab') ? { tab: params.get('tab')! } : {}), { replace: true })}>
              <X /> Clear filters
            </button>
          )}
          <span className="small faint" style={{ marginLeft: 'auto' }}>Exports include all {rows.length} matching records</span>
        </div>
        <DataTable
          caption="Vulnerability findings"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`/vulnerabilities/${r.id}`)}
          rowClassName={(r) => (r.validation_status === 'false_positive' ? 'fp-row' : '')}
          empty={<EmptyState title="No findings match these filters">Clear a filter to see more findings.</EmptyState>}
        />
      </Panel>
    </div>
  );
}

/* ============================== Priorities ============================== */

interface Slot { finding_id: string; rationale: string }

function PrioritiesTab({ all }: { all: FindingRow[] }) {
  const { base } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const candidates = all.filter((f) => f.validation_status !== 'false_positive' && f.status !== 'remediated');
  const initial = (): Slot[] => [1, 2, 3].map((r) => {
    const f = all.find((x) => x.priority_rank === r);
    return { finding_id: f?.id ?? '', rationale: f?.priority_rationale ?? '' };
  });
  const [slots, setSlots] = useState<Slot[]>(initial);
  const key = all.map((f) => `${f.id}:${f.priority_rank}:${f.priority_rationale}`).join('|');
  useEffect(() => setSlots(initial()), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const documented = all.filter(isDocumented).length;
  const save = useMutation({
    mutationFn: () =>
      api.put(`${base}/priorities`, {
        items: slots.map((s, i) => ({ finding_id: s.finding_id, rank: i + 1, rationale: s.rationale.trim() })).filter((s) => s.finding_id),
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success('Priorities saved.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const chosen = slots.map((s) => s.finding_id).filter(Boolean);
  const dupes = chosen.length !== new Set(chosen).size;
  const missingRationale = slots.some((s) => s.finding_id && s.rationale.trim().length < 10);
  const dirty = JSON.stringify(slots) !== JSON.stringify(initial());

  if (!candidates.length)
    return (
      <Panel>
        <EmptyState icon={<ListOrdered />} title="Nothing to prioritize yet" actions={<Link className="btn" to="/vulnerabilities?tab=imports">Import findings</Link>}>
          Prioritization needs open findings that are not marked as false positives.
        </EmptyState>
      </Panel>
    );

  return (
    <div className="stack">
      <KpiRow>
        <KpiCard icon={<ClipboardList />} label="Documented for Lab 4" value={`${documented}/5`} pill={{ text: documented >= 5 ? 'Met' : `${Math.max(0, 5 - documented)} to go`, tone: documented >= 5 ? 'ok' : 'warn' }} calc="Findings with affected asset, description, severity, active evidence, impact, and remediation recorded. False positives are excluded." />
        <KpiCard icon={<ListOrdered />} label="Priorities ranked" value={`${all.filter((x) => x.priority_rank).length}/3`} pill={{ text: all.filter((x) => x.priority_rank && x.priority_rationale.trim().length >= 10).length === 3 ? 'With rationale' : 'Rationale needed', tone: all.filter((x) => x.priority_rank && x.priority_rationale.trim().length >= 10).length === 3 ? 'ok' : 'warn' }} calc="Findings currently holding rank 1, 2, or 3 (saved). Pill: whether every ranked finding has a saved rationale of at least 10 characters." />
        <KpiCard icon={<ShieldCheck />} label="Analyst-validated" value={all.filter((x) => x.validation_status === 'validated').length} pill={{ text: `of ${all.length}`, tone: 'neutral' }} calc="Findings an analyst confirmed against linked evidence." />
        <KpiCard icon={<CircleDot />} label="Open candidates" value={candidates.length} pill={{ text: 'Not remediated', tone: 'neutral' }} calc="Findings that can be ranked: not false positive and not remediated." />
      </KpiRow>

      <Notice title="How to prioritize.">
        Rank the three findings CyberDome should fix first and explain why. CVSS describes a vulnerability in general; your ranking should also weigh <strong>evidence strength</strong> (is it confirmed?), <strong>exposure</strong> (who can reach it?), <strong>impact</strong>, the <strong>importance of the affected asset</strong>, and <strong>how readily it can be fixed</strong>. The factor inputs below help you reason. The rank is your decision, and no automatic score decides it.
      </Notice>

      <Panel title="Top-Three Priorities" hint="Ordered by rank" actions={<CaptureButton compact title="Prioritized top-three list" />}>
        <ol className="prio-list">
          {slots.map((s, i) => {
            const f = all.find((x) => x.id === s.finding_id);
            return (
              <li key={i} className="prio-slot">
                <div className="num-row prio-head">
                  <span className="n" aria-hidden>{i + 1}</span>
                  <span className="t">
                    <strong title={f?.title}>{f ? f.title : 'Not set: choose a finding below'}</strong>
                    <span>{f ? `${f.code} · ${humanize(f.severity)} · ${f.validation_status === 'validated' ? 'Analyst-validated' : 'Not yet validated'}${f.cvss_score !== null ? ` · CVSS ${f.cvss_score.toFixed(1)}` : ''}` : `Priority ${i + 1}`}</span>
                  </span>
                  {f ? (
                    <Link className="go" to={`/vulnerabilities/${f.id}`} aria-label={`Open ${f.code}`}><ArrowUpRight size={17} /></Link>
                  ) : (
                    <span className="go faint" aria-hidden><Plus size={17} /></span>
                  )}
                </div>
                <div className="prio-body stack tight">
                  <Field label={`Priority ${i + 1} finding`} htmlFor={`prio-${i}`}>
                    <select id={`prio-${i}`} value={s.finding_id} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, finding_id: e.target.value } : x)))}>
                      <option value="">— Not set —</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {humanize(c.severity)} · {c.title.slice(0, 80)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {f && (
                    <div className="row small" style={{ gap: 6 }}>
                      <SeverityBadge severity={f.severity} />
                      <ValidationPill value={f.validation_status} />
                      <span className="mono faint">{f.assets.map((a) => a.code).join(', ') || 'no asset'}</span>
                      <EvidenceChips items={f.evidence} empty="no evidence" />
                    </div>
                  )}
                  {f && f.validation_status !== 'validated' && (
                    <span className="tiny" style={{ color: 'var(--warn)' }}>This finding is not analyst-validated yet. Say so in the rationale or validate it first.</span>
                  )}
                  <Field label="Rationale" htmlFor={`prio-r-${i}`} error={s.finding_id && s.rationale.trim().length < 10 ? 'Write at least 10 characters.' : undefined}>
                    <textarea
                      id={`prio-r-${i}`}
                      value={s.rationale}
                      rows={3}
                      placeholder="Why this should be addressed at this rank (evidence, exposure, impact, asset importance, fix availability)…"
                      onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, rationale: e.target.value } : x)))}
                    />
                  </Field>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {dupes && <span className="small" style={{ color: '#ff9aac' }}>A finding can only hold one rank.</span>}
          <button className="btn ghost" disabled={!dirty} onClick={() => setSlots(initial())}>Discard changes</button>
          <button className="btn primary" disabled={save.isPending || dupes || missingRationale || !dirty} onClick={() => save.mutate()}>
            {save.isPending && <span className="spinner" />} Save priorities
          </button>
        </div>
      </Panel>

      <FactorsTable candidates={candidates} />
    </div>
  );
}

function FactorsTable({ candidates }: { candidates: FindingRow[] }) {
  const { base } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    mutationFn: ({ id, key, value }: { id: string; key: string; value: number | null }) => api.patch(`${base}/findings/${id}`, { [key]: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['findings'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel
      title="Priority factors"
      hint="Analyst inputs, 0–3 each"
      flush
      actions={<HowCalculated text="Each factor is an analyst rating from 0 to 3. “Factor total” simply adds the ratings you entered (maximum 15) so you can compare findings at a glance. It is not a security score: the factors are not weighted, blank factors count as nothing, and the total ignores context such as compensating controls. Use it to support (not replace) your written rationale." />}
    >
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">Priority factor inputs per finding</caption>
          <thead>
            <tr>
              <th>Finding</th>
              <th>Severity</th>
              {FACTORS.map((x) => <th key={x.key} title={x.help}>{x.label}</th>)}
              <th>Factor total (analyst inputs)</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((f) => {
              const t = factorTotal(f);
              return (
                <tr key={f.id}>
                  <td className="factor-finding"><span className="vf-cell" title={`${f.code} · ${f.title}`}><AssetCell icon={<ShieldAlert />} title={f.title} sub={f.code} to={`/vulnerabilities/${f.id}`} /></span></td>
                  <td><SeverityBadge severity={f.severity} /></td>
                  {FACTORS.map((x) => (
                    <td key={x.key}>
                      <select
                        aria-label={`${x.label} for ${f.code}`}
                        className="factor-select"
                        value={(f[x.key] as number | null) ?? ''}
                        onChange={(e) => update.mutate({ id: f.id, key: x.key, value: e.target.value === '' ? null : Number(e.target.value) })}
                      >
                        <option value="">—</option>
                        {x.scale.map((lbl, n) => <option key={n} value={n}>{n} · {lbl}</option>)}
                      </select>
                    </td>
                  ))}
                  <td className="nowrap"><span>{t.filled ? `${t.total} / ${t.filled * 3}` : '—'}</span>{t.filled > 0 && t.filled < 5 && <div className="tiny faint">{5 - t.filled} not rated</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ============================== Imports ============================== */

interface PreviewResult {
  format: string;
  scanner: string;
  total_rows: number;
  valid_rows: number;
  skipped_info: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  unknown_columns: string[];
  rows: any[];
  to_create: number;
  to_update: number;
  initial_validation_status: string;
  previously_imported: { code: string; created_at: string } | null;
}

function ImportsTab() {
  const { base, eid, isDemo } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState('auto');
  const [source, setSource] = useState('instructor_supplied');
  const [includeInfo, setIncludeInfo] = useState(false);
  const [collected, setCollected] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<any>(null);
  const history = useQuery({ queryKey: ['finding-imports', eid], queryFn: () => api.get<any[]>(`${base}/finding-imports`), enabled: !!eid });

  const form = () => {
    const fd = new FormData();
    fd.append('file', file!);
    fd.append('format', format);
    fd.append('include_info', includeInfo ? '1' : '0');
    fd.append('source_category', isDemo ? 'demo' : source);
    const c = fromLocalInput(collected);
    if (c) fd.append('collected_at', c);
    return fd;
  };
  const doPreview = useMutation({
    mutationFn: () => api.upload<PreviewResult>(`${base}/finding-imports/preview`, form()),
    onSuccess: (r) => { setPreview(r); setResult(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const doImport = useMutation({
    mutationFn: () => api.upload(`${base}/finding-imports`, form()),
    onSuccess: (r) => {
      setResult(r);
      setPreview(null);
      setFile(null);
      qc.invalidateQueries();
      toast.success(`${r.code}: ${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  useEffect(() => { setPreview(null); }, [file, format, includeInfo]);

  return (
    <div className="stack">
      <div className="grid span-main">
        <Panel title="Import a vulnerability report">
          <div className="stack">
            <FileDrop file={file} onFile={setFile} accept=".csv,.json,.nessus,.xml" label="Drop a report here or choose a file" hint="CyberDome CSV/JSON template, Nessus (.nessus v2), or Greenbone/OpenVAS XML" />
            <div className="form-grid">
              <Field label="Format" htmlFor="vi-format">
                <select id="vi-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="auto">Detect automatically</option>
                  <option value="normalized_csv">CyberDome CSV template</option>
                  <option value="normalized_json">CyberDome JSON template</option>
                  <option value="nessus">Nessus (.nessus v2)</option>
                  <option value="greenbone_xml">Greenbone / OpenVAS XML</option>
                </select>
              </Field>
              {isDemo ? (
                <Field label="Source category"><Badge tone="demo">Demo data</Badge></Field>
              ) : (
                <Field label="Source category" htmlFor="vi-source">
                  <select id="vi-source" value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="instructor_supplied">Instructor-supplied report</option>
                    <option value="authorized_lab">Authorized lab scan (run by our team)</option>
                  </select>
                </Field>
              )}
              <Field label="Report collected at" htmlFor="vi-collected" help="When the scan ran. Leave blank if unknown. It is never guessed.">
                <input id="vi-collected" type="datetime-local" value={collected} onChange={(e) => setCollected(e.target.value)} />
              </Field>
              <Field label="Informational results">
                <label className="check"><input type="checkbox" checked={includeInfo} onChange={(e) => setIncludeInfo(e.target.checked)} /> Include informational (severity 0 / Log) rows</label>
              </Field>
            </div>
            <div className="row">
              <button className="btn" disabled={!file || doPreview.isPending} onClick={() => doPreview.mutate()}>
                {doPreview.isPending && <span className="spinner" />} Preview import
              </button>
              <span className="small faint">Nothing is saved until you confirm the preview.</span>
            </div>
          </div>
        </Panel>
        <Panel title="Templates and formats">
          <div className="stack tight small">
            <a className="btn sm" href={`${base}/findings-template.csv`} download><FileSpreadsheet /> Download CSV template</a>
            <p className="muted">Columns: <span className="mono tiny">title, severity, host_ip, port, protocol, cves, cvss_score, cvss_version, cvss_vector, description, impact, remediation, scanner, plugin_id, evidence_note</span>. Only <code>title</code> and <code>severity</code> are required.</p>
            <p className="muted">Scanner reports import as <strong>Scanner-reported</strong>; template rows import as <strong>Potential</strong>. Nothing is ever imported as analyst-validated. A version string or CVE match is not confirmation.</p>
            <p className="muted">Hosts must already exist in the asset inventory (import the scan first). Unknown hosts are noted in the description and never invented as assets.</p>
            <p className="muted">Re-importing updates matching findings (scanner + plugin + host + port) instead of creating duplicates, and never overwrites analyst fields.</p>
          </div>
        </Panel>
      </div>

      {result && (
        <Notice tone={result.status === 'partial' ? 'warn' : 'ok'} title={`${result.code} ${result.status === 'partial' ? 'imported with errors.' : 'imported.'}`}>
          {result.created} new, {result.updated} updated, {result.unchanged} unchanged{result.skipped_info ? `, ${result.skipped_info} informational skipped` : ''}. Source file stored as{' '}
          <Link className="ev-chip" to={`/evidence/${result.evidence_id}`}>{result.evidence_code}</Link>.
          {result.created_codes?.length > 0 && <> New: <span className="mono small">{result.created_codes.join(', ')}</span>.</>}
          {result.errors?.length > 0 && <> {result.errors.length} row(s) were rejected. See the import history.</>}
        </Notice>
      )}

      {preview && <PreviewPanel p={preview} busy={doImport.isPending} onImport={() => doImport.mutate()} onCancel={() => setPreview(null)} />}

      <Panel title="Import history" flush>
        {history.isLoading && <div className="panel-body"><Loading /></div>}
        {history.isError && <div className="panel-body"><ErrorState error={history.error} retry={() => history.refetch()} /></div>}
        {history.data && (
          <DataTable
            caption="Vulnerability report imports"
            rows={history.data}
            rowKey={(r) => r.id}
            initialSort={{ key: 'created_at', dir: 'desc' }}
            columns={[
              { key: 'code', header: 'Import', render: (r) => <AssetCell icon={<FileUp />} title={r.code} sub={`${humanize(r.format)}${r.scanner ? ` · ${r.scanner}` : ''}`} /> },
              { key: 'status', header: 'Status', render: (r) => <StatusPill tone={r.status === 'complete' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'}>{humanize(r.status)}</StatusPill> },
              { key: 'created_count', header: 'New' },
              { key: 'updated_count', header: 'Updated' },
              { key: 'skipped_count', header: 'Skipped' },
              { key: 'evidence_code', header: 'Source file', render: (r) => (r.evidence_id ? <span className="nowrap"><Link className="ev-chip" to={`/evidence/${r.evidence_id}`}>{r.evidence_code}</Link> <span className="tiny faint clip" style={{ display: 'inline-block', maxWidth: 180, verticalAlign: 'middle' }} title={r.original_filename}>{r.original_filename}</span></span> : '—') },
              { key: 'created_at', header: 'Imported', render: (r) => <span className="small nowrap">{fmtDateTime(r.created_at)}</span> },
              {
                key: 'issues', header: 'Issues', sortable: false,
                render: (r) => (r.errors.length || r.warnings.length ? (
                  <details>
                    <summary className="small">{r.errors.length} errors · {r.warnings.length} warnings</summary>
                    <ul className="tiny issue-list">
                      {r.errors.map((e: any, i: number) => <li key={`e${i}`} className="err-line">{e.row ? `Row ${e.row}: ` : ''}{e.message}</li>)}
                      {r.warnings.map((w: any, i: number) => <li key={`w${i}`}>{w.row ? `Row ${w.row}: ` : ''}{w.message}</li>)}
                    </ul>
                  </details>
                ) : <span className="faint small">None</span>),
              },
            ]}
            empty={<EmptyState icon={<Upload />} title="No reports imported yet">Imported reports appear here with their source evidence and any row errors.</EmptyState>}
          />
        )}
      </Panel>
    </div>
  );
}

function PreviewPanel({ p, busy, onImport, onCancel }: { p: PreviewResult; busy: boolean; onImport: () => void; onCancel: () => void }) {
  return (
    <Panel
      title="Import preview"
      hint={`${humanize(p.format)}${p.scanner ? ' · ' + p.scanner : ''}`}
      actions={
        <>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!p.valid_rows || busy} onClick={onImport}>
            {busy && <span className="spinner" />} Import {p.valid_rows} finding{p.valid_rows === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row small">
          <Badge>{p.total_rows} rows read</Badge>
          <Badge tone="accent">{p.to_create} new</Badge>
          <Badge>{p.to_update} match existing (update)</Badge>
          {p.skipped_info > 0 && <Badge tone="muted">{p.skipped_info} informational skipped</Badge>}
          <Badge tone={p.errors.length ? 'bad' : 'ok'}>{p.errors.length} errors</Badge>
          <Badge tone={p.warnings.length ? 'warn' : 'ok'}>{p.warnings.length} warnings</Badge>
          <span className="faint">Findings will start as <strong>{p.initial_validation_status === 'scanner_reported' ? 'Scanner-reported' : 'Potential (requires verification)'}</strong>.</span>
        </div>
        {p.previously_imported && <Notice tone="info" title="Re-import.">This exact file was imported as {p.previously_imported.code} on {fmtDateTime(p.previously_imported.created_at)}. Matching findings will be updated, not duplicated.</Notice>}
        {p.valid_rows === 0 && <Notice tone="bad" title="Nothing to import.">No usable rows were found. Fix the errors below and preview again.</Notice>}
        {p.errors.length > 0 && (
          <div>
            <h3 className="small">Rejected rows</h3>
            <ul className="issue-list small">{p.errors.map((e, i) => <li key={i} className="err-line">{e.row ? `Row ${e.row}: ` : ''}{e.message}</li>)}</ul>
          </div>
        )}
        {p.warnings.length > 0 && (
          <div>
            <h3 className="small">Warnings</h3>
            <ul className="issue-list small">{p.warnings.map((w, i) => <li key={i}>{w.row ? `Row ${w.row}: ` : ''}{w.message}</li>)}</ul>
          </div>
        )}
        {p.rows.length > 0 && (
          <DataTable
            caption="Rows that will be imported"
            rows={p.rows}
            rowKey={(r) => `${r.row}-${r.dedupe_key}`}
            pageSize={25}
            columns={[
              { key: 'row', header: 'Row', className: 'num' },
              { key: 'title', header: 'Title' },
              { key: 'severity', header: 'Severity', render: (r) => <SeverityBadge severity={r.severity} /> },
              { key: 'host', header: 'Host', render: (r) => <span className="mono small">{r.host_ip ?? r.hostname ?? '—'}{r.port ? `:${r.port}/${r.protocol}` : ''}</span> },
              { key: 'asset', header: 'Asset match', render: (r) => (r.asset ? <span className="mono small">{r.asset.code}{r.service ? ` · ${r.service.label.split(':')[1]}` : ''}</span> : <Badge tone="warn">No asset</Badge>) },
              { key: 'cves', header: 'CVEs', render: (r) => <span className="mono tiny">{r.cves.join(', ') || '—'}</span> },
              { key: 'cvss_score', header: 'CVSS', className: 'num', render: (r) => (r.cvss_score ?? '—') },
              { key: 'action', header: 'Action', render: (r) => (r.action === 'update' ? <Badge>Update {r.existing_code}</Badge> : <Badge tone="accent">Create</Badge>) },
            ]}
          />
        )}
      </div>
    </Panel>
  );
}

/* ============================== Remediation ============================== */

function useTasks() {
  const { base, eid } = useEngagement();
  return useQuery({ queryKey: ['remediation-tasks', eid], queryFn: () => api.get<Task[]>(`${base}/remediation-tasks`), enabled: !!eid });
}

function RemediationTab({ tasks }: { tasks: ReturnType<typeof useTasks> }) {
  const { base } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`${base}/remediation-tasks/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['remediation-tasks'] }); toast.success('Task updated.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (tasks.isLoading) return <Loading />;
  if (tasks.isError) return <ErrorState error={tasks.error} retry={() => tasks.refetch()} />;
  const rows = tasks.data ?? [];
  const counts = { todo: 0, in_progress: 0, done: 0, wont_fix: 0 } as Record<string, number>;
  rows.forEach((t) => counts[t.status]++);
  return (
    <div className="stack">
    <KpiRow>
      <KpiCard icon={<ClipboardList />} label="To do" value={counts.todo} pill={{ text: 'Not started', tone: counts.todo ? 'warn' : 'neutral' }} calc="Remediation tasks with status To do." />
      <KpiCard icon={<Wrench />} label="In progress" value={counts.in_progress} pill={{ text: 'Being fixed', tone: 'neutral' }} calc="Remediation tasks with status In progress." />
      <KpiCard icon={<CheckCircle2 />} label="Done" value={counts.done} pill={{ text: rows.length ? `${Math.round((counts.done / rows.length) * 100)}% of tasks` : 'No tasks', tone: counts.done ? 'ok' : 'neutral' }} calc="Remediation tasks marked Done. Percentage is Done ÷ all tasks." />
      <KpiCard icon={<X />} label="Won't fix" value={counts.wont_fix} pill={{ text: 'Accepted', tone: 'neutral' }} calc="Remediation tasks marked Won't fix." />
    </KpiRow>
    <Panel title="Remediation Tasks" hint={`${rows.length} across findings`} flush className="vulns-table">
      <DataTable
        caption="Remediation tasks across findings"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'title', header: 'Task', render: (r) => <span className="vf-cell" title={r.title}><AssetCell icon={<Wrench />} title={r.title} sub={`${r.finding_code} · ${r.finding_title ?? ''}`} to={`/vulnerabilities/${r.finding_id}`} /></span> },
          { key: 'severity', header: 'Severity', render: (r) => <SeverityBadge severity={r.severity!} />, sortValue: (r) => SEV_ORDER.indexOf(r.severity!) },
          { key: 'owner', header: 'Owner', render: (r) => r.owner || <span className="faint">Unassigned</span> },
          {
            key: 'status', header: 'Status',
            render: (r) => (
              <select aria-label={`Status of ${r.title}`} value={r.status} onChange={(e) => update.mutate({ id: r.id, body: { status: e.target.value } })} style={{ width: 'auto' }}>
                <option value="todo">To do</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
                <option value="wont_fix">Won't fix</option>
              </select>
            ),
          },
          { key: 'due_date', header: 'Due', render: (r) => <span className="small nowrap">{r.due_date ?? '—'}</span> },
          { key: 'notes', header: 'Notes', render: (r) => <span className="small clamp-2">{r.notes || '—'}</span> },
          { key: 'act', header: 'Action', sortable: false, className: 'act', render: (r) => <RowAction to={`/vulnerabilities/${r.finding_id}`} label={`Open ${r.finding_code}`} /> },
        ]}
        empty={
          <EmptyState icon={<Wrench />} title="No remediation tasks yet" actions={<Link className="btn" to="/vulnerabilities">Open findings</Link>}>
            Add remediation tasks from a finding's detail page to track who fixes what and by when.
          </EmptyState>
        }
      />
    </Panel>
    </div>
  );
}

