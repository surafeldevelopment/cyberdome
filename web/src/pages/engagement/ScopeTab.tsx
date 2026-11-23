import { useState } from 'react';
import { Plus, Pencil, Trash2, Target, Network, Globe, Server, ShieldOff } from 'lucide-react';
import { api } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import type { Engagement, ScopeEntry } from '../../lib/types';
import { Panel, Field, EmptyState } from '../../components/ui';
import { AssetCell } from '../../components/kit';
import { ConfirmDialog, Modal } from '../../components/overlay';
import { humanize } from '../../lib/format';
import { useEngagementMutation } from './useEngagementDetail';

type Draft = { id?: string; kind: 'in' | 'out'; target: string; notes: string };

const TYPE_LABEL: Record<string, string> = { cidr: 'CIDR network', range: 'IP range', ip: 'IP address', url: 'URL', domain: 'Domain', hostname: 'Hostname', other: 'Other' };
const TYPE_ICON: Record<string, any> = { cidr: Network, range: Network, ip: Server, hostname: Server, domain: Globe, url: Globe };

export function ScopeTab({ eng }: { eng: Engagement }) {
  const { eid } = useEngagement();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [del, setDel] = useState<ScopeEntry | null>(null);

  const save = useEngagementMutation((d: Draft) => {
    const body = { kind: d.kind, target: d.target.trim(), notes: d.notes };
    return d.id ? api.patch<Engagement>(`/api/engagements/${eid}/scope/${d.id}`, body) : api.post<Engagement>(`/api/engagements/${eid}/scope`, body);
  }, 'Scope saved.');
  const remove = useEngagementMutation((s: ScopeEntry) => api.del<Engagement>(`/api/engagements/${eid}/scope/${s.id}`), 'Scope entry removed.');

  const list = (kind: 'in' | 'out') => {
    const rows = eng.scope.filter((s) => s.kind === kind);
    if (!rows.length)
      return (
        <EmptyState icon={<Target />} title={kind === 'in' ? 'No authorized targets yet' : 'No explicit exclusions yet'}>
          {kind === 'in'
            ? 'Add the lab targets your instructor approved. Scans only run against what is listed here.'
            : 'List anything that must not be touched, such as gateways, other teams’ hosts, or college systems.'}
        </EmptyState>
      );
    return (
      <div className="table-wrap">
        <table className="data scope-table">
          <caption className="sr-only">{kind === 'in' ? 'Authorized targets' : 'Excluded targets'}</caption>
          <thead>
            <tr><th>Target</th><th className="act">Action</th></tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const Icon = kind === 'out' ? ShieldOff : TYPE_ICON[s.target_type] ?? Target;
              return (
                <tr key={s.id}>
                  <td>
                    <AssetCell icon={<Icon />} title={s.target} mono sub={`${TYPE_LABEL[s.target_type] ?? humanize(s.target_type)}${s.notes ? ` · ${s.notes}` : ''}`} />
                  </td>
                  <td className="act nowrap">
                    <button className="kebab" aria-label={`Edit ${s.target}`} title="Edit" onClick={() => setDraft({ id: s.id, kind: s.kind, target: s.target, notes: s.notes })}><Pencil size={16} /></button>
                    <button className="kebab" aria-label={`Remove ${s.target}`} title="Remove" onClick={() => setDel(s)}><Trash2 size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="stack">
        <Panel title="Authorized targets and networks" flush actions={<button className="btn sm primary" onClick={() => setDraft({ kind: 'in', target: '', notes: '' })}><Plus /> Add target</button>}>
          {list('in')}
        </Panel>
        <Panel title="Explicitly excluded targets" flush actions={<button className="btn sm" onClick={() => setDraft({ kind: 'out', target: '', notes: '' })}><Plus /> Add exclusion</button>}>
          {list('out')}
        </Panel>
      </div>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit scope entry' : draft?.kind === 'out' ? 'Add excluded target' : 'Add authorized target'}
        size="narrow"
        footer={
          <>
            <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn primary" disabled={!draft?.target.trim() || save.isPending} onClick={() => draft && save.mutate(draft, { onSuccess: () => setDraft(null) })}>
              {save.isPending && <span className="spinner" />} Save
            </button>
          </>
        }
      >
        {draft && (
          <div className="stack tight">
            <Field label="List" htmlFor="s-kind">
              <select id="s-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'in' | 'out' })}>
                <option value="in">Authorized (in scope)</option>
                <option value="out">Excluded (out of scope)</option>
              </select>
            </Field>
            <Field label="Target" htmlFor="s-target" help="CIDR (192.0.2.0/24), range (192.0.2.10-20), IP, hostname, domain, or URL. The type is detected automatically.">
              <input id="s-target" className="mono-input" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} autoFocus />
            </Field>
            <Field label="Notes" htmlFor="s-notes">
              <textarea id="s-notes" rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Source of authorization, restrictions, assigned team…" />
            </Field>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        title="Remove scope entry"
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={() => del && remove.mutate(del, { onSuccess: () => setDel(null) })}
      >
        <p>Remove <code>{del?.target}</code> from the {del?.kind === 'in' ? 'authorized' : 'excluded'} list? Imported hosts are re-checked against the remaining entries.</p>
      </ConfirmDialog>
    </div>
  );
}
