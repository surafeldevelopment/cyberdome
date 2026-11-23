import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Panel, EmptyState, ErrorState, Loading, Notice, KV, SourceBadge } from '../../components/ui';
import { DataTable, matchText, type Column } from '../../components/DataTable';
import { EvidenceChips } from '../../components/evidence';
import { api } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { fmtDateTime } from '../../lib/format';
import { ImportStatus, PortState, SearchField, VersionBadge, svcLabel, type Observation, type ScanImport } from './shared';
import { Monitor, Server, Network, Layers, GitCompare } from 'lucide-react';
import { KpiCard, KpiRow, AssetCell, RowAction } from '../../components/kit';
import '../../styles/scan.css';

export default function ScanImportDetail() {
  const { id } = useParams();
  const { base, eid } = useEngagement();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['scan-import', eid, id], queryFn: () => api.get<ScanImport & { observations: Observation[] }>(`${base}/scan-imports/${id}`) });
  const rows = useMemo(() => (q.data?.observations ?? []).filter((o) => matchText(o, search, ['ip_observed', 'hostname_observed', 'service_name', 'product', 'version', (x) => String(x.port), 'state'])), [q.data, search]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const s = q.data!;
  const cols: Column<Observation>[] = [
    { key: 'ip_observed', header: 'Host', render: (o) => <AssetCell icon={<Monitor />} to={`/scan/assets/${o.asset_id}`} mono title={o.ip_observed ?? o.hostname_observed ?? '—'} sub={[o.hostname_observed, o.asset_code].filter(Boolean).join(' · ')} />, sortValue: (o) => (o.ip_observed ?? '').split('.').map((n) => n.padStart(3, '0')).join('.') },
    { key: 'port', header: 'Port', render: (o) => <span className="mono nowrap">{o.port}/{o.protocol}</span>, sortValue: (o) => o.port },
    { key: 'state', header: 'State', render: (o) => <PortState state={o.state} /> },
    { key: 'reason', header: 'Reason', render: (o) => <span className="mono small">{o.reason ?? '—'}</span> },
    { key: 'service_name', header: 'Service', render: (o) => <span className="mono">{o.service_name ?? '—'}</span> },
    { key: 'version', header: 'Product / version', render: (o) => <span className="scan-ver"><span className="mono clip" title={svcLabel(o)}>{svcLabel(o)}</span><VersionBadge status={o.version_status} /></span>, sortValue: (o) => svcLabel(o) },
    { key: 'service_method', header: 'Method', render: (o) => <span className="small nowrap">{o.service_method ?? '—'}{o.service_conf !== null ? ` · conf ${o.service_conf}` : ''}</span> },
    { key: 'observed_at', header: 'Observed', render: (o) => (o.observed_at ? <span className="small nowrap">{fmtDateTime(o.observed_at)}</span> : <span className="faint">Unknown</span>) },
    { key: 'act', header: 'Action', sortable: false, className: 'act', render: (o) => <RowAction to={`/scan/assets/${o.asset_id}`} label={`Open asset ${o.asset_code ?? ''}`} /> },
  ];
  return (
    <div className="scan-module">
      <PageHeader
        crumbs={[{ label: 'Scan & Enumeration', to: '/scan' }, { label: 'Scan history', to: '/scan?tab=history' }, { label: s.code }]}
        title={<span><span className="mono">{s.code}</span> <span className="muted" style={{ fontWeight: 500 }}>· {s.original_filename}</span></span>}
        subtitle={<span className="row" style={{ gap: 8 }}><ImportStatus status={s.status} />{s.source_category && <SourceBadge value={s.source_category} />}</span>}
      />
      <KpiRow>
        <KpiCard icon={<Server />} label="Hosts in file" value={s.hosts_total} pill={{ text: `${s.hosts_up} up`, tone: 'neutral' }} calc="Hosts listed in the imported file. Secondary value: hosts the scanner reported as up." />
        <KpiCard icon={<Layers />} label="Observations" value={s.observations_count} pill={{ text: s.format, tone: 'neutral' }} calc="Service observations recorded from this import (appended to history; never deduplicated away)." />
        <KpiCard icon={<Network />} label="New services" value={s.new_services} pill={{ text: `${s.new_assets} new assets`, tone: 'neutral' }} calc="Services that did not exist in the current inventory before this import. Secondary value: assets first created by this import." />
        <KpiCard icon={<GitCompare />} label="Updated services" value={s.updated_services} pill={{ text: `${s.unchanged_services} unchanged`, tone: 'neutral' }} calc="Existing services whose current state changed because this scan was newer. Unchanged includes history-only observations from older scans." />
      </KpiRow>
      <div className="stack">
        {s.status === 'stored_only' && <Notice tone="info" title="Stored only.">This file could not be parsed into hosts or services. It is retained unchanged as raw evidence.</Notice>}
        {s.errors.length > 0 && (
          <Notice tone={s.status === 'stored_only' ? 'info' : 'warn'} title={`${s.errors.length} parse error(s).`}>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{s.errors.map((e, i) => <li key={i}>{e.row !== undefined ? `Row ${e.row}: ` : ''}{e.message}</li>)}</ul>
          </Notice>
        )}
        {s.warnings.length > 0 && (
          <Notice tone="warn" title="Warnings">
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </Notice>
        )}
        <Panel title="Import details">
          <KV
            items={[
              ['Tool', `${s.tool}${s.tool_version && !s.tool.includes(s.tool_version) ? ` ${s.tool_version}` : ''}`],
              ['Format', s.format],
              ['Command line (from file)', s.command_line ? <code>{s.command_line}</code> : <span className="faint">Not recorded in file</span>],
              ['Scan started', fmtDateTime(s.scan_started_at)],
              ['Scan finished', fmtDateTime(s.scan_finished_at)],
              ['Imported', `${fmtDateTime(s.created_at)}${s.created_by ? ` by ${s.created_by}` : ''}`],
              ['Hosts', `${s.hosts_total} in file, ${s.hosts_up} up`],
              ['Observations', s.observations_count],
              ['Inventory effect', `${s.new_assets} new assets · ${s.new_services} new services · ${s.updated_services} updated · ${s.unchanged_services} unchanged or history-only`],
              ['Duplicate of', s.duplicate_of_code ?? '—'],
              ['Evidence', s.evidence_id ? <EvidenceChips items={[{ id: s.evidence_id, code: s.evidence_code ?? '', status: s.evidence_status ?? 'active' }]} /> : '—'],
              ['SHA-256', s.sha256 ? <span className="mono small">{s.sha256}</span> : '—'],
            ]}
          />
        </Panel>
        <Panel title="Observations in this import" flush>
          {s.observations.length > 0 && (
            <div className="filters">
              <SearchField placeholder="Filter observations" value={search} onChange={setSearch} label="Filter observations" />
            </div>
          )}
          <DataTable caption="Observations" rows={rows} columns={cols} rowKey={(o) => o.id} initialSort={{ key: 'ip_observed', dir: 'asc' }} empty={<EmptyState title={s.observations.length ? 'No observations match' : 'No observations recorded'} />} />
        </Panel>
      </div>
    </div>
  );
}
