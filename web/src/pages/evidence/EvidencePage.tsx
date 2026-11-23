import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Archive, Download, ExternalLink, Link2, Plus, Search, X, ShieldQuestion, Waypoints, Radio, FileText, Image as ImageIcon, FileCode2, FileArchive, File as FileIcon, SlidersHorizontal } from 'lucide-react';
import { KpiCard, KpiRow, AssetCell, RowAction, StatusPill } from '../../components/kit';
import { api, qs } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import type { Evidence, Paged } from '../../lib/types';
import { fmtBytes, fmtDate, fmtDateTime, download, humanize, SOURCE_LABEL } from '../../lib/format';
import {
  Badge, ConfidenceBadge, EmptyState, ErrorState, KV, Loading, Notice, PageHeader, Panel, Provenance, SanitizationBadge, Select, SourceBadge,
} from '../../components/ui';
import { Drawer } from '../../components/overlay';
import { CaptureButton } from '../../components/CaptureButton';
import { AddEvidenceDrawer } from './AddEvidenceDrawer';
import { CONF_OPTIONS, HASH_CAVEAT, SANI_OPTIONS, shortHash, SOURCE_HELP, TYPE_OPTIONS } from './shared';
import { ReviewQueue } from './ReviewQueue';
import '../../styles/evidence.css';

const PAGE = 50;
const FILTER_KEYS = ['q', 'source_category', 'sanitization_status', 'confidence', 'detected_type', 'status', 'tag', 'unlinked'] as const;
const SORTS = [
  { value: 'code', label: 'Evidence ID' },
  { value: 'imported_at', label: 'Imported' },
  { value: 'collected_at', label: 'Collected' },
  { value: 'title', label: 'Title' },
  { value: 'size', label: 'Size' },
  { value: 'confidence', label: 'Confidence' },
];
const ALL_SOURCES = ['authorized_lab', 'instructor_supplied', 'external_reference', 'project_artifact', 'demo'];
const ALL_SANI = ['not_reviewed', 'sanitized', 'no_sensitive_data', 'contains_sensitive'];

