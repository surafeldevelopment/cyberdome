import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorCog, Play } from 'lucide-react';
import { Panel, Notice } from '../../components/ui';
import { Modal, useToast } from '../../components/overlay';
import { api, errorMessage, PREVIEW } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtRelative } from '../../lib/format';
import '../../styles/run.css';

interface Snap { id: string; code: string; title: string; collected_at: string | null }

/** Read-only snapshot of the computer running CyberDome, stored as unreviewed evidence. */
export function HostSnapshotPanel({ isDemo }: { isDemo: boolean }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const cap = useQuery({ queryKey: ['scan-capability', eid], queryFn: () => api.get<{ host_snapshot_commands: string[]; platform: string }>(`${base}/scan-runs/capability`), enabled: open });
  const snaps = useQuery({
    queryKey: ['evidence', eid, 'host-snapshots'],
    queryFn: () => api.get<{ items: Snap[] } | Snap[]>(`${base}/evidence?tag=host-snapshot&limit=5`),
  });
  const list: Snap[] = Array.isArray(snaps.data) ? snaps.data : snaps.data?.items ?? [];

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ evidence_id: string; evidence_code: string; commands: { ok: boolean }[] }>(`${base}/host-snapshot`, { confirm: true });
      toast.success(`Saved ${r.evidence_code}: ${r.commands.filter((c) => c.ok).length} of ${r.commands.length} commands returned output.`);
      qc.invalidateQueries({ queryKey: ['evidence'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setOpen(false);
      setAck(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Collect from this computer"
      hint="Read-only host snapshot for reviewing signs of compromise"
      actions={<button className="btn primary sm" disabled={isDemo || PREVIEW} onClick={() => setOpen(true)}><MonitorCog /> Take snapshot</button>}
    >
      <p className="small faint" style={{ marginTop: 0 }}>
        Records listening ports and connections, running processes, local accounts, administrators, scheduled tasks and network settings of the machine CyberDome runs on. The output becomes an evidence file; cite its Evidence ID in the indicators you write.
      </p>
      {isDemo && <Notice tone="warn">Switch to your real engagement to collect a snapshot.</Notice>}
      {list.length > 0 && (
        <ul className="collect-list">
          {list.map((s) => (
            <li key={s.id} className="small"><Link className="mono" to={`/evidence/${s.id}`}>{s.code}</Link> <span className="faint">· {s.title} · {fmtRelative(s.collected_at)}</span></li>
          ))}
        </ul>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Take a host snapshot"
        size="narrow"
        footer={<><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={!ack || busy} onClick={run}><Play /> {busy ? 'Collecting…' : 'Collect'}</button></>}
      >
        <div className="stack tight">
          <p className="small" style={{ margin: 0 }}>These fixed, read-only commands run on this computer. Nothing is changed and nothing is uploaded.</p>
          <ul className="collect-list">{(cap.data?.host_snapshot_commands ?? []).map((c) => <li key={c}><code>{c}</code></li>)}</ul>
          <Notice tone="info">The file may contain usernames and process names, so it is saved as not reviewed and cannot be sent to the AI analyst until you review it.</Notice>
          <label className="check-row confirm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>This computer is a system I am allowed to examine for this engagement.</span>
          </label>
        </div>
      </Modal>
    </Panel>
  );
}
