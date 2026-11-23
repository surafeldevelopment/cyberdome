import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2, Circle, CircleDashed, Upload, AlertTriangle, XCircle, Archive, CalendarClock, ListChecks, FileText, Activity as ActivityIcon,
  Server, Network, ShieldAlert, ShieldQuestion, Radar, Plus, Zap, MoreVertical, ArrowUpRight, Monitor,
} from 'lucide-react';
import { api } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import { fmtDate, fmtDateTime, fmtRelative, humanize, SOURCE_LABEL } from '../lib/format';
import { PageHeader, Panel, SeverityBadge, ValidationBadge, Badge, HowCalculated, EmptyState, Loading, ErrorState, Provenance, SEV_ORDER } from '../components/ui';
import { CaptureButton } from '../components/CaptureButton';
import { Donut, LegendList, Ring, AreaChart, PALETTE, SEVERITY_COLORS, type Segment } from '../components/charts';
import { ExposureMatrix } from './dashboard/ExposureMatrix';
import type { DashboardData } from './dashboard/types';
import '../styles/dashboard.css';

const SEV_COLORS: Record<string, string> = SEVERITY_COLORS;
const VAL_SEG: { key: string; label: string; color: string }[] = [
  { key: 'validated', label: 'Analyst-validated', color: PALETTE.green },
  { key: 'scanner_reported', label: 'Scanner-reported', color: PALETTE.blue },
  { key: 'potential', label: 'Potential (verify)', color: PALETTE.amber },
  { key: 'false_positive', label: 'False positive', color: PALETTE.grey },
];
const REM_SEG: { key: string; label: string; color: string }[] = [
  { key: 'open', label: 'Open', color: PALETTE.amber },
  { key: 'in_progress', label: 'In progress', color: PALETTE.blue },
  { key: 'remediated', label: 'Remediated', color: PALETTE.green },
  { key: 'risk_accepted', label: 'Risk accepted', color: PALETTE.grey },
];
const SERIES: { key: 'evidence' | 'observations' | 'log_events' | 'findings'; label: string; unit: string }[] = [
  { key: 'evidence', label: 'Evidence collected', unit: 'evidence items' },
  { key: 'observations', label: 'Service observations', unit: 'observations' },
  { key: 'log_events', label: 'Log events', unit: 'log events' },
  { key: 'findings', label: 'Findings recorded', unit: 'findings' },
];

function activityLink(a: DashboardData['recent_activity'][number]): string | null {
  if (!a.entity_id) return null;
  switch (a.entity_type) {
    case 'evidence': return `/evidence/${a.entity_id}`;
    case 'finding': return `/vulnerabilities/${a.entity_id}`;
    case 'asset': return `/scan/assets/${a.entity_id}`;
    case 'ai_session': return `/ai/${a.entity_id}`;
    case 'scan_import': return `/scan/imports/${a.entity_id}`;
    default: return null;
  }
}

const LAB_ICON: Record<string, any> = { signed_off: CheckCircle2, requirements_met: CheckCircle2, in_progress: CircleDashed, not_started: Circle };
const LAB_LABEL: Record<string, string> = { signed_off: 'Signed off', requirements_met: 'Requirements met', in_progress: 'In progress', not_started: 'Not started' };

function OverTime({ d }: { d: DashboardData }) {
  const [key, setKey] = useState<(typeof SERIES)[number]['key']>('evidence');
  const [mode, setMode] = useState<'daily' | 'cumulative'>('cumulative');
  const s = SERIES.find((x) => x.key === key)!;
  const raw = d.series[key] ?? [];
  const values = useMemo(() => (mode === 'daily' ? raw : raw.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], [])), [raw, mode]);
  const fmtX = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <Panel
      title="Collected over time"
      className="ot-panel"
      actions={
        <>
          <select className="select-pill" aria-label="Series" value={key} onChange={(e) => setKey(e.target.value as any)}>
            {SERIES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <select className="select-pill" aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="cumulative">Cumulative</option>
            <option value="daily">Per day</option>
          </select>
          <HowCalculated text={d.series.calc} />
        </>
      }
    >
      {d.series.days.length && raw.some((v) => v > 0) ? (
        <AreaChart labels={d.series.days} values={values} valueLabel={`${mode === 'cumulative' ? 'total ' : ''}${s.unit}`} formatX={fmtX} />
      ) : (
        <EmptyState icon={<CalendarClock />} title={`No ${s.unit} with timestamps yet`}>
          This chart plots stored collection and event times. It stays empty until timestamped records exist.
        </EmptyState>
      )}
    </Panel>
  );
}

