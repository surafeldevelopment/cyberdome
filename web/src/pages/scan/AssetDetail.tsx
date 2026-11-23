import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Network, ShieldAlert, Archive, History } from 'lucide-react';
import { KpiCard, KpiRow, AssetCell, StatusPill } from '../../components/kit';
import { PageHeader, Panel, EmptyState, ErrorState, Loading, Notice, Provenance, Badge, Field, Select, KV, SeverityBadge, ValidationBadge } from '../../components/ui';
import { DataTable, type Column } from '../../components/DataTable';
import { EvidenceChips } from '../../components/evidence';
import { Modal, useToast } from '../../components/overlay';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtDateTime, fmtRelative, humanize } from '../../lib/format';
import { PortState, ScopeBadge, VersionBadge, osSourceLabel, svcLabel, type Asset, type Observation, type Service } from './shared';
import { ServiceDrawer } from './ServiceDrawer';
import '../../styles/scan.css';

interface AssetFull extends Asset {
  services: Service[];
  observations: (Observation & { scan_code: string })[];
  os_observations: { os_observation: string; observed_at: string | null; scan_code: string; evidence_id: string | null; evidence_code: string | null }[];
  findings: { id: string; code: string; title: string; severity: string; validation_status: string; status: string }[] & any;
  evidence: { id: string; code: string; title: string; status: string }[];
  scans: { id: string; code: string; created_at: string; scan_finished_at: string | null; status: string }[];
}

