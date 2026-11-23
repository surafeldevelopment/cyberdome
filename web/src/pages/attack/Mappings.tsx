import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckCircle2, XCircle, Trash2, Target } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtDateTime } from '../../lib/format';
import { Panel, EmptyState, ErrorState, Loading, Field, Select, Notice, Provenance } from '../../components/ui';
import { AssetCell, StatusPill } from '../../components/kit';
import { DataTable } from '../../components/DataTable';
import { Modal, ConfirmDialog, useToast } from '../../components/overlay';

interface Mapping {
  id: string;
  target_type: 'finding' | 'timeline' | 'indicator';
  target_id: string;
  technique_id: string;
  technique_name: string;
  tactics: string;
  rationale: string;
  origin: 'analyst' | 'ai_suggested';
  status: 'proposed' | 'verified' | 'rejected';
  ai_session_id: string | null;
  ai_session_code: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
  target: { id: string; code: string; label: string; lab?: string } | null;
}

export function targetRoute(type: string, t: { id: string; lab?: string }) {
  if (type === 'finding') return `/vulnerabilities/${t.id}`;
  if (type === 'timeline') return `/attack?tab=timeline&focus=${t.id}`;
  return t.lab === 'lab1' ? `/engagement?tab=indicators&focus=${t.id}` : `/attack?tab=indicators&focus=${t.id}`;
}

function StatusBadge({ s }: { s: string }) {
  if (s === 'verified') return <StatusPill tone="ok">Verified</StatusPill>;
  if (s === 'rejected') return <StatusPill tone="muted">Rejected</StatusPill>;
  return <span title="Proposed: not verified by a person"><StatusPill tone="warn">Proposed</StatusPill></span>;
}

export function MappingsTab() {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['attack-mappings', eid], queryFn: () => api.get<Mapping[]>(`${base}/attack-mappings`), enabled: !!eid });
  const [adding, setAdding] = useState(false);
  const [verifying, setVerifying] = useState<Mapping | null>(null);
  const [rationale, setRationale] = useState('');
  const [deleting, setDeleting] = useState<Mapping | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['attack-mappings', eid] });
    qc.invalidateQueries({ queryKey: ['timeline', eid] });
    qc.invalidateQueries({ queryKey: ['tracker', eid] });
  };
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.patch(`${base}/attack-mappings/${id}`, body),
    onSuccess: (m: any) => { invalidate(); toast.success(`${m.technique_id} ${m.status}`); setVerifying(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`${base}/attack-mappings/${id}`),
    onSuccess: () => { invalidate(); toast.success('Mapping deleted'); setDeleting(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="stack">
      <Notice tone="info" title="Map only what the evidence supports.">
        Each mapping links a finding, timeline event or indicator to a MITRE ATT&CK technique with a written rationale. AI-suggested mappings start as proposals; only human-verified mappings appear in the report.
      </Notice>
      <Panel title="ATT&CK Mappings" flush className="map-panel" actions={<button className="btn primary sm" onClick={() => setAdding(true)}><Plus /> Add mapping</button>}>
        {q.isError ? <div style={{ padding: 16 }}><ErrorState error={q.error} retry={() => q.refetch()} /></div> : q.isLoading ? <div style={{ padding: 16 }}><Loading /></div> : (
          <DataTable
            caption="ATT&CK mappings"
            rows={q.data ?? []}
            rowKey={(r) => r.id}
            initialSort={{ key: 'created_at', dir: 'desc' }}
            columns={[
              { key: 'technique_id', header: 'Technique', render: (r) => (
                <AssetCell
                  icon={<Target />}
                  title={<><a className="mono" href={`https://attack.mitre.org/techniques/${r.technique_id.replace('.', '/')}/`} target="_blank" rel="noreferrer noopener" title="Open the official MITRE ATT&CK page">{r.technique_id}</a> {r.technique_name || <span className="faint">Name not recorded</span>}</>}
                  sub={r.tactics || 'Tactic not recorded'}
                />
              ) },
              { key: 'target', header: 'Mapped record', sortValue: (r) => r.target?.code, render: (r) => r.target ? (
                <div><Link className="mono" to={targetRoute(r.target_type, r.target)}>{r.target.code}</Link> <span className="tiny faint">{r.target_type}</span><div className="small clip" style={{ maxWidth: '30ch' }}>{r.target.label}</div></div>
              ) : <span className="faint">Record deleted</span> },
              { key: 'rationale', header: 'Evidence-based rationale', render: (r) => <span className="small clamp-2" style={{ maxWidth: '40ch' }}>{r.rationale || <span className="faint">Not written</span>}</span> },
              { key: 'origin', header: 'Origin', render: (r) => (r.origin === 'ai_suggested' ? <span><Provenance kind="ai" />{r.ai_session_id && <Link className="tiny" to={`/ai/${r.ai_session_id}`} style={{ marginLeft: 6 }}>{r.ai_session_code}</Link>}</span> : <Provenance kind="entered" />) },
              { key: 'status', header: 'Status', render: (r) => <div><StatusBadge s={r.status} />{r.reviewed_by && <div className="tiny faint">by {r.reviewed_by}</div>}</div> },
              { key: 'created_at', header: 'Created', render: (r) => <span className="small nowrap">{fmtDateTime(r.created_at)}</span> },
              { key: 'actions', header: <span className="sr-only">Actions</span>, sortable: false, render: (r) => (
                <span className="row nowrap" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  {r.status !== 'verified' && <button className="btn sm" onClick={() => { setVerifying(r); setRationale(r.rationale); }}><CheckCircle2 /> Verify</button>}
                  {r.status !== 'rejected' && <button className="btn ghost sm" onClick={() => patch.mutate({ id: r.id, body: { status: 'rejected' } })}>Reject</button>}
                  {r.status === 'rejected' && <button className="btn ghost sm" onClick={() => patch.mutate({ id: r.id, body: { status: 'proposed' } })}>Reopen</button>}
                  <button className="btn ghost icon sm" aria-label={`Delete mapping ${r.technique_id}`} onClick={() => setDeleting(r)}><Trash2 /></button>
                </span>
              ) },
            ]}
            empty={<EmptyState icon={<Target />} title="No ATT&CK mappings" actions={<button className="btn primary" onClick={() => setAdding(true)}><Plus /> Add mapping</button>}>Map observed activity to ATT&CK techniques only when the evidence supports it. For example repeated authentication failures to T1110 (Brute Force).</EmptyState>}
          />
        )}
      </Panel>
      <AddMapping open={adding} onClose={() => setAdding(false)} />
      <Modal open={!!verifying} onClose={() => setVerifying(null)} title={`Verify ${verifying?.technique_id} on ${verifying?.target?.code ?? ''}`} footer={<><button className="btn ghost" onClick={() => setVerifying(null)}>Cancel</button><button className="btn primary" disabled={!rationale.trim() || patch.isPending} onClick={() => patch.mutate({ id: verifying!.id, body: { status: 'verified', rationale } })}>Mark verified</button></>}>
        <div className="stack tight">
          <p className="small muted">Confirm that the linked evidence actually shows this technique. Explain which Evidence IDs support it.</p>
          <Field label="Rationale" htmlFor="mv-rat"><textarea id="mv-rat" value={rationale} onChange={(e) => setRationale(e.target.value)} /></Field>
        </div>
      </Modal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => del.mutate(deleting!.id)} busy={del.isPending} title={`Delete ${deleting?.technique_id}?`} confirmLabel="Delete mapping">
        <p>Deleting removes the mapping record. To keep a record of a rejected suggestion, use Reject instead.</p>
      </ConfirmDialog>
    </div>
  );
}

