import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { api } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import { fmtRelative } from '../lib/format';
import { PageHeader, Panel, Loading, ErrorState } from '../components/ui';
import { CaptureButton } from '../components/CaptureButton';
import { useEngagementDetail } from './engagement/useEngagementDetail';
import { TeamTab } from './engagement/TeamTab';
import '../styles/team.css';

/** What each standard role covers, shown when a member has not written their own responsibilities. */
export const ROLE_DUTIES: Record<string, string[]> = {
  'Project Manager': ['Engagement details, scope, authorization and testing window', 'Lab 1 signs of compromise', 'Tracks checkpoints and the final submission', 'Runs the presentation'],
  'Recon Lead': ['Lab 2 recon items with sources and next steps', 'Links recon to evidence', 'Verifies the AI recon summary'],
  'Network Assessment Lead': ['Lab 3 scan of the assigned target', 'Normal purpose for services and investigation flags', 'Terminal screenshot of the scan', 'Verifies the AI scan interpretation'],
  'Vulnerability Lead': ['Lab 4 findings with impact and remediation', 'Validates confirmable findings', 'Top-three priorities with rationale', 'Verifies the AI plain-language explanation'],
  'AI/Reporting Lead': ['Connects the AI provider and runs the required AI sessions', 'Verifies AI answers against evidence', 'Executive summary, methodology, limitations, lessons learned', 'Exports the report'],
  'Evidence Custodian': ['Keeps every artifact in the Evidence Locker with title, source and time', 'Sanitization review before anything goes to the AI', 'Lab 5 capture and log imports', 'Builds the evidence package'],
};
const ROLES = Object.keys(ROLE_DUTIES);

interface Activity {
  id: number;
  ts: string;
  actor: string;
  summary: string;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

export default function Team() {
  const { eid } = useEngagement();
  const q = useEngagementDetail();
  const act = useQuery({ queryKey: ['activity', eid, 'team'], queryFn: () => api.get<Activity[]>(`/api/activity?engagement=${eid}&limit=500`), enabled: !!eid });
  if (q.isLoading) return <Loading rows={4} label="Loading team" />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const eng = q.data!;
  const team = eng.team;
  const activity = act.data ?? [];
  const byActor = (name: string) => activity.filter((a) => a.actor.trim().toLowerCase() === name.trim().toLowerCase());
  const covered = new Set(team.map((m) => m.role).filter(Boolean));

  return (
    <div className="team-page">
      <PageHeader
        title="Team"
        subtitle="Who is on the assessment, what each person owns, and what they have done in CyberDome."
        actions={<CaptureButton title="Team" label="Capture view" />}
      />

      <div className="team-roles" aria-label="Role coverage">
        {ROLES.map((r) => (
          <span key={r} className={`team-role-chip ${covered.has(r) ? 'on' : ''}`}>
            {covered.has(r) ? <CheckCircle2 aria-hidden /> : <Circle aria-hidden />} {r}
          </span>
        ))}
      </div>

      {team.length > 0 && (
        <div className="team-grid">
          {team.map((m) => {
            const mine = byActor(m.name);
            const duties = m.responsibilities.trim()
              ? m.responsibilities.split(/\n|;/).map((x) => x.trim()).filter(Boolean)
              : ROLE_DUTIES[m.role] ?? [];
            return (
              <article key={m.id} className="team-card">
                <header>
                  <span className="team-avatar" aria-hidden>{initials(m.name)}</span>
                  <span className="team-who">
                    <strong>{m.name}</strong>
                    <span>{m.role || 'No role yet'}</span>
                  </span>
                </header>
                {duties.length > 0 && (
                  <div>
                    <div className="team-label">Responsibilities{!m.responsibilities.trim() && m.role ? ' (standard for this role)' : ''}</div>
                    <ul className="team-duties">{duties.map((d) => <li key={d}>{d}</li>)}</ul>
                  </div>
                )}
                {m.contributions.trim() && (
                  <div>
                    <div className="team-label">Contribution statement</div>
                    <p className="team-contrib">{m.contributions}</p>
                  </div>
                )}
                <div className="team-activity">
                  <div className="team-label">Activity in CyberDome</div>
                  {mine.length ? (
                    <>
                      <span className="small">{mine.length} recorded action{mine.length === 1 ? '' : 's'} · last {fmtRelative(mine[0].ts)}</span>
                      <ul>{mine.slice(0, 3).map((a) => <li key={a.id} className="small faint">{a.summary}</li>)}</ul>
                    </>
                  ) : (
                    <span className="small faint">Nothing recorded under this name yet. Actions are credited to the name set in Settings → Analyst name.</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <TeamTab eng={eng} />
      {!team.length && (
        <Panel title="How team credit works">
          <p className="small" style={{ margin: 0 }}>
            Add each member with a role. Each person should set their own name in <strong>Settings → Analyst name</strong> before working, so the actions they take are credited to them here and in the report's contribution statement.
          </p>
        </Panel>
      )}
    </div>
  );
}
