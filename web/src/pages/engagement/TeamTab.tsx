import { useState } from 'react';
import { Plus, Pencil, Trash2, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import type { Engagement, TeamMember } from '../../lib/types';
import { Panel, Field, EmptyState } from '../../components/ui';
import { StatusPill } from '../../components/kit';
import { ConfirmDialog, Modal } from '../../components/overlay';
import { useEngagementMutation } from './useEngagementDetail';

const ROLE_SUGGEST = ['Recon Lead', 'Network Assessment Lead', 'Vulnerability Lead', 'AI/Reporting Lead', 'Evidence Custodian', 'Project Manager'];
type Draft = { id?: string; name: string; role: string; responsibilities: string; contributions: string };

export function TeamTab({ eng }: { eng: Engagement }) {
  const { eid } = useEngagement();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [del, setDel] = useState<TeamMember | null>(null);
  const save = useEngagementMutation((d: Draft) => {
    const body = { name: d.name.trim(), role: d.role, responsibilities: d.responsibilities, contributions: d.contributions };
    return d.id ? api.patch<Engagement>(`/api/engagements/${eid}/team/${d.id}`, body) : api.post<Engagement>(`/api/engagements/${eid}/team`, body);
  }, 'Team member saved.');
  const remove = useEngagementMutation((m: TeamMember) => api.del<Engagement>(`/api/engagements/${eid}/team/${m.id}`), 'Team member removed.');

  return (
    <Panel
      flush
      title="Team members and roles"
      hint="Used for the team contribution statement in the report"
      actions={<button className="btn sm primary" onClick={() => setDraft({ name: '', role: '', responsibilities: '', contributions: '' })}><Plus /> Add member</button>}
    >
      {!eng.team.length ? (
        <EmptyState icon={<Users />} title="No team members recorded">
          Add each member with their role (for example Recon Lead, Network Assessment Lead, Vulnerability Lead, AI/Reporting Lead) and what they are responsible for.
        </EmptyState>
      ) : (
        <div className="table-wrap team-wrap">
          <table className="data team-table">
            <caption className="sr-only">Team members</caption>
            <thead>
              <tr><th>Member</th><th>Responsibilities</th><th>Contribution statement</th><th className="act">Action</th></tr>
            </thead>
            <tbody>
              {eng.team.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="cell-asset">
                      <span className="avatar" aria-hidden>{m.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                      <span className="t"><strong>{m.name}</strong><span>{m.role || 'Role not set'}</span></span>
                    </span>
                  </td>
                  <td className="small"><span className="clamp-2">{m.responsibilities || <span className="faint">—</span>}</span></td>
                  <td>
                    {m.contributions ? (
                      <span className="contrib"><StatusPill tone="ok">Recorded</StatusPill><span className="small muted clamp-2">{m.contributions}</span></span>
                    ) : (
                      <StatusPill tone="muted">Not yet recorded</StatusPill>
                    )}
                  </td>
                  <td className="act nowrap">
                    <button className="kebab" aria-label={`Edit ${m.name}`} title="Edit" onClick={() => setDraft({ id: m.id, name: m.name, role: m.role, responsibilities: m.responsibilities, contributions: m.contributions })}><Pencil size={16} /></button>
                    <button className="kebab" aria-label={`Remove ${m.name}`} title="Remove" onClick={() => setDel(m)}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit team member' : 'Add team member'}
        footer={
          <>
            <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn primary" disabled={!draft?.name.trim() || save.isPending} onClick={() => draft && save.mutate(draft, { onSuccess: () => setDraft(null) })}>
              {save.isPending && <span className="spinner" />} Save
            </button>
          </>
        }
      >
        {draft && (
          <div className="form-grid">
            <Field label="Name" htmlFor="t-name">
              <input id="t-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus maxLength={120} />
            </Field>
            <Field label="Role" htmlFor="t-role">
              <input id="t-role" list="role-list" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} maxLength={120} />
              <datalist id="role-list">{ROLE_SUGGEST.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="Responsibilities" htmlFor="t-resp" full>
              <textarea id="t-resp" rows={3} value={draft.responsibilities} onChange={(e) => setDraft({ ...draft, responsibilities: e.target.value })} />
            </Field>
            <Field label="Contributions (for the team contribution statement)" htmlFor="t-contrib" full help="Write what this person actually did. Fill in as the project progresses.">
              <textarea id="t-contrib" rows={4} value={draft.contributions} onChange={(e) => setDraft({ ...draft, contributions: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Remove team member" confirmLabel="Remove" busy={remove.isPending} onConfirm={() => del && remove.mutate(del, { onSuccess: () => setDel(null) })}>
        <p>Remove {del?.name} from this engagement? Activity already recorded under their name is kept.</p>
      </ConfirmDialog>
    </Panel>
  );
}
