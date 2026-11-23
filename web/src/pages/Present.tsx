import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, Pause, Play, RotateCcw, Timer as TimerIcon, Presentation, ListOrdered, FileWarning, ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import { PageHeader, Panel, Loading, ErrorState, Notice, HowCalculated } from '../components/ui';
import { KpiCard, KpiRow } from '../components/kit';
import { useEngagementDetail } from './engagement/useEngagementDetail';
import type { DashboardData } from './dashboard/types';
import { ValidationChain } from './present/ValidationChain';
import '../styles/present.css';

interface Section {
  id: string;
  title: string;
  minutes: number;
  views: { label: string; to: string }[];
  points: (d: DashboardData, e: any) => ReactNode[];
  extra?: ReactNode;
}

const n = (v: number, word: string) => `${v} ${word}${v === 1 ? '' : 's'}`;

const SECTIONS: Section[] = [
  {
    id: 'scenario',
    title: 'Scenario and scope',
    minutes: 1,
    views: [{ label: 'Engagement', to: '/engagement' }, { label: 'Scope', to: '/engagement?tab=scope' }],
    points: (d, e) => [
      `Client: ${e.client_name}. ${e.purpose ? e.purpose.split('. ')[0] + '.' : 'State the assessment purpose.'}`,
      e.authorization_status === 'confirmed'
        ? `Written authorization ${e.authorization_ref} confirmed by ${e.authorization_confirmed_by}.`
        : 'Authorization is NOT yet confirmed in the platform. Confirm it before presenting.',
      `${n(e.scope.filter((s: any) => s.kind === 'in').length, 'authorized target')} and ${n(e.scope.filter((s: any) => s.kind === 'out').length, 'explicit exclusion')} recorded.`,
      `Team: ${e.team.length ? e.team.map((m: any) => `${m.name}${m.role ? ` (${m.role})` : ''}`).join(', ') : 'no members recorded yet'}.`,
    ],
  },
  {
    id: 'architecture',
    title: 'Architecture and navigation',
    minutes: 1,
    views: [{ label: 'Dashboard', to: '/' }, { label: 'Evidence Locker', to: '/evidence' }],
    points: () => [
      'Local web app: React + TypeScript frontend, Node/Express API, SQLite database, evidence files stored with SHA-256 hashes calculated from the bytes.',
      'Nine modules share one engagement: every asset, service, finding, event, and AI response links back to Evidence IDs.',
      'AI calls run server-side with keys in environment variables; only sanitized evidence the analyst selects is sent.',
      'Dashboard numbers are calculated from stored records. Open any card to see the records or the counting rule.',
    ],
  },
  {
    id: 'recon-scan',
    title: 'Recon and scanning',
    minutes: 2,
    views: [{ label: 'Recon', to: '/recon' }, { label: 'Assets & services', to: '/scan' }, { label: 'Scan history', to: '/scan?tab=history' }],
    points: (d) => [
      'Show one useful recon observation, its source, and the next authorized step it suggested.',
      `Scanning: ${n(d.metrics.assets.value, 'unique asset')} and ${n(d.metrics.open_services.value, 'open service endpoint')} from ${n(d.metrics.open_services.secondary ?? 0, 'historical observation')}.`,
      d.latest_import ? `Latest import ${d.latest_import.code} (${d.latest_import.format}, ${d.latest_import.status}).` : 'No scan imported yet.',
      'Point out a service flagged for further investigation and why; versions are labeled detected / inferred / unknown.',
    ],
  },
  {
    id: 'vulns',
    title: 'Vulnerability prioritization',
    minutes: 2,
    views: [{ label: 'Severity view', to: '/vulnerabilities' }, { label: 'Top three', to: '/vulnerabilities?tab=priorities' }],
    points: (d) => [
      `${n(d.metrics.findings.value, 'finding')}: ${['critical', 'high', 'medium', 'low', 'info'].map((s) => `${d.severity[s] ?? 0} ${s}`).join(', ')}.`,
      `${d.metrics.awaiting_verification.value} still awaiting analyst verification.`,
      d.top_risks.length
        ? `Top priorities: ${d.top_risks.map((r) => `#${r.priority_rank} ${r.code} ${r.title}`).join('; ')}.`
        : 'Top three not ranked yet. Rank them with written rationale before presenting.',
      'Explain why the ranking uses evidence strength, exposure, impact, asset importance and available remediation. Not CVSS alone.',
    ],
  },
  {
    id: 'attack',
    title: 'Attack evidence and timeline',
    minutes: 2,
    views: [{ label: 'Timeline', to: '/attack?tab=timeline' }, { label: 'Indicators', to: '/attack?tab=indicators' }],
    points: (d) => [
      `${n(d.metrics.unresolved_indicators.secondary ?? 0, 'indicator')} recorded; ${d.metrics.unresolved_indicators.value} unresolved.`,
      'Walk the timeline in order and show one important evidence item with its hash and source.',
      'Separate facts from assumptions: point to entries labeled “requires additional evidence” and uncertain ordering.',
    ],
  },
  {
    id: 'ai',
    title: 'Evidence-grounded AI',
    minutes: 2,
    views: [{ label: 'AI Security Analyst', to: '/ai' }],
    points: () => [
      'Select sanitized evidence, show the context preview of exactly what will be sent, then run one question.',
      'Click a cited Evidence ID; explain that a valid citation does not by itself prove the evidence supports the claim.',
      'Show the review: edits, reviewer, verification note. Only verified text can enter the final report.',
      'Say where AI helped and where human verification was required.',
    ],
  },
  {
    id: 'recs',
    title: 'Recommendations and lessons learned',
    minutes: 1,
    views: [{ label: 'Report preview', to: '/reports' }],
    points: (d) => [
      d.top_risks.length ? `Remediate in order: ${d.top_risks.map((r) => r.code).join(' → ')}.` : 'State the top remediation priorities.',
      d.readiness.ready ? 'Report readiness: no blocking issues.' : `Report readiness: ${d.readiness.blockers} blocking issue(s) to resolve.`,
      'Lessons learned: what worked, what was difficult, what you would improve.',
    ],
  },
  {
    id: 'qa',
    title: 'Q&A',
    minutes: 1,
    views: [{ label: 'Global search (Ctrl K)', to: '/' }],
    points: () => ['Be ready to explain how one finding was validated (below) and each member’s contribution.'],
  },
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Timer({ targetSeconds, sectionTarget }: { targetSeconds: number; sectionTarget: number }) {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const iv = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    iv.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => { if (iv.current) window.clearInterval(iv.current); };
  }, [running]);
  const over = elapsed > targetSeconds;
  return (
    <div className="metric p-timer" role="timer" aria-live="off" style={{ cursor: 'default' }}>
      <span className="m-icon" aria-hidden><TimerIcon /></span>
      <span className="m-label">Presenter timer</span>
      <span className="m-row">
        <span className={`m-value p-clock ${over ? 'over' : ''}`}>{fmt(elapsed)}</span>
        <span className={`delta ${over ? 'bad' : 'neutral'}`}>{over ? 'Over time' : `of ${fmt(targetSeconds)}`}</span>
      </span>
      <span className="row p-timer-ctl" style={{ gap: 6 }}>
        <button className="btn sm primary" onClick={() => setRunning((r) => !r)} aria-label={running ? 'Pause timer' : 'Start timer'}>{running ? <Pause /> : <Play />}{running ? 'Pause' : 'Start'}</button>
        <button className="btn sm" onClick={() => { setRunning(false); setElapsed(0); }} aria-label="Reset timer"><RotateCcw /> Reset</button>
        <span className="tiny faint">Section ≈ {sectionTarget} min</span>
      </span>
    </div>
  );
}