export default function Dashboard() {
  const { base, eid } = useEngagement();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['dashboard', eid], queryFn: () => api.get<DashboardData>(`${base}/dashboard`), enabled: !!eid });
  const [moreOpen, setMoreOpenState] = useState(() => {
    try { return localStorage.getItem('cyberdome.dash.more') === '1'; } catch { return false; }
  });
  const setMore = (v: boolean) => {
    setMoreOpenState(v);
    try { localStorage.setItem('cyberdome.dash.more', v ? '1' : '0'); } catch { /* ignore */ }
  };

  if (q.isLoading) return <Loading rows={6} label="Calculating dashboard" />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const sevTotal = SEV_ORDER.reduce((a, s) => a + (d.severity[s] ?? 0), 0);
  const valTotal = VAL_SEG.reduce((a, v) => a + (d.validation[v.key] ?? 0), 0);
  const valSegs: Segment[] = VAL_SEG.map((v) => ({ key: v.key, label: v.label, value: d.validation[v.key] ?? 0, color: v.color, onClick: () => nav(`/vulnerabilities?validation=${v.key}`) }));
  const remTotal = REM_SEG.reduce((a, r) => a + (d.remediation[r.key] ?? 0), 0);
  const remSegs: Segment[] = REM_SEG.map((r) => ({ key: r.key, label: r.label, value: d.remediation[r.key] ?? 0, color: r.color, onClick: () => nav(`/vulnerabilities?status=${r.key}`) }));

  const kpis: { label: string; value: string; sub?: string; tone?: string; to: string; calc: string }[] = [
    { label: 'Assets', value: d.metrics.assets.value.toLocaleString(), sub: `${d.metrics.assets.secondary ?? 0} exposed`, to: d.metrics.assets.link, calc: d.metrics.assets.calc },
    { label: 'Open services', value: d.metrics.open_services.value.toLocaleString(), to: d.metrics.open_services.link, calc: d.metrics.open_services.calc },
    {
      label: 'Findings', value: d.metrics.findings.value.toLocaleString(),
      sub: d.metrics.awaiting_verification.value ? `${d.metrics.awaiting_verification.value} need verification` : undefined, tone: d.metrics.awaiting_verification.value ? 'warn' : undefined,
      to: d.metrics.findings.link, calc: d.metrics.findings.calc,
    },
    {
      label: 'Lab progress', value: `${d.metrics.lab_completion.value} / ${d.metrics.lab_completion.secondary ?? 0}`,
      sub: `${Math.round((d.metrics.lab_completion.value / Math.max(1, d.metrics.lab_completion.secondary ?? 1)) * 100)}% of requirements`,
      to: '/tracker', calc: d.metrics.lab_completion.calc,
    },
  ];
  const sevMax = Math.max(1, ...SEV_ORDER.map((s) => d.severity[s] ?? 0));
  const daysLeft = Math.ceil((Date.parse(d.final_due + 'T23:59:59') - Date.now()) / 86_400_000);

  return (
    <div className="dash calm">
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <CaptureButton title="Severity dashboard" label="Capture" />
            <Link className="btn ghost" to="/evidence?upload=1"><Plus /> Add evidence</Link>
            <Link className="btn primary" to="/autopilot"><Zap /> Run Autopilot</Link>
          </>
        }
      />
      <p className="dash-meta">
        Updated {fmtRelative(d.generated_at)}
        {d.last_collected_at && <> · data collected {fmtRelative(d.last_collected_at)}</>}
        {' · '}final due in {daysLeft} day{daysLeft === 1 ? '' : 's'}
      </p>

      <div className="stat-row">
        {kpis.map((k) => (
          <div key={k.label} className="stat" role="link" tabIndex={0} onClick={() => nav(k.to)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), nav(k.to))} aria-label={`${k.label}: ${k.value}`}>
            <span className="stat-label">{k.label}</span>
            <span className="stat-value">{k.value}</span>
            {k.sub && <span className={`stat-sub ${k.tone ?? ''}`}>{k.sub}</span>}
            <span className="stat-how" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><HowCalculated text={k.calc} /></span>
          </div>
        ))}
      </div>

      <div className="grid dash-main">
        <Panel title="Next steps" hint={d.missing_total ? `${d.missing_total} requirements open` : undefined} actions={<Link className="btn ghost sm" to="/tracker">All</Link>}>
          {d.missing_requirements.length ? (
            <ul className="next-list">
              {d.missing_requirements.slice(0, 5).map((r) => (
                <li key={`${r.lab}-${r.id}`}>
                  <span className="next-lab">{r.lab.replace('lab', 'Lab ')}</span>
                  {r.link ? <Link to={r.link}>{r.label}</Link> : <span>{r.label}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="calm-empty ok">Every tracked requirement is met.</p>
          )}
        </Panel>
        <Panel title="Findings by severity">
          {sevTotal ? (
            <ul className="sev-bars">
              {SEV_ORDER.map((sv) => (
                <li key={sv}>
                  <Link to={`/vulnerabilities?severity=${sv}`}>
                    <span className="sev-name">{humanize(sv)}</span>
                    <span className="sev-track"><span style={{ width: `${((d.severity[sv] ?? 0) / sevMax) * 100}%`, background: SEV_COLORS[sv] }} /></span>
                    <span className="sev-n">{d.severity[sv] ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="calm-empty">No findings yet. <Link to="/vulnerabilities?tab=imports">Import a vulnerability report</Link></p>
          )}
        </Panel>
      </div>

      <div className="grid dash-main">
        <Panel title="Most exposed assets" flush actions={<Link className="btn ghost sm" to="/scan">All assets</Link>}>
          {d.exposed_assets.length ? (
            <div className="table-wrap">
              <table className="data calm-table">
                <thead><tr><th>Asset</th><th className="num">Services</th><th className="num">Findings</th></tr></thead>
                <tbody>
                  {d.exposed_assets.slice(0, 5).map((a) => (
                    <tr key={a.id} className="clickable" onClick={() => nav(`/scan/assets/${a.id}`)}>
                      <td><Link to={`/scan/assets/${a.id}`} className="mono">{a.ip ?? a.hostname}</Link>{a.hostname && a.ip ? <span className="faint small"> {a.hostname}</span> : null}</td>
                      <td className="num">{a.open_services}</td>
                      <td className="num">{a.open_findings}{a.high_findings > 0 && <span className="hi-flag" title={`${a.high_findings} high or critical`}> · {a.high_findings} high</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="calm-empty pad">No exposed assets yet. <Link to="/scan">Run or import a scan</Link></p>
          )}
        </Panel>
        <Panel title="Top risks" actions={<Link className="btn ghost sm" to="/vulnerabilities?tab=priorities">Prioritize</Link>}>
          {d.top_risks.length || d.top_risks_unranked.length ? (
            <ol className="risk-list">
              {(d.top_risks.length ? d.top_risks : d.top_risks_unranked).map((r: any) => (
                <li key={r.id}>
                  <Link to={`/vulnerabilities/${r.id}`}>
                    <strong>{r.title}</strong>
                    <span className="faint small">{r.code} · {humanize(r.severity)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="calm-empty">Nothing to rank yet.</p>
          )}
          {!d.top_risks.length && d.top_risks_unranked.length > 0 && <p className="small faint" style={{ margin: '8px 0 0' }}>Not ranked yet; showing the highest severity.</p>}
        </Panel>
      </div>

      <details className="dash-more" open={moreOpen} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
        <summary>{moreOpen ? 'Hide' : 'Show'} detailed analytics</summary>
        <div className="dash-more-body">
      <div className="grid span-main">
        <OverTime d={d} />
        <Panel title="Findings" hint="By Validation" actions={<HowCalculated text="All findings grouped by validation status. A scanner result or CVE match is not treated as confirmed until an analyst validates it with linked evidence." />}>
          {valTotal ? (
            <Ring segments={valSegs} center={d.validation.validated ?? 0} sub="Validated" size={190} ariaLabel="Findings by validation status" />
          ) : (
            <p className="muted small">No findings recorded.</p>
          )}
        </Panel>
      </div>

      <div className="grid">
        <Panel
          title="Exposure Matrix"
          hint="Assets × currently open ports"
          actions={<Link className="btn sm" to="/scan?tab=services&state=open">Service table</Link>}
          flush
          className="xm-panel"
        >
          <ExposureMatrix cells={d.exposure_matrix} />
        </Panel>
      </div>

      <div className="grid cols-3">
        <Panel title="Recent Evidence" actions={<Link className="btn sm" to="/evidence">Locker</Link>}>
          {d.recent_evidence.length ? (
            <ul className="list-plain">
              {d.recent_evidence.map((e) => (
                <li key={e.id}>
                  <Link to={`/evidence/${e.id}`} className="cell-asset">
                    <span className="ic"><Archive /></span>
                    <span className="t"><strong>{e.title}</strong><span>{e.code} · {SOURCE_LABEL[e.source_category] ?? e.source_category} · {fmtRelative(e.imported_at)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Archive />} title="No evidence yet" actions={<Link className="btn sm" to="/evidence?upload=1">Add evidence</Link>} />
          )}
        </Panel>
        <Panel title="Recent Activity" hint="Recorded application events">
          {d.recent_activity.length ? (
            <ul className="list-plain feed">
              {d.recent_activity.slice(0, 8).map((a) => {
                const to = activityLink(a);
                return (
                  <li key={a.id}>
                    <span className="small">
                      {to ? <Link to={to}>{a.summary}</Link> : a.summary}
                      <span className="faint tiny"> · {a.actor}</span>
                    </span>
                    <span className="tiny faint nowrap" title={fmtDateTime(a.ts)}>{fmtRelative(a.ts)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<ActivityIcon />} title="No activity yet">Actions you take in this engagement are logged here.</EmptyState>
          )}
        </Panel>
        <Panel title="Remediation" hint="By Status" actions={<HowCalculated text="Findings (excluding false positives) grouped by remediation status. Click a segment to open those findings." />}>
          {remTotal ? (
            <div className="donut-row">
              <Donut segments={remSegs} centerLabel="Findings" centerValue={remTotal} size={170} thickness={26} ariaLabel="Findings by remediation status" />
              <LegendList segments={remSegs} />
            </div>
          ) : (
            <p className="muted small">No findings to track yet.</p>
          )}
          <div className="divider" />
          <div className="small">
            <div className="faint">Latest import</div>
            {d.latest_import ? (
              <Link to={d.latest_import.link} className="row" style={{ gap: 8 }}>
                <Upload size={14} />
                <span className="mono">{d.latest_import.code}</span>
                <span>{humanize(d.latest_import.type)} · {d.latest_import.format}</span>
                <span className="faint">{fmtRelative(d.latest_import.created_at)}</span>
              </Link>
            ) : (
              <span className="muted">No imports yet.</span>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid cols-4 dash-bottom">
        <Panel title="Lab Completion" actions={<Link className="btn sm" to="/tracker">Tracker</Link>}>
          <ul className="list-plain">
            {d.labs.map((l) => {
              const Icon = LAB_ICON[l.status] ?? Circle;
              return (
                <li key={l.lab}>
                  <Link to="/tracker" className="lab-row">
                    <Icon size={16} className={`lab-ic ${l.status}`} aria-hidden />
                    <span className="small" style={{ flex: 1 }}>{l.title.replace(/^Lab (\d): /, 'L$1 · ')}</span>
                    <span className="tiny faint nowrap" title={LAB_LABEL[l.status]}>{l.met}/{l.total}</span>
                  </Link>
                  <div className="progress" style={{ marginTop: 6 }}><div style={{ width: `${(l.met / Math.max(1, l.total)) * 100}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Missing Requirements" hint={`${d.missing_total} open`}>
          {d.missing_requirements.length ? (
            <ul className="list-plain">
              {d.missing_requirements.slice(0, 7).map((r) => (
                <li key={`${r.lab}-${r.id}`} className="miss-row">
                  <span className="lab-chip">{r.lab.replace('lab', 'L')}</span>
                  <span className="small" style={{ flex: 1 }}>{r.link ? <Link to={r.link}>{r.label}</Link> : r.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small" style={{ color: 'var(--ok)' }}>Every tracked requirement is met.</p>
          )}
        </Panel>
        <Panel title="Report Readiness" actions={<Link className="btn sm" to="/reports">Reports</Link>}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            {d.readiness.ready ? <Badge tone="ok" icon={<CheckCircle2 />}>No blocking issues</Badge> : <Badge tone="bad" icon={<XCircle />}>{d.readiness.blockers} blocking</Badge>}
            <Badge tone={d.readiness.warnings ? 'warn' : undefined} icon={<AlertTriangle />}>{d.readiness.warnings ?? 0} warnings</Badge>
          </div>
          <ul className="list-plain">
            {d.readiness.issues.slice(0, 5).map((i, n) => (
              <li key={n} className="small miss-row">
                {i.severity === 'blocker' ? <XCircle size={14} style={{ color: 'var(--bad)', flex: 'none', marginTop: 3 }} aria-label="Blocker" /> : <AlertTriangle size={14} style={{ color: 'var(--warn)', flex: 'none', marginTop: 3 }} aria-label="Warning" />}
                <span style={{ flex: 1 }}>{i.link ? <Link to={i.link}>{i.message}</Link> : i.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Checkpoints" hint={`Final ${fmtDate(d.final_due)}`}>
          <ul className="list-plain cp-list">
            {d.checkpoints.filter((c) => !c.passed).concat(d.checkpoints.filter((c) => c.passed).slice(-1)).slice(0, 5).map((c) => (
              <li key={c.key} className={c.passed ? 'cp-passed' : ''}>
                <span className="cp-date"><CalendarClock size={13} /> {fmtDate(c.date)} · {c.passed ? 'passed' : c.days_away === 0 ? 'today' : `in ${c.days_away} d`}</span>
                <span className="small">{c.label.replace(/^Checkpoint \d: |^Final: /, '')}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
        </div>
      </details>
    </div>
  );
}

