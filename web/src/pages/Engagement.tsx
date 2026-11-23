import { Link } from 'react-router-dom';
import { Target, ShieldOff, Users, ScanEye } from 'lucide-react';
import { PageHeader, Panel, Tabs, useTab, Loading, ErrorState, Provenance } from '../components/ui';
import { KpiCard, KpiRow, StatusPill } from '../components/kit';
import { CaptureButton } from '../components/CaptureButton';
import { useEngagementDetail } from './engagement/useEngagementDetail';
import { OverviewTab } from './engagement/OverviewTab';
import { ScopeTab } from './engagement/ScopeTab';
import { TeamTab } from './engagement/TeamTab';
import { IndicatorsPanel } from './attack/Indicators';
import { HostSnapshotPanel } from './engagement/HostSnapshot';
import { useTracker, RequirementList, LabStatusBadge } from './tracker/shared';
import { humanize } from '../lib/format';
import '../styles/engagement.css';

function Lab1Checklist() {
  const t = useTracker();
  const lab = t.data?.labs.find((l) => l.lab === 'lab1');
  return (
    <Panel title="Lab 1 requirements" actions={lab && <LabStatusBadge status={lab.status} />}>
      {t.isLoading && <Loading rows={3} />}
      {t.isError && <ErrorState error={t.error} retry={() => t.refetch()} />}
      {lab && <RequirementList reqs={lab.requirements} />}
      <p className="tiny faint" style={{ marginTop: 8, marginBottom: 0 }}>Checked against stored records. See the <Link to="/tracker">Project Tracker</Link> for every lab.</p>
    </Panel>
  );
}

function EngagementKpis({ eng }: { eng: ReturnType<typeof useEngagementDetail>['data'] & {} }) {
  const t = useTracker();
  const ins = eng.scope.filter((s) => s.kind === 'in');
  const outs = eng.scope.filter((s) => s.kind === 'out');
  const roles = eng.team.filter((m) => m.role.trim()).length;
  const lab1 = t.data?.labs.find((l) => l.lab === 'lab1');
  const ind = lab1?.requirements.find((r) => r.id === 'lab1_indicators');
  const m = ind?.detail.match(/^(\d+) of (\d+)/);
  return (
    <KpiRow>
      <KpiCard
        icon={<Target />}
        label="Authorized targets"
        value={ins.length}
        pill={ins.length ? null : { text: 'None defined', tone: 'warn' }}
        to="/engagement?tab=scope"
        calc="Scope entries on the authorized (in-scope) list."
      />
      <KpiCard
        icon={<ShieldOff />}
        label="Excluded targets"
        value={outs.length}
        to="/engagement?tab=scope"
        calc="Scope entries on the excluded list. Exclusions always win over authorized entries in scope checks."
      />
      <KpiCard
        icon={<Users />}
        label="Team members"
        value={eng.team.length}
        pill={{ text: `${roles} with roles`, tone: roles && roles === eng.team.length ? 'ok' : 'neutral' }}
        to="/engagement?tab=team"
        calc="Team members recorded on this engagement. Members with a role count toward the Lab 1 team-roles requirement."
      />
      <KpiCard
        icon={<ScanEye />}
        label="Lab 1 indicators complete"
        value={m ? `${m[1]}/${m[2]}` : t.isLoading ? '…' : '—'}
        pill={lab1 ? { text: ind?.met ? 'Requirement met' : 'In progress', tone: ind?.met ? 'ok' : 'warn' } : null}
        to="/engagement?tab=indicators"
        calc="Lab 1 indicators with observation, why suspicious, additional evidence needed, an assessment, and at least one active evidence link. Checked by the server against stored records."
      />
    </KpiRow>
  );
}

export default function Engagement() {
  const q = useEngagementDetail();
  const [tab, setTab] = useTab('overview');
  if (q.isLoading) return <Loading rows={6} label="Loading engagement" />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const eng = q.data!;
  const inCount = eng.scope.filter((s) => s.kind === 'in').length;
  const outCount = eng.scope.filter((s) => s.kind === 'out').length;

  return (
    <>
      <PageHeader
        title="Engagement"
        subtitle={
          <span className="row eng-sub" style={{ gap: 10 }}>
            <span>{eng.client_name}</span>
            <StatusPill tone="muted">{humanize(eng.status)}</StatusPill>
            {eng.is_demo && <Provenance kind="demo" />}
          </span>
        }
        actions={
          tab === 'indicators' ? (
            <CaptureButton title="Completed indicator table" />
          ) : (
            <CaptureButton title="Engagement page" />
          )
        }
      />
      <EngagementKpis eng={eng} />
      <Tabs
        label="Engagement sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'scope', label: 'Scope', count: inCount + outCount },
          { id: 'team', label: 'Team', count: eng.team.length },
          { id: 'indicators', label: 'Signs of compromise' },
        ]}
      />
      <div className="eng-layout">
        <div className="eng-main">
          {tab === 'overview' && <OverviewTab eng={eng} />}
          {tab === 'scope' && <ScopeTab eng={eng} />}
          {tab === 'team' && <TeamTab eng={eng} />}
          {tab === 'indicators' && (
            <>
              <HostSnapshotPanel isDemo={!!eng.is_demo} />
              <Panel title="Possible signs of compromise (Lab 1)" hint="Observation → why suspicious → benign explanations → evidence needed → assessment">
                <IndicatorsPanel lab="lab1" />
              </Panel>
            </>
          )}
        </div>
        <aside className="eng-side">
          <Lab1Checklist />
          <Panel title="Scope at a glance">
            <div className="glance">
              <div className="glance-label">Authorized targets</div>
              {inCount ? eng.scope.filter((s) => s.kind === 'in').map((s) => (
                <div key={s.id} className="glance-row"><span className="mono">{s.target}</span></div>
              )) : <div className="faint small">None defined</div>}
              <div className="glance-label">Excluded</div>
              {outCount ? eng.scope.filter((s) => s.kind === 'out').map((s) => (
                <div key={s.id} className="glance-row"><span className="mono">{s.target}</span><StatusPill tone="bad">Excluded</StatusPill></div>
              )) : <div className="faint small">None listed</div>}
              <div className="glance-label">Timezone</div>
              <div className="mono small">{eng.timezone}</div>
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