export default function Present() {
  const { base, eid } = useEngagement();
  const dash = useQuery({ queryKey: ['dashboard', eid], queryFn: () => api.get<DashboardData>(`${base}/dashboard`), enabled: !!eid });
  const eng = useEngagementDetail();
  const [idx, setIdx] = useState(0);
  const total = SECTIONS.reduce((a, s) => a + s.minutes, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setIdx((i) => Math.min(i + 1, SECTIONS.length - 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setIdx((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (dash.isLoading || eng.isLoading) return <Loading rows={5} label="Preparing walkthrough" />;
  if (dash.isError) return <ErrorState error={dash.error} retry={() => dash.refetch()} />;
  if (eng.isError) return <ErrorState error={eng.error} retry={() => eng.refetch()} />;
  const d = dash.data!;
  const e = eng.data!;
  const s = SECTIONS[idx];
  const startMin = SECTIONS.slice(0, idx).reduce((a, x) => a + x.minutes, 0);

  return (
    <>
      <PageHeader
        title="Demo walkthrough"
        subtitle={`A ${total}-minute guided path through the live platform for the final presentation. Use ← / → to move between sections. Talking points use current engagement data.`}
      />
      <KpiRow>
        <Timer targetSeconds={total * 60} sectionTarget={s.minutes} />
        <KpiCard
          icon={<Presentation />}
          label="Current section"
          value={`${idx + 1}/${SECTIONS.length}`}
          pill={{ text: `${startMin}:00–${startMin + s.minutes}:00`, tone: 'neutral' }}
          calc="Section position in the packet's 10–12 minute presentation plan, with its planned time window."
        />
        <KpiCard
          icon={<ListOrdered />}
          label="Top-three priorities ranked"
          value={`${d.top_risks.length}/3`}
          pill={d.top_risks.length === 3 ? { text: 'Ready', tone: 'ok' } : { text: 'Rank before presenting', tone: 'warn' }}
          to="/vulnerabilities?tab=priorities"
          calc="Findings that hold a priority rank (1–3) on the Vulnerabilities page."
        />
        <KpiCard
          icon={<FileWarning />}
          label="Report blockers"
          value={d.readiness.blockers ?? 0}
          pill={d.readiness.ready ? { text: 'Ready', tone: 'ok' } : { text: `${d.readiness.warnings ?? 0} warning${d.readiness.warnings === 1 ? '' : 's'}`, tone: 'bad' }}
          to="/reports"
          calc="Blocking issues from the report readiness check (missing evidence, unverified AI text, incomplete scope, missing rationale)."
        />
      </KpiRow>
      {d.engagement.is_demo && <div style={{ marginBottom: 18 }}><Notice tone="warn">You are presenting the demo engagement. Its records are synthetic; switch to your real engagement for the graded demonstration.</Notice></div>}
      <div className="p-layout">
        <nav className="p-steps" aria-label="Walkthrough sections">
          <ol>
            {SECTIONS.map((x, i) => (
              <li key={x.id}>
                <button className={`num-row ${i === idx ? 'on' : ''}`} aria-current={i === idx ? 'step' : undefined} onClick={() => setIdx(i)}>
                  <span className="n">{i + 1}</span>
                  <span className="t"><strong>{x.title}</strong><span>{x.minutes} min</span></span>
                  <span className="go" aria-hidden><ChevronRight size={16} /></span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="stack">
          <Panel title={s.title} hint={`${startMin}:00 – ${startMin + s.minutes}:00`} actions={<HowCalculated text="Talking points are generated from the current engagement's stored records (dashboard metrics and engagement details), not from fixed text." />}>
            <ol className="p-points">
              {s.points(d, e).map((p, i) => <li key={i}><span className="p-bullet" aria-hidden>{i + 1}</span><span>{p}</span></li>)}
            </ol>
            <div className="row" style={{ marginTop: 12 }}>
              {s.views.map((v) => (
                <Link key={v.to + v.label} className="btn" to={v.to}><ExternalLink /> {v.label}</Link>
              ))}
            </div>
          </Panel>
          {(s.id === 'vulns' || s.id === 'qa') && (
            <Panel title="How one finding was validated" hint="Finding → asset/service → evidence → analyst validation → AI review">
              <ValidationChain />
            </Panel>
          )}
          {s.id === 'vulns' && d.top_risks.length > 0 && (
            <Panel title="Ranked priorities">
              <div className="stack tight">
                {d.top_risks.map((r) => (
                  <Link key={r.id} to={`/vulnerabilities/${r.id}`} className="num-row" title={r.priority_rationale || 'Rationale missing'}>
                    <span className="n" aria-label={`Priority ${r.priority_rank}`}>{r.priority_rank}</span>
                    <span className="t"><strong>{r.title}</strong><span>{r.code} · {r.severity} · {r.priority_rationale || 'rationale missing'}</span></span>
                    <span className="go" aria-hidden><ArrowUpRight size={17} /></span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          <div className="row between">
            <button className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronLeft /> Previous</button>
            <span className="small faint">Section {idx + 1} of {SECTIONS.length}</span>
            <button className="btn primary" disabled={idx === SECTIONS.length - 1} onClick={() => setIdx(idx + 1)}>Next <ChevronRight /></button>
          </div>
        </div>
      </div>
    </>
  );
}