export default function EvidencePage() {
  const { base, eid, isDemo } = useEngagement();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [quick, setQuick] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(params.get('q') ?? '');

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const sort = params.get('sort') ?? 'code';
  const dir = (params.get('dir') ?? 'desc') as 'asc' | 'desc';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const addOpen = params.get('upload') === '1';
  const anyFilter = FILTER_KEYS.some((k) => filters[k]);

  const update = (p: Record<string, string | null>, resetPage = true) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) (v ? n.set(k, v) : n.delete(k));
    if (resetPage) n.delete('page');
    setParams(n, { replace: true });
  };

  useEffect(() => setSearchDraft(params.get('q') ?? ''), [params]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== searchDraft.trim()) update({ q: searchDraft.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const listParams = { ...filters, sort, dir, limit: PAGE, offset: page * PAGE };
  const list = useQuery({
    queryKey: ['evidence', eid, 'list', listParams],
    queryFn: () => api.get<Paged<Evidence>>(`${base}/evidence${qs(listParams)}`),
    enabled: !!eid,
    placeholderData: (prev) => prev,
  });

  // Summary strip: totals per category, each calculated by the server from stored (active) records.
  const counts = useQueries({
    queries: [...ALL_SOURCES.map((s) => ['source_category', s]), ...ALL_SANI.map((s) => ['sanitization_status', s]), ['unlinked', '1'], ['detected_type', 'pcap'], ['detected_type', 'pcapng'], ['kind', 'reference'], ['status', 'withdrawn']].map(([k, v]) => ({
      queryKey: ['evidence', eid, 'count', k, v],
      queryFn: () => api.get<Paged<Evidence>>(`${base}/evidence${qs({ [k]: v, limit: 1 })}`).then((r) => r.total),
      enabled: !!eid,
    })),
  });
  const srcCounts = ALL_SOURCES.map((s, i) => [s, counts[i].data] as const);
  const saniCounts = ALL_SANI.map((s, i) => [s, counts[ALL_SOURCES.length + i].data] as const);
  const extra = counts.slice(ALL_SOURCES.length + ALL_SANI.length).map((c) => c.data);
  const [unlinked, pcapN, pcapngN, refN, withdrawn] = extra;
  const activeTotal = srcCounts.reduce((a, [, n]) => a + (n ?? 0), 0);
  const countsLoading = counts.some((c) => c.isLoading);
  const saniOf = (k: string) => saniCounts.find(([s]) => s === k)?.[1] ?? 0;
  const [filterOpen, setFilterOpen] = useState(anyFilterInitial(params));

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const exportUrl = (fmt: 'csv' | 'json') => `${base}/evidence-index.${fmt}${qs({ ...filters, status: filters.status || 'active' })}`;

  const sortHeader = (key: string, label: string) => {
    const active = sort === key;
    return (
      <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button onClick={() => update({ sort: key, dir: active && dir === 'desc' ? 'asc' : 'desc' })}>
          {label}
          {active ? dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : <ArrowUpDown size={12} opacity={0.4} />}
        </button>
      </th>
    );
  };

  return (
    <>
      <PageHeader
        title="Evidence Locker"
        subtitle="The source of truth for the engagement. Every finding, event, and AI citation traces back to an Evidence ID here."
        actions={
          <>
            <CaptureButton title="Evidence Locker" label="Capture view" />
            <ExportMenu csv={exportUrl('csv')} json={exportUrl('json')} anyFilter={anyFilter} />
            <button className="btn primary" onClick={() => update({ upload: '1' }, false)}>
              <Plus /> Add evidence
            </button>
          </>
        }
      />

      <KpiRow>
        <KpiCard
          icon={<Archive />}
          label="Active evidence items"
          value={countsLoading ? '…' : activeTotal}
          pill={withdrawn ? { text: `+${withdrawn} withdrawn`, tone: 'neutral' } : { text: 'None withdrawn', tone: 'neutral' }}
          onClick={() => setParams(new URLSearchParams(), { replace: true })}
          calc="Count of active (not withdrawn) artifacts in the Evidence Locker, summed from server totals per source category. Withdrawn items keep their retired IDs and are counted separately."
        />
        <KpiCard
          icon={<Waypoints />}
          label="Linked to records"
          value={countsLoading ? '…' : Math.max(0, activeTotal - (unlinked ?? 0))}
          pill={{ text: `${unlinked ?? 0} unlinked`, tone: unlinked ? 'warn' : 'ok' }}
          onClick={() => update({ unlinked: '1' })}
          calc="Active items linked to at least one finding, timeline event, recon observation, or indicator. Secondary value: active items not linked to any of those records (opens that filter)."
        />
        <KpiCard
          icon={<ShieldQuestion />}
          label="Awaiting sanitization review"
          value={countsLoading ? '…' : saniOf('not_reviewed')}
          pill={{ text: `${saniOf('contains_sensitive')} marked sensitive`, tone: saniOf('contains_sensitive') ? 'bad' : 'ok' }}
          onClick={() => update({ sanitization_status: 'not_reviewed' })}
          calc="Active items whose sanitization status is “not reviewed”. Only sanitized or no-sensitive-data items can be sent to the AI analyst. Secondary value: items marked as containing sensitive data."
        />
        <KpiCard
          icon={<Radio />}
          label="Packet captures"
          value={countsLoading ? '…' : (pcapN ?? 0) + (pcapngN ?? 0)}
          pill={{ text: `${refN ?? 0} reference${refN === 1 ? '' : 's'}`, tone: 'neutral' }}
          onClick={() => update({ detected_type: 'pcap' })}
          calc="Stored PCAP and PCAPNG files (type detected from file bytes). Secondary value: artifacts recorded by reference only, whose files are not stored here."
        />
      </KpiRow>

      <ReviewQueue />

      <details className="dash-more" open={!!(filters.source_category || filters.sanitization_status)}>
      <summary>Counts by source and sanitization</summary>
      <div className="ev-summary" style={{ marginTop: 10 }} aria-label="Evidence counts by source and sanitization">
        <div className="ev-summary-group">
          <span className="ev-summary-label">By source <Provenance kind="calculated" detail="Counted from stored records" /></span>
          <div className="chips">
            {srcCounts.filter(([s, n]) => n || s !== 'demo').map(([s, n]) => (
              <button key={s} className={`ev-count ${filters.source_category === s ? 'on' : ''}`} onClick={() => update({ source_category: filters.source_category === s ? null : s })} title={SOURCE_HELP[s]}>
                {SOURCE_LABEL[s]} <strong>{n ?? '…'}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="ev-summary-group">
          <span className="ev-summary-label">Sanitization</span>
          <div className="chips">
            {saniCounts.map(([s, n]) => (
              <button key={s} className={`ev-count ${filters.sanitization_status === s ? 'on' : ''} ${s === 'contains_sensitive' && n ? 'bad' : ''} ${s === 'not_reviewed' && n ? 'warn' : ''}`} onClick={() => update({ sanitization_status: filters.sanitization_status === s ? null : s })}>
                {humanize(s)} <strong>{n ?? '…'}</strong>
              </button>
            ))}
          </div>
        </div>
      </div>
      </details>

      <Panel
        flush
        className="ev-list-panel"
        title={`${list.data ? total.toLocaleString() : '…'} Evidence Item${total === 1 ? '' : 's'}`}
        actions={
          <>
            <div className="search-box ev-search">
              <Search aria-hidden />
              <input type="search" aria-label="Search evidence" placeholder="ID, title, file, hash, tag…" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
            </div>
            <button className={`btn ${filterOpen || anyFilter ? 'on-filter' : ''}`} aria-expanded={filterOpen} aria-controls="ev-filters" onClick={() => setFilterOpen((o) => !o)}>
              <SlidersHorizontal /> Filter{anyFilter ? ` · ${FILTER_KEYS.filter((k) => k !== 'q' && filters[k]).length || ''}` : ''}
            </button>
          </>
        }
      >
        <div className="filters" id="ev-filters" hidden={!filterOpen}>
          <Select ariaLabel="Source category" value={filters.source_category} onChange={(v) => update({ source_category: v || null })} placeholder="All sources" options={ALL_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} />
          <Select ariaLabel="Sanitization status" value={filters.sanitization_status} onChange={(v) => update({ sanitization_status: v || null })} placeholder="Any sanitization" options={SANI_OPTIONS} />
          <Select ariaLabel="Confidence" value={filters.confidence} onChange={(v) => update({ confidence: v || null })} placeholder="Any confidence" options={CONF_OPTIONS} />
          <Select ariaLabel="File type" value={filters.detected_type} onChange={(v) => update({ detected_type: v || null })} placeholder="Any type" options={TYPE_OPTIONS} />
          <Select
            ariaLabel="Record status"
            value={filters.status}
            onChange={(v) => update({ status: v || null })}
            placeholder="Active only"
            options={[{ value: 'withdrawn', label: 'Withdrawn only' }, { value: 'all', label: 'Active + withdrawn' }]}
          />
          <label className="check">
            <input type="checkbox" checked={filters.unlinked === '1'} onChange={(e) => update({ unlinked: e.target.checked ? '1' : null })} />
            Not linked to any record
          </label>
          {filters.tag && (
            <span className="badge tone-accent">
              tag: {filters.tag}
              <button className="linklike" aria-label="Clear tag filter" onClick={() => update({ tag: null })}><X size={12} /></button>
            </span>
          )}
          {anyFilter && (
            <button className="btn ghost sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </button>
          )}
          <span className="spacer" />
          <span className="row small" style={{ gap: 6 }}>
            <label htmlFor="ev-sort" className="muted">Sort</label>
            <select id="ev-sort" style={{ width: 'auto', minWidth: 130 }} value={sort} onChange={(e) => update({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="btn sm" onClick={() => update({ dir: dir === 'asc' ? 'desc' : 'asc' })} aria-label={`Sort direction: ${dir === 'asc' ? 'ascending' : 'descending'}`}>
              {dir === 'asc' ? <ArrowUp /> : <ArrowDown />}
            </button>
          </span>
        </div>

        {list.isError ? (
          <div className="panel-body"><ErrorState error={list.error} retry={() => list.refetch()} /></div>
        ) : list.isLoading ? (
          <div className="panel-body"><Loading rows={5} /></div>
        ) : !items.length ? (
          anyFilter ? (
            <EmptyState title="No evidence matches these filters" icon={<Search />} actions={<button className="btn" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button>}>
              {total === 0 && filters.status !== 'all' ? 'Withdrawn items are hidden unless you choose to show them.' : null}
            </EmptyState>
          ) : (
            <EmptyLocker isDemo={isDemo} onAdd={() => update({ upload: '1' }, false)} />
          )
        ) : (
          <>
            <div className="table-wrap">
              <table className="data ev-table">
                <caption className="sr-only">Evidence items</caption>
                <thead>
                  <tr>
                    {sortHeader('code', 'Evidence')}
                    {sortHeader('size', 'Type / size')}
                    <th>Source</th>
                    {sortHeader('collected_at', 'Collected')}
                    <th>Assets &amp; links</th>
                    <th>Sanitization</th>
                    <th className="act">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => {
                    const links = (e.finding_links ?? 0) + (e.timeline_links ?? 0) + (e.recon_links ?? 0) + (e.indicator_links ?? 0);
                    return (
                      <tr key={e.id} className={`clickable ${e.status === 'withdrawn' ? 'ev-withdrawn' : ''}`} tabIndex={0}
                        onClick={(ev) => { if (!(ev.target as HTMLElement).closest('a,button')) setQuick(e.id); }}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) setQuick(e.id); }}
                      >
                        <td className="ev-main-cell">
                          <AssetCell
                            icon={<TypeIcon e={e} />}
                            to={`/evidence/${e.id}`}
                            title={<span title={e.title}>{e.title}</span>}
                            sub={
                              <span title={e.original_filename ?? e.reference_uri ?? ''}>
                                <span className={`mono ev-code-sub ${e.status === 'withdrawn' ? 'ev-code-withdrawn' : ''}`}>{e.code}</span>
                                {e.derived_from_id ? ' · derivative' : ''}
                                {e.status === 'withdrawn' ? ' · withdrawn' : ''}
                                {e.original_filename ? <> · <span className="mono">{e.original_filename}</span></> : e.kind === 'reference' ? <> · <span className="mono">ref: {e.reference_uri}</span></> : null}
                              </span>
                            }
                          />
                        </td>
                        <td className="nowrap small">
                          {e.kind === 'reference' ? <Badge tone="muted" icon={<Link2 />}>Reference</Badge> : <span className="mono">{e.detected_type}</span>}
                          <div className="faint tiny">{fmtBytes(e.size_bytes)}</div>
                          <div className="mono tiny faint" title={e.sha256 ? `SHA-256 ${e.sha256}${e.kind === 'reference' ? ' (analyst-supplied)' : ' (calculated from file bytes)'}` : 'No hash'}>
                            {e.sha256 ? `${shortHash(e.sha256)}${e.kind === 'reference' ? ' · supplied' : ''}` : 'no hash'}
                          </div>
                        </td>
                        <td className="ev-src-cell">
                          <SourceBadge value={e.source_category} />
                          {e.source_tool && <div className="tiny muted clip" style={{ marginTop: 4 }} title={e.source_tool}>{e.source_tool}</div>}
                        </td>
                        <td className="small ev-when" title={e.collected_at ? fmtDateTime(e.collected_at) : 'Collection time not supplied'}>{e.collected_at ? <>{fmtDate(e.collected_at)}<span className="tiny faint">{new Date(e.collected_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}</span></> : <span className="faint">Not supplied</span>}</td>
                        <td className="small" style={{ maxWidth: 200 }}>
                          {e.asset_labels && <div className="mono tiny clamp-2" style={{ marginBottom: 2 }}>{e.asset_labels}</div>}
                          {links ? (
                            <span className="nowrap" title={`${e.finding_links} findings · ${e.timeline_links} timeline · ${e.recon_links} recon · ${e.indicator_links} indicators`}>
                              {[['finding', e.finding_links], ['event', e.timeline_links], ['recon', e.recon_links], ['indicator', e.indicator_links]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(' · ')}
                            </span>
                          ) : <span className="faint">{e.asset_labels ? 'No record links' : 'Unlinked'}</span>}
                        </td>
                        <td><CompactSanitization value={e.sanitization_status} /></td>
                        <td className="act"><RowAction to={`/evidence/${e.id}`} label={`Open ${e.code}`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span>
                Showing {page * PAGE + 1}–{page * PAGE + items.length} of {total} record{total === 1 ? '' : 's'}
                {list.isFetching && <span className="spinner" style={{ marginLeft: 8, verticalAlign: 'middle' }} />}
              </span>
              <span className="faint tiny">Export index includes all {total} matching records, not just this page.</span>
              {pages > 1 && (
                <span className="row" style={{ marginLeft: 'auto', gap: 6 }}>
                  <button className="btn sm" disabled={page === 0} onClick={() => update({ page: String(page - 1) }, false)}>Previous</button>
                  <span className="small">Page {page + 1} of {pages}</span>
                  <button className="btn sm" disabled={page >= pages - 1} onClick={() => update({ page: String(page + 1) }, false)}>Next</button>
                </span>
              )}
            </div>
          </>
        )}
      </Panel>

      <AddEvidenceDrawer open={addOpen} onClose={() => update({ upload: null }, false)} />
      <QuickView id={quick} onClose={() => setQuick(null)} onOpen={(id) => navigate(`/evidence/${id}`)} />
    </>
  );
}

function ExportMenu({ csv, json, anyFilter }: { csv: string; json: string; anyFilter: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download /> Export index
      </button>
      {open && (
        <div className="search-results" role="menu" style={{ left: 'auto', right: 0, width: 300 }}>
          <div className="tiny faint" style={{ padding: '4px 9px 6px' }}>
            Exports every record {anyFilter ? 'matching the current filters' : 'in the current view'}. All pages, not only the visible one.
          </div>
          <a href={csv} role="menuitem" style={{ display: 'block' }} onClick={(e) => { e.preventDefault(); download(csv); setOpen(false); }}>
            <div>Evidence index (CSV)</div>
            <div className="tiny faint">Spreadsheet-safe, one row per Evidence ID</div>
          </a>
          <a href={json} role="menuitem" style={{ display: 'block' }} onClick={(e) => { e.preventDefault(); download(json); setOpen(false); }}>
            <div>Evidence index (JSON)</div>
            <div className="tiny faint">Structured, includes the hash caveat</div>
          </a>
        </div>
      )}
    </div>
  );
}

function EmptyLocker({ isDemo, onAdd }: { isDemo: boolean; onAdd: () => void }) {
  return (
    <div className="panel-body">
      <EmptyState
        icon={<Archive />}
        title="No evidence in this engagement yet"
        actions={
          <>
            <button className="btn primary" onClick={onAdd}><Plus /> Add evidence</button>
            <Link className="btn" to="/scan?tab=import">Import scan results</Link>
          </>
        }
      >
        Add screenshots, sanitized tool output, logs, or PCAP references. Each item gets a permanent Evidence ID and a SHA-256 hash calculated from its bytes.
      </EmptyState>
      <div className="ev-source-guide">
        {(['authorized_lab', 'instructor_supplied', 'external_reference', 'project_artifact'] as const).map((s) => (
          <div key={s}>
            <SourceBadge value={s} />
            <p className="small muted" style={{ marginTop: 6 }}>{SOURCE_HELP[s]}</p>
          </div>
        ))}
      </div>
      <Notice tone="info">
        {isDemo
          ? 'This is the demo engagement: anything added here is labeled as demo data and stays isolated from the real assessment.'
          : 'Demo data cannot be added to a real engagement. Switch to the demo engagement (Settings) to explore the interface with synthetic records.'}
      </Notice>
    </div>
  );
}

function QuickView({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  const { base } = useEngagement();
  const q = useQuery({ queryKey: ['evidence', 'detail', id], queryFn: () => api.get<any>(`${base}/evidence/${id}`), enabled: !!id });
  const e = q.data;
  const linkCount = e ? e.findings.length + e.timeline.length + e.recon.length + e.indicators.length : 0;
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={e ? <><span className="mono" style={{ color: 'var(--accent-strong)' }}>{e.code}</span> {e.title}</> : 'Evidence'}
      subtitle={e ? <span className="row" style={{ gap: 6 }}><SourceBadge value={e.source_category} /><SanitizationBadge value={e.sanitization_status} />{e.status === 'withdrawn' && <Badge tone="muted">Withdrawn</Badge>}</span> : undefined}
      footer={id ? <><button className="btn ghost" onClick={onClose}>Close</button><button className="btn primary" onClick={() => onOpen(id)}><ExternalLink /> Open full record</button></> : undefined}
    >
      {q.isLoading && <Loading />}
      {q.isError && <ErrorState error={q.error} />}
      {e && (
        <div className="stack">
          <KV
            items={[
              ['Kind', e.kind === 'reference' ? 'Reference (file not stored)' : `${e.detected_type} · ${fmtBytes(e.size_bytes)}`],
              ['File', e.original_filename ? <span className="mono">{e.original_filename}</span> : e.reference_uri ? <span className="mono">{e.reference_uri}</span> : '—'],
              ['Source / tool', e.source_tool || '—'],
              ['Collected', e.collected_at ? fmtDateTime(e.collected_at) : <span className="faint">{e.collected_at_note || 'Not supplied'}</span>],
              ['Imported', fmtDateTime(e.imported_at)],
              ['Confidence', <ConfidenceBadge value={e.confidence} />],
              ['SHA-256', e.sha256 ? <span className="mono tiny ev-hash-inline">{e.sha256}</span> : '—'],
              ['Linked records', `${linkCount} (findings ${e.findings.length}, timeline ${e.timeline.length}, recon ${e.recon.length}, indicators ${e.indicators.length})`],
            ]}
          />
          <div>
            <h3 className="ev-sub">Observation</h3>
            <p className="ev-prose">{e.observation || <span className="faint">Not recorded.</span>}</p>
          </div>
          <div>
            <h3 className="ev-sub">Interpretation</h3>
            <p className="ev-prose">{e.interpretation || <span className="faint">Not recorded.</span>}</p>
          </div>
          {e.analysis_note && <Notice tone="info">{e.analysis_note}</Notice>}
          <p className="tiny faint">{HASH_CAVEAT}</p>
        </div>
      )}
    </Drawer>
  );
}

function TypeIcon({ e }: { e: Evidence }) {
  if (e.kind === 'reference') return <Link2 />;
  const t = e.detected_type ?? '';
  if (['png', 'jpeg', 'gif', 'webp'].includes(t)) return <ImageIcon />;
  if (t === 'pcap' || t === 'pcapng') return <Radio />;
  if (['zip', 'gzip'].includes(t)) return <FileArchive />;
  if (['nmap_xml', 'nessus_xml', 'greenbone_xml', 'xml', 'json', 'html', 'svg', 'csv'].includes(t)) return <FileCode2 />;
  if (t === 'text' || t === 'pdf') return <FileText />;
  return <FileIcon />;
}

function anyFilterInitial(p: URLSearchParams) {
  return FILTER_KEYS.some((k) => k !== 'q' && p.get(k));
}

const SANI_SHORT: Record<string, [string, 'ok' | 'warn' | 'bad']> = {
  not_reviewed: ['Not reviewed', 'warn'],
  sanitized: ['Sanitized', 'ok'],
  no_sensitive_data: ['No sensitive data', 'ok'],
  contains_sensitive: ['Sensitive', 'bad'],
};
function CompactSanitization({ value }: { value: string }) {
  const [label, tone] = SANI_SHORT[value] ?? [humanize(value), 'warn'];
  return <span title={`Sanitization: ${humanize(value)}`}><StatusPill tone={tone}>{label}</StatusPill></span>;
}
