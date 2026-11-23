import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Download, FileUp, Flag, Network, Plus, Server, CheckCircle2, Circle, FileCode2, Monitor, MoreVertical, History, Play } from 'lucide-react';
import { KpiCard, KpiRow, AssetCell, RowAction, StatusPill } from '../../components/kit';
import { PageHeader, Panel, Tabs, useTab, EmptyState, ErrorState, Loading, Notice, Provenance, Badge, Field, Select, HowCalculated } from '../../components/ui';
import { DataTable, matchText, type Column } from '../../components/DataTable';
import { CaptureButton } from '../../components/CaptureButton';
import { EvidenceChips, FileDrop } from '../../components/evidence';
import { Modal, useToast } from '../../components/overlay';
import { api, errorMessage, ApiError, PREVIEW } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtDateTime, fmtRelative, fromLocalInput, download } from '../../lib/format';
import { ImportStatus, PortState, ScopeBadge, SearchField, VersionBadge, osSourceLabel, svcLabel, type Asset, type ScanImport, type Service, type ScopeResult } from './shared';
import { ServiceDrawer } from './ServiceDrawer';
import { RunScanModal, RunsTab, useScanRuns } from './RunScan';
import '../../styles/scan.css';

export default function ScanPage() {
  const { base, eid } = useEngagement();
  const [tab, setTab] = useTab('assets');
  const assets = useQuery({ queryKey: ['assets', eid], queryFn: () => api.get<Asset[]>(`${base}/assets`) });
  const services = useQuery({ queryKey: ['services', eid], queryFn: () => api.get<Service[]>(`${base}/services`) });
  const imports = useQuery({ queryKey: ['scan-imports', eid], queryFn: () => api.get<ScanImport[]>(`${base}/scan-imports`) });
  const openCount = services.data?.filter((s) => s.state === 'open').length;
  const flaggedCount = services.data?.filter((s) => s.needs_investigation).length;
  const purposeCount = services.data?.filter((s) => s.normal_purpose.trim()).length;
  const inScope = assets.data?.filter((a) => a.scope.status === 'in_scope').length;
  const latest = imports.data?.length ? [...imports.data].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] : null;
  const n = (v: number | undefined) => (v === undefined ? '—' : v);
  const runs = useScanRuns();
  const [running, setRunning] = useState(false);
  const activeRuns = runs.data?.filter((r) => r.status === 'running').length ?? 0;
  const qc = useQueryClient();
  const prevActive = useRef(activeRuns);
  useEffect(() => {
    // When a run finishes, refresh everything it imported.
    if (prevActive.current > 0 && activeRuns === 0) for (const k of ['assets', 'services', 'scan-imports', 'evidence', 'dashboard', 'tracker']) qc.invalidateQueries({ queryKey: [k] });
    prevActive.current = activeRuns;
  }, [activeRuns, qc]);

  return (
    <div className="scan-module">
      <PageHeader
        title="Scan & Enumeration"
        subtitle="Hosts, ports, services, versions, and OS observations from authorized scans. Run Nmap here against confirmed in-scope targets, or import output you collected elsewhere."
        actions={
          <>
            <button className="btn ghost" onClick={() => setTab('import')}>
              <FileUp /> Import scan
            </button>
            <button className="btn primary" onClick={() => setRunning(true)} disabled={PREVIEW}>
              <Play /> Run scan
            </button>
          </>
        }
      />
      <KpiRow>
        <KpiCard
          icon={<Server />}
          label="Assets discovered"
          value={n(assets.data?.length)}
          pill={assets.data ? { text: `${inScope ?? 0} in scope`, tone: 'neutral' } : null}
          onClick={() => setTab('assets')}
          calc="Distinct hosts (one asset per IP address) from imported scans or manual entry. Secondary value: assets matching an authorized scope target."
        />
        <KpiCard
          icon={<Network />}
          label="Open service endpoints"
          value={n(openCount)}
          pill={services.data ? { text: `${services.data.length} tracked`, tone: 'neutral' } : null}
          onClick={() => setTab('services')}
          calc="Current (asset, port, protocol) entries whose latest observed state is open. Secondary value: all tracked port entries in any state."
        />
        <KpiCard
          icon={<Flag />}
          label="Flagged for investigation"
          value={n(flaggedCount)}
          pill={services.data ? { text: `${purposeCount ?? 0} purposes noted`, tone: (purposeCount ?? 0) >= 5 ? 'ok' : 'warn' } : null}
          onClick={() => setTab('services')}
          calc="Services an analyst flagged as needing further investigation. Secondary value: services with a recorded normal purpose (Lab 3 asks for at least 5)."
        />
        <KpiCard
          icon={<History />}
          label="Scan imports"
          value={n(imports.data?.length)}
          pill={latest ? { text: `Latest ${latest.code}`, tone: latest.status === 'complete' ? 'ok' : latest.status === 'failed' ? 'bad' : 'warn' } : null}
          onClick={() => setTab('history')}
          calc="Every scan file imported for this engagement, including partial, duplicate and stored-only imports. Secondary value: the most recent import and its status."
        />
      </KpiRow>
      <Tabs
        label="Scan views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'assets', label: 'Assets', count: assets.data?.length },
          { id: 'services', label: 'Services', count: openCount },
          { id: 'runs', label: activeRuns ? `Runs · ${activeRuns} running` : 'Runs', count: activeRuns ? undefined : runs.data?.length },
          { id: 'history', label: 'Scan history', count: imports.data?.length },
          { id: 'import', label: 'Import' },
        ]}
      />
      {tab === 'assets' && <AssetsTab q={assets} onImport={() => setTab('import')} />}
      {tab === 'services' && <ServicesTab q={services} onImport={() => setTab('import')} />}
      {tab === 'history' && <HistoryTab q={imports} onImport={() => setTab('import')} />}
      {tab === 'runs' && <RunsTab onRun={() => setRunning(true)} />}
      {tab === 'import' && <ImportTab />}
      <RunScanModal open={running} onClose={() => setRunning(false)} onStarted={() => setTab('runs')} />
    </div>
  );
}

