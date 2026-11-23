import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleSlash, Loader2, Play, ShieldAlert, OctagonX, XCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { PageHeader, Panel, Loading, ErrorState, Notice } from '../components/ui';
import { useToast } from '../components/overlay';
import { api, errorMessage, PREVIEW } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import { fmtDateTime, fmtRelative } from '../lib/format';
import '../styles/autopilot.css';

interface Line { text: string; link?: string; tone?: 'ok' | 'warn' | 'bad' }
interface Step { key: string; label: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'blocked'; detail: string; lines: Line[] }
interface Run {
  id: string;
  status: 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled' | 'interrupted';
  options: { profile: string; retry_without_ping: boolean; analyze: boolean; host_snapshot: boolean };
  steps: Step[];
  summary: { runs?: string[]; hosts_up?: number; open_services?: number; findings_created?: number; snapshot?: string | null; blocked?: boolean };
  started_at: string;
  finished_at: string | null;
}
interface Overview {
  readiness: { ready: boolean; checks: { key: string; ok: boolean; label: string; fix: string | null }[]; targets: { id: string; target: string }[] };
  runs: Run[];
  rules: { key: string; title: string; severity: string; ports: number[] }[];
}

const STEP_ICON: Record<Step['status'], any> = { pending: Circle, running: Loader2, done: CheckCircle2, skipped: CircleSlash, failed: XCircle, blocked: AlertTriangle };

