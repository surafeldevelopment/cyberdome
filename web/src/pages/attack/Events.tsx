import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Flag, ListPlus, Upload, Activity, CalendarClock, KeyRound, Network, ShieldAlert, Radio } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { download, fmtDateTime, fromLocalInput, humanize } from '../../lib/format';
import { Panel, EmptyState, ErrorState, Loading, Select, KV, Notice, HowCalculated } from '../../components/ui';
import { AssetCell } from '../../components/kit';
import { AreaChart } from '../../components/charts';
import { DataTable } from '../../components/DataTable';
import { Drawer, useToast } from '../../components/overlay';
import { CaptureButton } from '../../components/CaptureButton';
import { TsStatusBadge, TsStatusPill, KebabButton, hp, type LogEvent } from './shared';

const PAGE = 100;

export function EventsTab({ importFilter, onGoImports }: { importFilter?: string; onGoImports: () => void }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [urlParams] = useSearchParams();
  const flaggedParam = urlParams.get('flagged') === '1';
  const [f, setF] = useState({ q: '', host: '', event_type: '', protocol: '', ts_status: '', flagged: flaggedParam, from: '', to: '', import: importFilter ?? '', port: '' });
  useEffect(() => setF((x) => ({ ...x, flagged: flaggedParam })), [flaggedParam]);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<LogEvent | null>(null);
  useEffect(() => setF((x) => ({ ...x, import: importFilter ?? '' })), [importFilter]);
  useEffect(() => setOffset(0), [f]);
  const set = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v }));

  const params = { q: f.q, host: f.host, event_type: f.event_type, protocol: f.protocol, ts_status: f.ts_status, flagged: f.flagged ? '1' : '', from: fromLocalInput(f.from), to: fromLocalInput(f.to), import: f.import, port: f.port };
  const q = useQuery({
    queryKey: ['log-events', eid, params, offset],
    queryFn: () => api.get<{ items: LogEvent[]; total: number; facets: any }>(`${base}/log-events${qs({ ...params, limit: PAGE, offset })}`),
    enabled: !!eid,
    placeholderData: (prev) => prev,
  });
  const imports = useQuery({ queryKey: ['log-imports', eid], queryFn: () => api.get<any[]>(`${base}/log-imports`), enabled: !!eid });
  const total = q.data?.total ?? 0;
  const facets = q.data?.facets;
  const hosts = facets ? [...new Set([...facets.sources.map((x: any) => x.v), ...facets.destinations.map((x: any) => x.v)])].sort() : [];
  const filtersOn = Object.entries(f).some(([k, v]) => v && v !== '' && k !== 'flagged') || f.flagged;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['log-events', eid] });
    qc.invalidateQueries({ queryKey: ['timeline', eid] });
    qc.invalidateQueries({ queryKey: ['tracker', eid] });
  };
  const flag = useMutation({ mutationFn: (e: LogEvent) => api.patch(`${base}/log-events/${e.id}`, { flagged: !e.flagged }), onSuccess: invalidate, onError: (e) => toast.error(errorMessage(e)) });
  const promote = useMutation({
    mutationFn: (e: LogEvent) => api.post(`${base}/timeline/from-log-event/${e.id}`),
    onSuccess: (t: any) => { invalidate(); toast.success(`Added ${t.code} to the timeline. Add your interpretation on the Timeline tab.`); setOpen(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const noData = !q.isLoading && !filtersOn && total === 0;

  return (
    <div className="stack">
      {!noData && !q.isLoading && !q.isError && <EventsOverTime eventTypes={(facets?.event_types ?? []).map((x: any) => x.v)} />}
      <Panel className="ev-table-wrap"
        title="Log and Packet Events"
        hint={q.data ? `${total.toLocaleString()} matching event${total === 1 ? '' : 's'}` : undefined}
        flush
        actions={
          <>
            <CaptureButton title="Analysis filter/view" compact />
            <button className="btn sm" disabled={!total} onClick={() => download(`${base}/exports/log-events.csv${qs(params)}`)}>
              <Download /> Export {filtersOn ? 'filtered' : 'all'} ({total})
            </button>
          </>
        }
      >
        {!noData && (
          <div className="filters">
            <input type="search" placeholder="Search message, host, time" value={f.q} onChange={(e) => set('q')(e.target.value)} aria-label="Search events" />
            <Select ariaLabel="Host" value={f.host} onChange={set('host')} placeholder="Any host" options={hosts.map((h) => ({ value: h, label: h }))} />
            <Select ariaLabel="Event type" value={f.event_type} onChange={set('event_type')} placeholder="Any event type" options={(facets?.event_types ?? []).map((x: any) => ({ value: x.v, label: `${x.v} (${x.n})` }))} />
            <Select ariaLabel="Protocol" value={f.protocol} onChange={set('protocol')} placeholder="Any protocol" options={(facets?.protocols ?? []).map((x: any) => ({ value: x.v, label: `${x.v} (${x.n})` }))} />
            <input type="text" inputMode="numeric" placeholder="Port" value={f.port} onChange={(e) => set('port')(e.target.value.replace(/\D/g, ''))} aria-label="Port" style={{ width: 90 }} className="mono-input" />
            <Select ariaLabel="Timestamp status" value={f.ts_status} onChange={set('ts_status')} placeholder="Any time status" options={[{ value: 'explicit_offset', label: 'Explicit offset' }, { value: 'assumed_timezone', label: 'Assumed timezone' }, { value: 'missing', label: 'Time missing' }, { value: 'unparseable', label: 'Not placeable' }]} />
            <Select ariaLabel="Import" value={f.import} onChange={set('import')} placeholder="All imports" options={(imports.data ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.original_filename ?? i.format}` }))} />
            <label className="check"><input type="checkbox" checked={f.flagged} onChange={(e) => set('flagged')(e.target.checked)} /> Flagged only</label>
            <span className="row small" style={{ gap: 6 }}>
              <label htmlFor="ev-from" className="muted">From</label>
              <input id="ev-from" type="datetime-local" value={f.from} onChange={(e) => set('from')(e.target.value)} style={{ width: 'auto' }} />
              <label htmlFor="ev-to" className="muted">to</label>
              <input id="ev-to" type="datetime-local" value={f.to} onChange={(e) => set('to')(e.target.value)} style={{ width: 'auto' }} />
            </span>
            {filtersOn && <button className="btn ghost sm" onClick={() => setF({ q: '', host: '', event_type: '', protocol: '', ts_status: '', flagged: false, from: '', to: '', import: '', port: '' })}>Clear filters</button>}
          </div>
        )}
        {(f.from || f.to) && (
          <div style={{ padding: '0 16px 10px' }}><Notice tone="info">Time-range filters only match events whose time could be placed on the clock. Events with missing or unplaceable times are excluded while a range is set.</Notice></div>
        )}
        {q.isError ? (
          <div style={{ padding: 16 }}><ErrorState error={q.error} retry={() => q.refetch()} /></div>
        ) : q.isLoading ? (
          <div style={{ padding: 16 }}><Loading /></div>
        ) : noData ? (
          <EmptyState icon={<Activity />} title="No log or packet events imported" actions={<button className="btn primary" onClick={onGoImports}><Upload /> Import logs or packet export</button>}>
            Import the instructor-provided logs, a Wireshark/tshark export, or process a stored PCAP. Events appear here with their original timestamps preserved.
          </EmptyState>
        ) : (
          <>
            <DataTable
              caption="Log events"
              manualSort
              pageSize={PAGE}
              rows={q.data?.items ?? []}
              rowKey={(r) => r.id}
              onRowClick={setOpen}
              rowClassName={(r) => (r.flagged ? 'flagged-row' : '')}
              columns={[
                { key: 'event', header: 'Event', render: (r) => (
                  <AssetCell
                    icon={<EventIcon type={r.event_type} />}
                    title={r.event_type ?? 'No event type'}
                    sub={<span className="mono" title={r.message ?? ''}>{r.message ?? '—'}</span>}
                  />
                ) },
                { key: 'time', header: 'Time (local) / original / status', render: (r) => (
                  <div className="nowrap ev-time">
                    <div>{r.normalized_ts ? fmtDateTime(r.normalized_ts) : <span className="faint">Not placed on the clock</span>}</div>
                    <div className="mono tiny faint clip" style={{ maxWidth: '28ch' }} title={r.original_timestamp ?? 'no timestamp in source'}>{r.original_timestamp ?? '∅ no timestamp'}</div>
                    <div style={{ marginTop: 5 }}><TsStatusPill status={r.ts_status} /></div>
                  </div>
                ) },
                { key: 'flow', header: 'Source → destination', render: (r) => (
                  <div className="nowrap">
                    <div className="mono small">{hp(r.source, r.src_port)}</div>
                    <div className="mono small">→ {hp(r.destination, r.dst_port)}{r.protocol ? <span className="tiny faint"> · {r.protocol}</span> : null}</div>
                  </div>
                ) },
                { key: 'evidence', header: 'Evidence', render: (r) => (r.evidence_id ? <Link className={`ev-chip ${r.evidence_status === 'withdrawn' ? 'withdrawn' : ''}`} to={`/evidence/${r.evidence_id}`}>{r.evidence_code}</Link> : '—') },
                { key: 'actions', header: 'Action', className: 'ev-act', render: (r) => (
                  <span className="row nowrap" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                    <button className={`btn icon sm ${r.flagged ? 'flag-on' : 'ghost'}`} aria-pressed={r.flagged} aria-label={r.flagged ? 'Unflag event' : 'Flag event'} title={r.flagged ? 'Flagged: click to unflag' : 'Flag as meaningful'} onClick={() => flag.mutate(r)}>
                      <Flag />
                    </button>
                    {r.timeline_id ? (
                      <Link className="ev-chip" to={`/attack?tab=timeline&focus=${r.timeline_id}`} title="On the timeline">{r.timeline_code}</Link>
                    ) : (
                      <button className="btn sm" onClick={() => promote.mutate(r)} disabled={promote.isPending} title="Copy this event (with its original timestamp and evidence) to the timeline"><ListPlus /> Timeline</button>
                    )}
                    <KebabButton label={`Open event row ${r.row_number}`} onClick={() => setOpen(r)} />
                  </span>
                ) },
              ]}
              empty={<EmptyState title="No events match these filters" />}
            />
            {total > PAGE && (
              <div className="table-foot">
                <span>Showing {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()} (sorted by time; events without a placeable time last)</span>
                <span className="row" style={{ marginLeft: 'auto', gap: 6 }}>
                  <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
                  <button className="btn sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
                </span>
              </div>
            )}
          </>
        )}
      </Panel>

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `${open.import_code} · row ${open.row_number}` : ''}
        subtitle={open && <TsStatusBadge status={open.ts_status} />}
        footer={
          open && (
            <>
              <button className="btn" onClick={() => { flag.mutate(open); setOpen({ ...open, flagged: !open.flagged }); }}><Flag /> {open.flagged ? 'Unflag' : 'Flag'}</button>
              {open.timeline_id ? (
                <Link className="btn primary" to={`/attack?tab=timeline&focus=${open.timeline_id}`}>Open {open.timeline_code}</Link>
              ) : (
                <button className="btn primary" onClick={() => promote.mutate(open)} disabled={promote.isPending}><ListPlus /> Add to timeline</button>
              )}
            </>
          )
        }
      >
        {open && (
          <div className="stack">
            <KV
              items={[
                ['Original timestamp', <span className="mono">{open.original_timestamp ?? '— (none in source)'}</span>],
                ['Normalized (UTC)', <span className="mono">{open.normalized_ts ?? 'Not placed on the clock'}</span>],
                ['Source', <span className="mono">{hp(open.source, open.src_port)}</span>],
                ['Destination', <span className="mono">{hp(open.destination, open.dst_port)}</span>],
                ['Protocol', <span className="mono">{open.protocol ?? '—'}</span>],
                ['Event type', open.event_type ?? '—'],
                ['Evidence', open.evidence_id ? <Link className="ev-chip" to={`/evidence/${open.evidence_id}`}>{open.evidence_code}</Link> : '—'],
                ['Import', `${open.import_code}, row ${open.row_number}`],
              ]}
            />
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>Message (verbatim)</div>
              <pre className="code-block wrap">{open.message ?? '—'}</pre>
            </div>
            <div>
              <div className="small muted" style={{ marginBottom: 4 }}>Raw record as imported</div>
              <pre className="code-block">{JSON.stringify(open.raw, null, 2)}</pre>
            </div>
            <p className="tiny faint">{humanize(open.ts_status)}: the original text is preserved; CyberDome never fills in or guesses missing times.</p>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function EventIcon({ type }: { type: string | null }) {
  const t = (type ?? '').toLowerCase();
  if (/auth|login|password|logon/.test(t)) return <KeyRound />;
  if (/connect|syn|scan|packet|flow/.test(t)) return <Network />;
  if (/alert|attack|exploit|malware/.test(t)) return <ShieldAlert />;
  if (/outbound|dns|http/.test(t)) return <Radio />;
  return <Activity />;
}

const MAX_CHART_EVENTS = 20000;

/**
 * Events per hour/day from real normalized timestamps (UTC buckets). Events whose time could not be
 * placed on the clock are excluded and counted separately — nothing is interpolated or guessed.
 */
function EventsOverTime({ eventTypes }: { eventTypes: string[] }) {
  const { base, eid } = useEngagement();
  const [granSel, setGranSel] = useState<'auto' | 'minute' | 'hour' | 'day'>('auto');
  const [type, setType] = useState('');
  const q = useQuery({
    queryKey: ['log-events', eid, 'chart', type],
    enabled: !!eid,
    queryFn: async () => {
      const times: string[] = [];
      let total = 0;
      for (let offset = 0; offset < MAX_CHART_EVENTS; offset += 1000) {
        const page = await api.get<{ items: LogEvent[]; total: number }>(`${base}/log-events${qs({ event_type: type, limit: 1000, offset })}`);
        total = page.total;
        for (const e of page.items) if (e.normalized_ts) times.push(e.normalized_ts);
        if (offset + 1000 >= page.total) break;
      }
      return { times, total, truncated: total > MAX_CHART_EVENTS };
    },
  });

  const span = useMemo(() => {
    const t = q.data?.times;
    if (!t?.length) return 0;
    const ms = t.map((x) => Date.parse(x));
    return Math.max(...ms) - Math.min(...ms);
  }, [q.data]);
  const gran: 'minute' | 'hour' | 'day' = granSel !== 'auto' ? granSel : span <= 6 * 3600000 ? 'minute' : span <= 14 * 86400000 ? 'hour' : 'day';

  const data = useMemo(() => {
    if (!q.data?.times.length) return null;
    const sorted = [...q.data.times].sort();
    const step = gran === 'minute' ? 60000 : gran === 'hour' ? 3600000 : 86400000;
    const floor = (iso: string) => {
      const t = Date.parse(iso);
      return t - (t % step);
    };
    const counts = new Map<number, number>();
    for (const t of sorted) counts.set(floor(t), (counts.get(floor(t)) ?? 0) + 1);
    const first = floor(sorted[0]);
    const last = floor(sorted[sorted.length - 1]);
    const n = Math.round((last - first) / step) + 1;
    if (n > 2000) return { tooMany: true as const };
    const labels: string[] = [];
    const values: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = first + i * step;
      labels.push(gran === 'day' ? new Date(t).toISOString().slice(0, 10) : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
      values.push(counts.get(t) ?? 0);
    }
    return { labels, values, placed: sorted.length };
  }, [q.data, gran]);

  const fmtX = (l: string) => {
    if (gran === 'day') return new Date(l + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const d = new Date(l.replace(' UTC', '').replace(' ', 'T') + ':00Z');
    if (gran === 'minute') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', hour12: false, timeZone: 'UTC' });
  };
  const excluded = q.data ? q.data.total - q.data.times.length : 0;

  return (
    <Panel
      title="Events Over Time"
      hint={data && !('tooMany' in data) ? `${data.placed.toLocaleString()} placed on the clock · UTC` : undefined}
      className="ev-chart"
      actions={
        <>
          <select className="select-pill" aria-label="Bucket size" value={granSel} onChange={(e) => setGranSel(e.target.value as any)}>
            <option value="auto">Auto ({gran === 'minute' ? 'per minute' : gran === 'hour' ? 'per hour' : 'per day'})</option>
            <option value="minute">Per minute</option>
            <option value="hour">Per hour</option>
            <option value="day">Per day</option>
          </select>
          <select className="select-pill" aria-label="Event type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All event types</option>
            {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <HowCalculated text="Imported log and packet-summary events counted per UTC minute, hour or day (Auto picks the finest size that fits the time span) using their normalized timestamps. Events with a missing or unplaceable time are excluded (count shown below). Empty buckets between the first and last event are zero; nothing is interpolated." />
        </>
      }
    >
      {q.isError ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Loading rows={3} label="Counting events" />
      ) : !data ? (
        <EmptyState icon={<CalendarClock />} title="No events with a placeable time">
          {type ? `No “${type}” events` : 'No imported events'} could be placed on the clock, so there is nothing to chart. Their original timestamps are still kept in the table below.
        </EmptyState>
      ) : 'tooMany' in data ? (
        <Notice tone="info">The events span too many {gran === 'minute' ? 'minutes' : gran === 'hour' ? 'hours' : 'days'} to chart at this resolution. Choose a coarser bucket size.</Notice>
      ) : (
        <>
          <AreaChart labels={data.labels} values={data.values} valueLabel={`${type ? `${type} events` : 'events'} per ${gran}`} formatX={fmtX} height={220} />
          <p className="tiny faint" style={{ margin: '6px 0 0' }}>
            {excluded > 0 ? `${excluded.toLocaleString()} event${excluded === 1 ? '' : 's'} without a placeable time ${excluded === 1 ? 'is' : 'are'} excluded from this chart. ` : 'Every matching event had a placeable time. '}
            {q.data?.truncated ? `Only the first ${MAX_CHART_EVENTS.toLocaleString()} events are charted.` : ''}
          </p>
        </>
      )}
    </Panel>
  );
}