function NoScanData({ onImport }: { onImport: () => void }) {
  return (
    <EmptyState
      icon={<Network />}
      title="No scan results imported yet"
      actions={
        <>
          <button className="btn primary" onClick={onImport}>
            <FileUp /> Import scan output
          </button>
        </>
      }
    >
      Run Nmap from here against a confirmed in-scope target, or import XML you produced with{' '}
      <code>nmap -sV -oX scan.xml &lt;INSTRUCTOR-APPROVED-TARGET&gt;</code>. Hosts and services appear only after real output is imported.
    </EmptyState>
  );
}

/* ------------------------------------------------------------------ Assets */
function AssetsTab({ q, onImport }: { q: UseQueryResult<Asset[]>; onImport: () => void }) {
  const { base } = useEngagement();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('');
  const [crit, setCrit] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = useMemo(
    () =>
      (q.data ?? []).filter(
        (a) => matchText(a, search, ['code', 'ip', 'hostname', 'os_name', 'role', (x) => x.hostnames.join(' ')]) && (!scope || a.scope.status === scope) && (!crit || a.criticality === crit),
      ),
    [q.data, search, scope, crit],
  );
  const cols: Column<Asset>[] = [
    {
      key: 'code',
      header: 'Asset',
      render: (a) => <AssetCell icon={<Monitor />} to={`/scan/assets/${a.id}`} mono title={a.ip ?? a.hostname ?? a.code} sub={<span title={a.hostnames.join(', ')}>{[a.hostname && a.ip ? a.hostname : null, a.code].filter(Boolean).join(' · ')}</span>} />,
      sortValue: (a) => (a.ip ?? '').split('.').map((n) => n.padStart(3, '0')).join('.') || a.code,
    },
    {
      key: 'os_name',
      header: 'OS observation',
      render: (a) =>
        a.os_name ? (
          <span className="scan-os">
            <span className="clip" title={a.os_name}>{a.os_name}{a.os_accuracy !== null ? <span className="faint"> · {a.os_accuracy}%</span> : null}</span>
            <Provenance kind={a.os_source === 'analyst' ? 'entered' : 'imported'} detail={osSourceLabel[a.os_source]} />
          </span>
        ) : (
          <span className="faint">Unknown</span>
        ),
    },
    { key: 'open_services', header: 'Open / findings', render: (a) => <span className="nowrap" title={`${a.open_services} open of ${a.total_services} tracked ports · ${a.findings} linked findings`}>{a.open_services}<span className="faint"> open</span> · {a.findings}<span className="faint"> findings</span></span> },
    { key: 'criticality', header: 'Criticality', render: (a) => (a.criticality === 'unknown' ? <span className="faint nowrap">Not rated</span> : <Badge>{a.criticality}</Badge>) },
    { key: 'scope', header: 'Scope', render: (a) => <ScopeBadge scope={a.scope} />, sortValue: (a) => a.scope.status },
    { key: 'last_seen', header: 'Last seen', render: (a) => <span className="nowrap" title={fmtDateTime(a.last_seen)}>{fmtRelative(a.last_seen)}</span> },
    { key: 'act', header: 'Action', sortable: false, className: 'act', render: (a) => <RowAction to={`/scan/assets/${a.id}`} label={`Open ${a.code}`} /> },
  ];
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <Panel
      title="Asset inventory"
      hint="One asset per IP address"
      actions={
        <>
          <HowCalculated text="Each distinct IP address seen in an imported scan (or added manually) is one asset. Re-imports merge into the existing asset; they never create duplicates. Open services counts current (asset, port, protocol) entries whose latest observed state is open." />
          <button className="btn sm" onClick={() => setAdding(true)}><Plus /> Add asset</button>
          <button className="btn sm" onClick={() => download(`${base}/exports/assets.csv`)} disabled={!q.data?.length}><Download /> Export CSV</button>
          <CaptureButton compact title="Asset table" />
        </>
      }
      flush
    >
      {!!q.data?.length && (
        <div className="filters">
          <SearchField placeholder="Search IP, hostname, OS…" value={search} onChange={setSearch} label="Search assets" />
          <Select ariaLabel="Scope status" value={scope} onChange={setScope} placeholder="All scope statuses" options={[{ value: 'in_scope', label: 'In scope' }, { value: 'excluded', label: 'Excluded' }, { value: 'not_in_scope', label: 'Not in scope' }, { value: 'no_scope_defined', label: 'Scope undefined' }]} />
          <Select ariaLabel="Criticality" value={crit} onChange={setCrit} placeholder="Any criticality" options={['critical', 'high', 'medium', 'low', 'unknown']} />
        </div>
      )}
      <DataTable
        caption="Assets"
        rows={rows}
        columns={cols}
        rowKey={(a) => a.id}
        onRowClick={(a) => nav(`/scan/assets/${a.id}`)}
        initialSort={{ key: 'code', dir: 'asc' }}
        empty={q.data?.length ? <EmptyState title="No assets match these filters" /> : <NoScanData onImport={onImport} />}
      />
      <AddAssetModal open={adding} onClose={() => setAdding(false)} />
    </Panel>
  );
}

function AddAssetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { base } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [ip, setIp] = useState('');
  const [hostname, setHostname] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const a = await api.post<Asset>(`${base}/assets`, { ip: ip.trim() || undefined, hostname: hostname.trim() || undefined, role });
      qc.invalidateQueries();
      toast.success(`Added ${a.code}.`);
      setIp(''); setHostname(''); setRole('');
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add asset manually"
      size="narrow"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit} disabled={busy || (!ip.trim() && !hostname.trim())}>Add asset</button></>}
    >
      <div className="stack tight">
        <Notice tone="info">Use this for an authorized host you documented without a scan file (for example, from instructor-supplied information). It is labeled as manually entered.</Notice>
        <Field label="IP address" htmlFor="asset-ip"><input id="asset-ip" className="mono-input" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.0.2.10" /></Field>
        <Field label="Hostname" htmlFor="asset-host"><input id="asset-host" className="mono-input" value={hostname} onChange={(e) => setHostname(e.target.value)} /></Field>
        <Field label="Role" htmlFor="asset-role"><input id="asset-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Web server" /></Field>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Services */
function ServicesTab({ q, onImport }: { q: UseQueryResult<Service[]>; onImport: () => void }) {
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [proto, setProto] = useState('');
  const [vstatus, setVstatus] = useState('');
  const [inv, setInv] = useState(params.get('investigate') === '1');
  const [editing, setEditing] = useState<Service | null>(null);
  const all = q.data ?? [];
  const rows = useMemo(
    () =>
      all.filter(
        (s) =>
          matchText(s, search, ['ip', 'hostname', 'asset_code', 'service_name', 'product', 'version', (x) => String(x.port), 'normal_purpose']) &&
          (!state || s.state === state) &&
          (!proto || s.protocol === proto) &&
          (!vstatus || s.version_status === vstatus) &&
          (!inv || !!s.needs_investigation),
      ),
    [all, search, state, proto, vstatus, inv],
  );
  const purposeCount = all.filter((s) => s.normal_purpose.trim()).length;
  const flagged = all.filter((s) => s.needs_investigation && s.investigation_reason.trim()).length;
  const cols: Column<Service>[] = [
    {
      key: 'asset_code',
      header: 'Host',
      render: (s) => <span title={`${s.asset_code}${s.hostname ? ' · ' + s.hostname : ''}`}><AssetCell icon={<Monitor />} mono title={s.ip ?? s.hostname} sub={s.hostname && s.ip ? s.hostname : s.asset_code} /></span>,
      sortValue: (s) => (s.ip ?? '').split('.').map((n) => n.padStart(3, '0')).join('.'),
    },
    { key: 'port', header: 'Port / service', render: (s) => <span className="scan-port"><span className="mono">{s.port}/{s.protocol}</span><span className="mono faint tiny">{s.service_name ?? 'unknown'}</span></span>, sortValue: (s) => s.port },
    { key: 'state', header: 'State', render: (s) => <PortState state={s.state} /> },
    { key: 'version', header: 'Product / version', render: (s) => <span className="scan-ver"><span className="mono clip" title={svcLabel(s)}>{svcLabel(s)}</span><VersionBadge status={s.version_status} /></span>, sortValue: (s) => svcLabel(s) },
    { key: 'normal_purpose', header: 'Normal purpose', render: (s) => (s.normal_purpose ? <span className="clamp-2 scan-purpose" title={s.normal_purpose}>{s.normal_purpose}</span> : <span className="faint nowrap">Not recorded</span>) },
    { key: 'needs_investigation', header: 'Investigate', render: (s) => (s.needs_investigation ? <span title={s.investigation_reason}><StatusPill tone="warn">Flagged</StatusPill></span> : <span className="faint">—</span>), sortValue: (s) => s.needs_investigation },
    { key: 'findings', header: 'Findings', render: (s) => <span className="nowrap" title={`Last seen ${fmtDateTime(s.last_seen)}`}>{s.findings}</span> },
    {
      key: 'act',
      header: 'Action',
      sortable: false,
      className: 'act',
      render: (s) => (
        <button type="button" className="kebab" aria-label={`Edit notes for ${s.asset_code} ${s.port}/${s.protocol}`} title="Edit purpose and notes" onClick={() => setEditing(s)}>
          <MoreVertical size={18} />
        </button>
      ),
    },
  ];
  const { base } = useEngagement();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!all.length)
    return (
      <Panel title="Services">
        <NoScanData onImport={onImport} />
      </Panel>
    );
  return (
    <div className="stack">
      <div className="lab3-reqs" role="status">
        <Req ok={purposeCount >= 5} text={`Correlate at least 5 services with their normal purpose. ${purposeCount} of 5`} />
        <Req ok={flagged >= 1} text={`Flag at least 1 service for further investigation with a reason. ${flagged} of 1`} />
      </div>
      <Panel
        title="Service inventory"
        hint="Current state per asset, port, and protocol"
        flush
        actions={
          <>
            <HowCalculated text="One row per distinct (asset, port, protocol). The row shows the most recent observation by observation time; older observations stay in history. Repeated imports never add rows. Versions are “Detected” only when a service probe reported them." />
            <button className="btn sm" onClick={() => download(`${base}/exports/services.csv`)}><Download /> Export CSV</button>
            <CaptureButton compact title="Service table" />
          </>
        }
      >
        <div className="filters">
          <SearchField placeholder="Search host, port, service, version…" value={search} onChange={setSearch} label="Search services" />
          <Select ariaLabel="State" value={state} onChange={setState} placeholder="All states" options={['open', 'closed', 'filtered', 'open|filtered', 'unfiltered', 'closed|filtered'].map((v) => ({ value: v, label: v }))} />
          <Select ariaLabel="Protocol" value={proto} onChange={setProto} placeholder="All protocols" options={['tcp', 'udp', 'sctp'].map((v) => ({ value: v, label: v.toUpperCase() }))} />
          <Select ariaLabel="Version status" value={vstatus} onChange={setVstatus} placeholder="Any version status" options={[{ value: 'detected', label: 'Detected' }, { value: 'inferred', label: 'Inferred' }, { value: 'unknown', label: 'Unknown' }]} />
          <label className="check"><input type="checkbox" checked={inv} onChange={(e) => setInv(e.target.checked)} /> Flagged only</label>
        </div>
        <DataTable
          caption="Services"
          rows={rows}
          columns={cols}
          rowKey={(s) => s.id}
          onRowClick={setEditing}
          initialSort={{ key: 'asset_code', dir: 'asc' }}
          empty={<EmptyState title="No services match these filters" />}
        />
      </Panel>
      <ServiceDrawer service={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Req({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`lab3-req ${ok ? 'met' : ''}`}>
      {ok ? <CheckCircle2 aria-label="Met" /> : <Circle aria-label="Not met" />} {text}
    </span>
  );
}

/* ------------------------------------------------------------------ History */
function HistoryTab({ q, onImport }: { q: UseQueryResult<ScanImport[]>; onImport: () => void }) {
  const nav = useNavigate();
  const cols: Column<ScanImport>[] = [
    {
      key: 'code',
      header: 'Import',
      render: (i) => <AssetCell icon={<FileCode2 />} to={`/scan/imports/${i.id}`} title={<span className="mono">{i.code}</span>} sub={<span className="mono" title={i.original_filename ?? ''}>{i.original_filename ?? '—'}</span>} />,
      sortValue: (i) => Number(i.code.replace(/\D/g, '')),
    },
    { key: 'created_at', header: 'Imported', render: (i) => <When iso={i.created_at} /> },
    { key: 'scan_finished_at', header: 'Scan time (from file)', render: (i) => (i.scan_finished_at || i.scan_started_at ? <When iso={i.scan_finished_at ?? i.scan_started_at} /> : <span className="faint nowrap">Not in file</span>) },
    { key: 'tool', header: 'Tool / format', render: (i) => <span className="nowrap">{i.tool}<span className="faint"> · {i.format}</span></span> },
    { key: 'status', header: 'Status', render: (i) => <ImportStatus status={i.status} /> },
    { key: 'counts', header: 'Hosts · new / upd. / same', sortable: false, render: (i) => <span className="mono small nowrap">{i.hosts_total} · {i.new_services} / {i.updated_services} / {i.unchanged_services}</span> },
    { key: 'duplicate_of_code', header: 'Duplicate of', render: (i) => (i.duplicate_of_code ? <Badge tone="warn">{i.duplicate_of_code}</Badge> : <span className="faint">—</span>) },
    { key: 'evidence_code', header: 'Evidence', render: (i) => (i.evidence_id ? <EvidenceChips items={[{ id: i.evidence_id, code: i.evidence_code ?? '', status: i.evidence_status ?? 'active' }]} /> : '—') },
    { key: 'act', header: 'Action', sortable: false, className: 'act', render: (i) => <RowAction to={`/scan/imports/${i.id}`} label={`Open ${i.code}`} /> },
  ];
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  return (
    <Panel title="Scan imports" hint="Every import is kept, including duplicates and unparsed files" flush>
      <DataTable
        caption="Scan import history"
        rows={q.data ?? []}
        columns={cols}
        rowKey={(i) => i.id}
        onRowClick={(i) => nav(`/scan/imports/${i.id}`)}
        initialSort={{ key: 'created_at', dir: 'desc' }}
        empty={<NoScanData onImport={onImport} />}
      />
    </Panel>
  );
}

function When({ iso }: { iso: string | null }) {
  if (!iso) return <span className="faint">—</span>;
  const d = new Date(iso);
  return (
    <span className="scan-when" title={fmtDateTime(iso)}>
      {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      <span className="faint tiny">{d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ Import */
interface Preview {
  filename: string;
  sha256: string;
  size_bytes: number;
  format: string;
  tool: string;
  tool_version: string | null;
  command: string | null;
  started_at: string | null;
  finished_at: string | null;
  parseable: boolean;
  hosts: { ip: string; hostname: string | null; state: string; os: string | null; port_count: number; open_count: number; existing_asset: string | null; scope: ScopeResult; observed_at: string | null }[];
  observations: any[];
  observations_total: number;
  counts: { hosts: number; new_assets: number; new_services: number; existing_services: number };
  warnings: string[];
  errors: { row?: number; message: string }[];
  status: string;
  duplicate_of: { id: string; code: string; created_at: string } | null;
}

function ImportTab() {
  const { base, isDemo } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState('authorized_lab');
  const [collected, setCollected] = useState('');
  const [storeRaw, setStoreRaw] = useState(false);
  const [allowDup, setAllowDup] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitErr, setCommitErr] = useState('');

  const choose = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    setPreviewErr('');
    setCommitErr('');
    setStoreRaw(false);
    setAllowDup(false);
    if (!f) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', f);
      setPreview(await api.upload<Preview>(`${base}/scan-imports/preview`, form));
    } catch (e) {
      setPreviewErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!file) return;
    setCommitting(true);
    setCommitErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('source_category', isDemo ? 'demo' : source);
      const iso = fromLocalInput(collected);
      if (iso) form.append('collected_at', iso);
      if (storeRaw) form.append('store_raw', 'true');
      if (allowDup) form.append('allow_duplicate', 'true');
      const r = await api.upload<{ id: string; code: string; evidence_code: string; status: string; new_services: number; updated_services: number }>(`${base}/scan-imports`, form);
      qc.invalidateQueries();
      toast.success(
        r.status === 'stored_only'
          ? `Stored raw scan output as ${r.evidence_code} (${r.code}).`
          : `Imported ${r.code} (${r.evidence_code}): ${r.new_services} new and ${r.updated_services} updated services.`,
      );
      nav(`/scan/imports/${r.id}`);
    } catch (e) {
      setCommitErr(e instanceof ApiError && e.status === 409 ? `${e.message} Tick “Record as a separate scan run” to import it anyway.` : errorMessage(e));
    } finally {
      setCommitting(false);
    }
  };

  const canCommit = !!preview && (preview.parseable || storeRaw) && (!preview.duplicate_of || allowDup);
  const sample = useMemo(() => preview?.observations.slice(0, 50) ?? [], [preview]);

  return (
    <div className="grid span-main">
      <div className="stack">
        <Panel title="1. Choose a scan file">
          <div className="stack tight">
            <FileDrop file={file} onFile={choose} accept=".xml,.csv,.json,.txt,.nmap,.gnmap" label="Drop Nmap XML, scan CSV/JSON, or raw scanner output" hint="The file is checked first; nothing is saved until you confirm." />
            {loading && <Loading label="Reading file" rows={2} />}
            {previewErr && <Notice tone="bad" title="Preview failed.">{previewErr}</Notice>}
          </div>
        </Panel>

        {preview && (
          <Panel
            title="2. Review before importing"
            actions={<ImportStatus status={preview.status === 'failed' ? (storeRaw ? 'stored_only' : 'failed') : preview.status} />}
          >
            <div className="stack">
              <dl className="kv">
                <dt>Format</dt><dd>{preview.tool}{preview.tool_version ? ` ${preview.tool_version}` : ''} <span className="faint">· {preview.format}</span></dd>
                <dt>Command in file</dt><dd>{preview.command ? <code>{preview.command}</code> : <span className="faint">Not recorded</span>}</dd>
                <dt>Scan time</dt><dd>{preview.started_at || preview.finished_at ? `${fmtDateTime(preview.started_at)} → ${fmtDateTime(preview.finished_at)}` : <span className="faint">No timestamps in file</span>}</dd>
                <dt>SHA-256</dt><dd className="mono small">{preview.sha256}</dd>
                <dt>Will create</dt>
                <dd>
                  {preview.counts.hosts} hosts ({preview.counts.new_assets} new assets) · {preview.observations_total} observations ·{' '}
                  <strong>{preview.counts.new_services}</strong> new services, {preview.counts.existing_services} already in inventory
                </dd>
              </dl>
              {preview.duplicate_of && (
                <Notice tone="warn" title={`Duplicate of ${preview.duplicate_of.code}.`}>
                  This exact file (same SHA-256) was imported {fmtRelative(preview.duplicate_of.created_at)}. Importing it again adds no new information.{' '}
                  <label className="check" style={{ marginTop: 6 }}>
                    <input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} /> Record as a separate scan run anyway (totals will not change)
                  </label>
                </Notice>
              )}
              {preview.errors.length > 0 && (
                <Notice tone={preview.parseable ? 'warn' : 'bad'} title={preview.parseable ? `${preview.errors.length} row(s) will be skipped.` : 'Nothing could be parsed.'}>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {preview.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>{e.row !== undefined ? `Row ${e.row}: ` : ''}{e.message}</li>
                    ))}
                  </ul>
                  {preview.errors.length > 20 && <div className="faint">…and {preview.errors.length - 20} more.</div>}
                  {!preview.parseable && (
                    <label className="check" style={{ marginTop: 8 }}>
                      <input type="checkbox" checked={storeRaw} onChange={(e) => setStoreRaw(e.target.checked)} /> Store this file as raw evidence (no hosts or services will be created)
                    </label>
                  )}
                </Notice>
              )}
              {preview.warnings.length > 0 && (
                <Notice tone="warn" title="Warnings">
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </Notice>
              )}
              {preview.hosts.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <caption className="sr-only">Hosts in file</caption>
                    <thead><tr><th>Host</th><th>State</th><th>Ports (open)</th><th>OS</th><th>Asset</th><th>Scope</th></tr></thead>
                    <tbody>
                      {preview.hosts.map((h) => (
                        <tr key={h.ip}>
                          <td><span className="mono">{h.ip}</span>{h.hostname && <div className="faint tiny mono">{h.hostname}</div>}</td>
                          <td>{h.state}</td>
                          <td className="mono">{h.port_count} ({h.open_count})</td>
                          <td className="small">{h.os ?? <span className="faint">—</span>}</td>
                          <td>{h.existing_asset ? <span className="mono nowrap">{h.existing_asset}</span> : <Badge tone="accent">New</Badge>}</td>
                          <td><ScopeBadge scope={h.scope} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sample.length > 0 && (
                <details>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>Show parsed observations ({Math.min(sample.length, 50)} of {preview.observations_total})</summary>
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table className="data">
                      <caption className="sr-only">Parsed observations</caption>
                      <thead><tr><th>Host</th><th>Port</th><th>State</th><th>Service</th><th>Product / version</th></tr></thead>
                      <tbody>
                        {sample.map((o, i) => (
                          <tr key={i}>
                            <td className="mono">{o.ip}</td>
                            <td className="mono">{o.port}/{o.protocol}</td>
                            <td>{o.state}</td>
                            <td className="mono">{o.service_name ?? '—'}</td>
                            <td><span className="mono">{svcLabel(o)}</span> <VersionBadge status={o.version_status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </Panel>
        )}

        {preview && (
          <Panel title="3. Confirm import">
            <div className="stack">
              <div className="form-grid">
                {!isDemo ? (
                  <Field label="Evidence source" htmlFor="scan-src" help="Where these results came from.">
                    <Select id="scan-src" value={source} onChange={setSource} options={[{ value: 'authorized_lab', label: 'Authorized lab evidence (your own scan)' }, { value: 'instructor_supplied', label: 'Instructor-supplied file' }]} />
                  </Field>
                ) : (
                  <Notice tone="info">This is the demo engagement; the file will be labeled as demo data.</Notice>
                )}
                <Field label="Collection time (optional)" htmlFor="scan-collected" help={preview.finished_at ? 'Leave blank to use the scan finish time from the file.' : 'The file has no timestamps. Enter when the scan ran, if known.'}>
                  <input id="scan-collected" type="datetime-local" value={collected} onChange={(e) => setCollected(e.target.value)} />
                </Field>
              </div>
              {commitErr && <Notice tone="bad">{commitErr}</Notice>}
              <div className="row">
                <button className="btn primary" disabled={!canCommit || committing} onClick={commit}>
                  {committing && <span className="spinner" />}
                  {preview.parseable ? 'Import scan results' : 'Store as raw evidence'}
                </button>
                <button className="btn ghost" onClick={() => choose(null)}>Cancel</button>
                {!canCommit && <span className="small faint">{preview.duplicate_of && !allowDup ? 'Duplicate file: confirm above to continue.' : !preview.parseable ? 'Nothing to import unless stored as raw evidence.' : ''}</span>}
              </div>
            </div>
          </Panel>
        )}
      </div>

      <div className="stack">
        <Panel title="Supported formats">
          <div className="stack tight small">
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <FileCode2 size={16} style={{ flex: 'none', marginTop: 3 }} />
              <div><strong>Nmap XML</strong> (<code>-oX</code>). Preferred. Versions are “Detected” only when a service probe reported them.</div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <FileCode2 size={16} style={{ flex: 'none', marginTop: 3 }} />
              <div><strong>CSV template</strong>: host_ip, hostname, port, protocol, state, service, product, version, version_status, os, observed_at, notes.</div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <FileCode2 size={16} style={{ flex: 'none', marginTop: 3 }} />
              <div><strong>Structured JSON</strong>: <code>{'{tool, command, scanned_at, hosts:[{ip, hostname, os, ports:[…]}]}'}</code></div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <Server size={16} style={{ flex: 'none', marginTop: 3 }} />
              <div><strong>Anything else</strong> (e.g. <code>-oN</code> text) can be kept as raw evidence; no hosts are extracted.</div>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn sm" onClick={() => download(`${base}/scan-template.csv`)}><Download /> CSV template</button>
              <button className="btn sm" onClick={() => download(`${base}/scan-template.json`)}><Download /> JSON template</button>
            </div>
          </div>
        </Panel>
        <Panel title="How imports are counted">
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>The original file is stored in the Evidence Locker with a SHA-256 hash and an Evidence ID.</li>
            <li>Assets are unique per IP address; services are unique per asset, port, and protocol.</li>
            <li>A newer scan updates the current state; an older scan only adds history.</li>
            <li>Re-importing the identical file is refused unless you record it as a separate run.</li>
            <li>Hosts outside the authorized scope are flagged, not hidden.</li>
          </ul>
          <Notice tone="info">CyberDome never executes scans. Run instructor-approved commands yourself, against assigned targets only.</Notice>
        </Panel>
      </div>
    </div>
  );
}