export default function AssetDetail() {
  const { id } = useParams();
  const { base, eid } = useEngagement();
  const [editing, setEditing] = useState(false);
  const [svc, setSvc] = useState<Service | null>(null);
  const q = useQuery({ queryKey: ['asset', eid, id], queryFn: () => api.get<AssetFull>(`${base}/assets/${id}`) });
  const a = q.data;
  const findingsList = (a?.findings ?? []) as AssetFull['findings'];

  const historyByService = useMemo(() => {
    const m = new Map<string, AssetFull['observations']>();
    for (const o of a?.observations ?? []) {
      const k = `${o.port}/${o.protocol}`;
      m.set(k, [...(m.get(k) ?? []), o]);
    }
    return m;
  }, [a]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!a) return <EmptyState title="Asset not found" />;

  const svcCols: Column<Service>[] = [
    { key: 'port', header: 'Port', render: (s) => <AssetCell icon={<Network />} mono title={`${s.port}/${s.protocol}`} sub={s.service_name ?? 'service unknown'} />, sortValue: (s) => s.port },
    { key: 'state', header: 'State', render: (s) => <PortState state={s.state} /> },
    { key: 'version', header: 'Product / version', render: (s) => <span className="scan-ver"><span className="mono clip" title={svcLabel(s)}>{svcLabel(s)}</span><VersionBadge status={s.version_status} /></span>, sortValue: (s) => svcLabel(s) },
    { key: 'normal_purpose', header: 'Normal purpose', render: (s) => (s.normal_purpose ? <span className="clamp-2 scan-purpose" title={s.normal_purpose}>{s.normal_purpose}</span> : <span className="faint nowrap">Not recorded</span>) },
    { key: 'needs_investigation', header: 'Investigate', render: (s) => (s.needs_investigation ? <span title={s.investigation_reason}><StatusPill tone="warn">Flagged</StatusPill></span> : <span className="faint">—</span>) },
    { key: 'last_seen', header: 'Last seen', render: (s) => <span className="small nowrap" title={`First seen ${fmtDateTime(s.first_seen)}\nLast seen ${fmtDateTime(s.last_seen)}\n${s.observation_count} observation(s)`}>{fmtRelative(s.last_seen)}<span className="faint"> · {s.observation_count} obs</span></span> },
  ];

  return (
    <div className="scan-module">
      <PageHeader
        crumbs={[{ label: 'Scan & Enumeration', to: '/scan' }, { label: 'Assets', to: '/scan' }, { label: a.code }]}
        title={<span><span className="mono">{a.ip ?? a.hostname}</span>{a.hostname && a.ip ? <span className="muted" style={{ fontWeight: 500 }}> · {a.hostname}</span> : null}</span>}
        subtitle={<span className="row" style={{ gap: 8 }}><span className="mono">{a.code}</span><ScopeBadge scope={a.scope} /><Provenance kind={a.origin === 'manual' ? 'entered' : 'imported'} detail={a.origin === 'manual' ? 'Added manually' : 'Created from scan import'} /></span>}
        actions={<button className="btn" onClick={() => setEditing(true)}><Pencil /> Edit asset</button>}
      />
      <KpiRow>
        <KpiCard icon={<Network />} label="Open services" value={a.open_services} pill={{ text: `${a.total_services} ports tracked`, tone: 'neutral' }} calc="Current (port, protocol) entries for this asset whose latest observed state is open. Secondary value: all tracked ports in any state." />
        <KpiCard icon={<ShieldAlert />} label="Linked findings" value={findingsList.length} pill={findingsList.length ? { text: `${findingsList.filter((f: any) => f.validation_status === 'validated').length} validated`, tone: 'neutral' } : null} to="/vulnerabilities" calc="Findings that list this asset as affected. Secondary value: how many an analyst has validated with evidence." />
        <KpiCard icon={<Archive />} label="Evidence items" value={a.evidence.length} pill={{ text: `${a.evidence.filter((e) => e.status === 'active').length} active`, tone: 'neutral' }} calc="Evidence Locker artifacts associated with this asset (scan files and any manually linked items)." />
        <KpiCard icon={<History />} label="Scan observations" value={a.observations.length} pill={{ text: `${a.scans.length} scan${a.scans.length === 1 ? '' : 's'}`, tone: 'neutral' }} calc="Every service observation recorded for this asset across all imported scans (history is append-only). Secondary value: the number of distinct scan imports that saw it." />
      </KpiRow>
      {a.scope.status === 'excluded' && <Notice tone="bad" title="Excluded target.">This host matches an explicitly excluded target ({a.scope.matched?.target}). Confirm with your instructor before using its results.</Notice>}
      {a.scope.status === 'not_in_scope' && <Notice tone="warn" title="Not in scope.">This host is not covered by any authorized target in the engagement.</Notice>}
      <div style={{ marginTop: 18 }}>
      <Panel title="Current services" hint="Latest observation per port" flush>
        <DataTable
          caption="Current services for this asset"
          rows={a.services}
          columns={svcCols}
          rowKey={(s) => s.id}
          onRowClick={setSvc}
          initialSort={{ key: 'port', dir: 'asc' }}
          empty={<EmptyState title="No services recorded">The scans that saw this host listed no individual ports.</EmptyState>}
        />
      </Panel>
      </div>
      <div className="grid span-main" style={{ marginTop: 18 }}>
        <div className="stack">
          <Panel title="Observation history" hint="Every scan observation, newest first">
            {historyByService.size === 0 ? (
              <p className="muted">No observations.</p>
            ) : (
              <div className="stack tight">
                {[...historyByService.entries()].map(([k, obs]) => (
                  <details key={k} className="obs-group">
                    <summary>
                      <span className="mono">{k}</span> <span className="faint small">· {obs.length} observation{obs.length === 1 ? '' : 's'}</span>
                    </summary>
                    <ul className="list-plain">
                      {obs.map((o) => (
                        <li key={o.id} className="small row" style={{ gap: 8 }}>
                          <span className="mono">{fmtDateTime(o.observed_at ?? o.created_at)}</span>
                          <PortState state={o.state} />
                          <span className="mono muted">{o.service_name ?? '—'} {svcLabel(o)}</span>
                          <VersionBadge status={o.version_status} />
                          <Link className="mono" to={`/scan/imports/${o.scan_import_id}`}>{o.scan_code}</Link>
                          {o.evidence_id && <EvidenceChips items={[{ id: o.evidence_id, code: o.evidence_code ?? '', status: o.evidence_status ?? 'active' }]} />}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Asset profile">
            <KV
              items={[
                ['Hostnames', a.hostnames.length ? <span className="mono">{a.hostnames.join(', ')}</span> : '—'],
                ['MAC', a.mac ? <span className="mono">{a.mac}</span> : '—'],
                ['OS', a.os_name ? <span className="stack" style={{ gap: 2, alignItems: 'flex-start' }}><span>{a.os_name}{a.os_accuracy !== null ? ` (${a.os_accuracy}% accuracy)` : ''}</span><span className="faint tiny">{osSourceLabel[a.os_source]}</span></span> : <span className="faint">Unknown</span>],
                ['Criticality', a.criticality === 'unknown' ? <span className="faint">Not rated</span> : humanize(a.criticality)],
                ['Role', a.role || '—'],
                ['Host state', a.host_state],
                ['First seen', fmtDateTime(a.first_seen)],
                ['Last seen', fmtDateTime(a.last_seen)],
                ['Notes', a.notes ? <span style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</span> : '—'],
              ]}
            />
          </Panel>
          <Panel title="OS observations">
            {a.os_observations.length ? (
              <ul className="list-plain small">
                {a.os_observations.map((o, i) => (
                  <li key={i}>
                    <div>{o.os_observation}</div>
                    <div className="row faint" style={{ gap: 6 }}>
                      {fmtDateTime(o.observed_at)} · <span className="mono">{o.scan_code}</span>
                      {o.evidence_id && <EvidenceChips items={[{ id: o.evidence_id, code: o.evidence_code ?? '' }]} />}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No OS fingerprint was reported in any imported scan.</p>
            )}
          </Panel>
          <Panel title="Linked findings">
            {findingsList.length ? (
              <ul className="list-plain">
                {findingsList.map((f: any) => (
                  <li key={f.id} className="stack tight">
                    <AssetCell icon={<ShieldAlert />} to={`/vulnerabilities/${f.id}`} title={f.title} sub={f.code} />
                    <span className="row" style={{ gap: 6, paddingLeft: 50 }}>
                      <SeverityBadge severity={f.severity} />
                      <ValidationBadge value={f.validation_status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No findings reference this asset. <Link to="/vulnerabilities">Record a finding</Link> when evidence supports one. An open port alone is not a vulnerability.</p>
            )}
          </Panel>
          <Panel title="Evidence">
            <EvidenceChips items={a.evidence} empty="No evidence linked" />
            {a.scans.length > 0 && (
              <p className="small muted" style={{ marginTop: 10 }}>
                Seen in scans: {a.scans.map((s, i) => <span key={s.id}>{i > 0 && ', '}<Link className="mono" to={`/scan/imports/${s.id}`}>{s.code}</Link></span>)}
              </p>
            )}
          </Panel>
        </div>
      </div>
      <EditAssetModal asset={a} open={editing} onClose={() => setEditing(false)} />
      <ServiceDrawer service={svc} onClose={() => setSvc(null)} />
    </div>
  );
}

function EditAssetModal({ asset, open, onClose }: { asset: AssetFull; open: boolean; onClose: () => void }) {
  const { base } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [crit, setCrit] = useState(asset.criticality);
  const [role, setRole] = useState(asset.role);
  const [notes, setNotes] = useState(asset.notes);
  const [os, setOs] = useState(asset.os_source === 'analyst' ? asset.os_name ?? '' : '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCrit(asset.criticality);
    setRole(asset.role);
    setNotes(asset.notes);
    setOs(asset.os_source === 'analyst' ? asset.os_name ?? '' : '');
    setErr('');
  }, [open, asset]);
  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { criticality: crit, role, notes };
      if (os.trim() || asset.os_source === 'analyst') body.os_name = os.trim() || null;
      await api.patch(`${base}/assets/${asset.id}`, body);
      qc.invalidateQueries();
      toast.success(`Updated ${asset.code}.`);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Edit ${asset.code}`} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Asset criticality" htmlFor="a-crit" help="Business importance; used in prioritization.">
          <Select id="a-crit" value={crit} onChange={(v) => setCrit(v as any)} options={['unknown', 'low', 'medium', 'high', 'critical']} />
        </Field>
        <Field label="Role" htmlFor="a-role"><input id="a-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Public web server" /></Field>
        <Field full label="Analyst OS determination (optional)" htmlFor="a-os" help={asset.os_source === 'detected' ? `Scanner reported: ${asset.os_name}. Entering a value replaces it with an analyst-labeled OS; clear it to return to unknown.` : 'Labeled as analyst-entered, not detected.'}>
          <input id="a-os" value={os} onChange={(e) => setOs(e.target.value)} placeholder="e.g. Ubuntu 20.04 (confirmed from instructor notes)" />
        </Field>
        <Field full label="Notes" htmlFor="a-notes"><textarea id="a-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <div className="full"><Notice tone="bad">{err}</Notice></div>}
      </div>
    </Modal>
  );
}