function AddMapping({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const targets = useQuery({ queryKey: ['attack-targets', eid], queryFn: () => api.get<any>(`${base}/attack-targets`), enabled: open && !!eid });
  const [f, setF] = useState({ target_type: 'timeline', target_id: '', technique_id: '', technique_name: '', tactics: '', rationale: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v, ...(k === 'target_type' ? { target_id: '' } : {}) }));
  const list = targets.data ? (f.target_type === 'finding' ? targets.data.findings : f.target_type === 'timeline' ? targets.data.timeline : targets.data.indicators) : [];
  const validId = /^T\d{4}(\.\d{3})?$/i.test(f.technique_id.trim());
  const save = useMutation({
    mutationFn: () => api.post(`${base}/attack-mappings`, { ...f, technique_id: f.technique_id.trim(), origin: 'analyst' }),
    onSuccess: (m: any) => {
      qc.invalidateQueries({ queryKey: ['attack-mappings', eid] });
      qc.invalidateQueries({ queryKey: ['timeline', eid] });
      toast.success(`Proposed ${m.technique_id} for ${m.target?.code}`);
      setF({ target_type: f.target_type, target_id: '', technique_id: '', technique_name: '', tactics: '', rationale: '' });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title="Add ATT&CK mapping" footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.target_id || !validId || save.isPending} onClick={() => save.mutate()}>Add as proposal</button></>}>
      <div className="form-grid">
        <Field label="Record type" htmlFor="am-tt"><Select id="am-tt" value={f.target_type} onChange={set('target_type')} options={[{ value: 'timeline', label: 'Timeline event' }, { value: 'indicator', label: 'Indicator' }, { value: 'finding', label: 'Finding' }]} /></Field>
        <Field label="Record" htmlFor="am-t">
          <Select id="am-t" value={f.target_id} onChange={set('target_id')} placeholder={targets.isLoading ? 'Loading…' : list.length ? 'Choose a record' : 'No records of this type'} options={list.map((t: any) => ({ value: t.id, label: `${t.code} · ${String(t.label).slice(0, 70)}` }))} />
        </Field>
        <Field label="Technique ID" htmlFor="am-id" error={f.technique_id && !validId ? 'Use the form T1110 or T1110.001' : undefined}><input id="am-id" className="mono-input" value={f.technique_id} onChange={(e) => set('technique_id')(e.target.value)} placeholder="T1110" /></Field>
        <Field label="Technique name" htmlFor="am-n" help="Leave blank to fill from cached ATT&CK data when available"><input id="am-n" value={f.technique_name} onChange={(e) => set('technique_name')(e.target.value)} /></Field>
        <Field label="Tactic(s)" full htmlFor="am-tac"><input id="am-tac" value={f.tactics} onChange={(e) => set('tactics')(e.target.value)} placeholder="e.g. Credential Access" /></Field>
        <Field label="Rationale: which evidence supports this mapping?" full htmlFor="am-r"><textarea id="am-r" value={f.rationale} onChange={(e) => set('rationale')(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