export default function Autopilot() {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['autopilot', eid], queryFn: () => api.get<Overview>(`${base}/autopilot`) });
  const [activeId, setActiveId] = useState<string | null>(null);
  const latest = q.data?.runs[0];
  const showId = activeId ?? (latest?.status === 'running' ? latest.id : latest?.id ?? null);
  const run = useQuery({
    queryKey: ['autopilot-run', showId],
    queryFn: () => api.get<Run>(`${base}/autopilot/${showId}`),
    enabled: !!showId,
    refetchInterval: (r) => ((r.state.data as Run | undefined)?.status === 'running' ? 1500 : false),
  });
  const running = run.data?.status === 'running';
  const [profile, setProfile] = useState<'quick' | 'standard'>('quick');
  const [retry, setRetry] = useState(true);
  const [analyze, setAnalyze] = useState(true);
  const [snapshot, setSnapshot] = useState(false);
  const [busy, setBusy] = useState(false);

  // When a run finishes, refresh everything it touched.
  const status = run.data?.status;
  useEffect(() => {
    if (status && status !== 'running') {
      for (const k of ['autopilot', 'assets', 'services', 'scan-imports', 'scan-runs', 'findings', 'evidence', 'dashboard', 'tracker']) qc.invalidateQueries({ queryKey: [k] });
    }
  }, [status, qc]);

  if (q.isLoading) return <Loading rows={5} label="Loading Autopilot" />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const o = q.data!;

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.post<Run>(`${base}/autopilot`, { profile, retry_without_ping: retry, analyze, host_snapshot: snapshot, confirm: true });
      setActiveId(r.id);
      qc.invalidateQueries({ queryKey: ['autopilot'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    try {
      await api.post(`${base}/autopilot/${showId}/cancel`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="autopilot">
      <PageHeader
        title="Autopilot"
        subtitle="Scans every target on your scope list, saves the output as evidence, and flags risky open services for you to verify."
      />

      <div className="ap-grid">
        <div className="stack">
          <Panel title="Readiness">
            <ul className="ap-checks">
              {o.readiness.checks.map((c) => (
                <li key={c.key} className={c.ok ? 'ok' : 'bad'}>
                  {c.ok ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />}
                  <span>{c.label}</span>
                  {!c.ok && c.fix && <Link to={c.fix} className="ap-fix">Fix <ArrowRight size={14} /></Link>}
                  {!c.ok && c.key === 'nmap' && <span className="faint small">Install from nmap.org with Npcap, then restart CyberDome</span>}
                </li>
              ))}
            </ul>
            {o.readiness.targets.length > 0 && (
              <p className="small faint" style={{ margin: '12px 0 0' }}>Targets: <span className="mono">{o.readiness.targets.map((t) => t.target).join(', ')}</span></p>
            )}
          </Panel>

          <Panel title="Run">
            <div className="ap-options">
              <div className="row" style={{ gap: 8 }}>
                {running ? (
                  <button className="btn" onClick={cancel}><OctagonX /> Stop</button>
                ) : (
                  <button className="btn primary ap-go" disabled={PREVIEW || busy || !o.readiness.ready} onClick={start}><Play /> Run Autopilot</button>
                )}
              </div>
              <details className="ap-more">
                <summary>Options</summary>
                <div className="stack tight" style={{ marginTop: 10 }}>
                  <div className="ap-seg" role="radiogroup" aria-label="Scan depth">
                    {(['quick', 'standard'] as const).map((p) => (
                      <button key={p} role="radio" aria-checked={profile === p} className={profile === p ? 'on' : ''} onClick={() => setProfile(p)}>
                        <strong>{p === 'quick' ? 'Quick' : 'Standard'}</strong>
                        <span>{p === 'quick' ? 'Top 100 ports, light version checks' : 'Top 1,000 ports, full version detection'}</span>
                      </button>
                    ))}
                  </div>
                  <label className="check-row"><input type="checkbox" checked={retry} onChange={(e) => setRetry(e.target.checked)} /><span>Retry targets with no answer, treating hosts as up (<code>-Pn</code>)</span></label>
                  <label className="check-row"><input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} /><span>Flag risky exposed services as findings to verify</span></label>
                  <label className="check-row"><input type="checkbox" checked={snapshot} onChange={(e) => setSnapshot(e.target.checked)} /><span>Also snapshot this computer for Lab 1 (connections, processes, accounts)</span></label>
                </div>
              </details>
            </div>
          </Panel>
        </div>

        <Panel
          title={running ? 'Running' : run.data ? 'Last run' : 'Progress'}
          hint={run.data ? `${running ? 'Started' : 'Finished'} ${fmtRelative(running ? run.data.started_at : run.data.finished_at ?? run.data.started_at)}` : undefined}
          className="ap-progress"
        >
          {!run.data ? (
            <p className="calm-empty">Nothing has run yet. When you start Autopilot each step appears here as it happens.</p>
          ) : (
            <>
              {run.data.status !== 'running' && run.data.status !== 'blocked' && run.data.summary && (
                <div className="ap-summary">
                  <div><span>Scans</span><strong>{run.data.summary.runs?.length ?? 0}</strong></div>
                  <div><span>Hosts up</span><strong>{run.data.summary.hosts_up ?? 0}</strong></div>
                  <div><span>Open ports</span><strong>{run.data.summary.open_services ?? 0}</strong></div>
                  <div><span>To verify</span><strong className={run.data.summary.findings_created ? 'warn' : ''}>{run.data.summary.findings_created ?? 0}</strong></div>
                </div>
              )}
              <ol className="ap-steps">
                {run.data.steps.map((s) => {
                  const Icon = STEP_ICON[s.status];
                  return (
                    <li key={s.key} className={`st-${s.status}`}>
                      <Icon className={s.status === 'running' ? 'spin' : ''} aria-hidden />
                      <div className="ap-step-body">
                        <div className="ap-step-head"><strong>{s.label}</strong>{s.detail && <span className="faint small">{s.detail}</span>}</div>
                        {s.lines.length > 0 && (
                          <ul className="ap-lines">
                            {s.lines.map((l, i) => (
                              <li key={i} className={l.tone ?? ''}>{l.link ? <Link to={l.link}>{l.text}</Link> : l.text}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {run.data.status === 'completed' && (
                <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
                  {(run.data.summary.findings_created ?? 0) > 0 && <Link className="btn primary" to="/vulnerabilities?validation=scanner_reported"><ShieldAlert /> Verify findings</Link>}
                  <Link className="btn ghost" to="/scan">View assets and services</Link>
                  <Link className="btn ghost" to="/">Dashboard</Link>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>

      <Notice tone="info" title="What Autopilot never does">
        It never scans anything outside your scope list, never marks a finding as validated, never sends evidence to an AI provider, and never writes your impact, remediation or interpretation. Those stay your work.
      </Notice>

      <details className="dash-more">
        <summary>Exposure rules and run history</summary>
        <div className="grid cols-2" style={{ marginTop: 12 }}>
          <Panel title="Exposure rules" hint="Open services that raise a finding to verify">
            <ul className="ap-rules">
              {o.rules.map((r) => (
                <li key={r.key}><span className={`sev-dot sev-${r.severity}`} aria-hidden /> {r.title} <span className="faint small mono">{r.ports.join(', ')}</span></li>
              ))}
            </ul>
          </Panel>
          <Panel title="History">
            {o.runs.length ? (
              <ul className="ap-history">
                {o.runs.map((r) => (
                  <li key={r.id}>
                    <button className="linklike" onClick={() => setActiveId(r.id)}>{fmtDateTime(r.started_at)}</button>
                    <span className="faint small">{r.status} · {r.summary?.runs?.length ?? 0} scans · {r.summary?.findings_created ?? 0} to verify</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="calm-empty">No runs yet.</p>
            )}
          </Panel>
        </div>
      </details>
    </div>
  );
}
