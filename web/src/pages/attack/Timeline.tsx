import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, Bot, ChevronDown, ChevronRight, Pencil, Trash2, CheckCircle2, Circle, Clock3, ListOrdered } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { download, fmtDateTime, humanize } from '../../lib/format';
import { Panel, EmptyState, ErrorState, Loading, Field, Select, ConfidenceBadge, Badge, Notice, KV } from '../../components/ui';
import { matchText } from '../../components/DataTable';
import { Drawer, ConfirmDialog, useToast } from '../../components/overlay';
import { EvidenceChips, EvidencePicker } from '../../components/evidence';
import { CaptureButton } from '../../components/CaptureButton';
import { CONFIDENCE_OPTS, FactBadge, timezoneOptions, useEngagementDetail, type TimelineEvent } from './shared';

export function TimelineTab({ onGoEvents }: { onGoEvents: () => void }) {
  const { base, eid } = useEngagement();
  const eng = useEngagementDetail();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['timeline', eid], queryFn: () => api.get<TimelineEvent[]>(`${base}/timeline`), enabled: !!eid });
  const tracker = useQuery({ queryKey: ['tracker', eid], queryFn: () => api.get<any>(`${base}/tracker`), enabled: !!eid });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TimelineEvent | 'new' | null>(null);
  const rows = q.data ?? [];
  const tz = eng.data?.timezone;

  useEffect(() => {
    const focus = params.get('focus');
    if (focus && rows.length) {
      const r = rows.find((x) => x.id === focus || x.code === focus);
      if (r) {
        setExpanded((s) => new Set(s).add(r.id));
        setTimeout(() => document.getElementById(`tl-${r.id}`)?.scrollIntoView({ block: 'center' }), 50);
      }
    }
  }, [params, rows]);

  const filtered = useMemo(
    () => rows.filter((r) => (!status || r.verification_status === status) && (!type || r.event_type === type) && matchText(r, search, ['code', 'observation', 'student_interpretation', 'source_host', 'dest_host', 'original_timestamp', (x) => x.evidence.map((e) => e.code).join(' ')])),
    [rows, search, status, type],
  );
  const placed = filtered.filter((r) => r.normalized_ts);
  const unplaced = filtered.filter((r) => !r.normalized_ts);
  const types = [...new Set(rows.map((r) => r.event_type).filter(Boolean))].sort();
  const lab5 = tracker.data?.labs?.find((l: any) => l.lab === 'lab5');
  const interpreted = rows.filter((r) => r.student_interpretation.trim()).length;
  const teamDone = rows.length >= 5 && interpreted >= 5;
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const closeDrawer = () => {
    setEditing(null);
    if (params.get('focus')) {
      const p = new URLSearchParams(params);
      p.delete('focus');
      setParams(p, { replace: true });
    }
  };

  return (
    <div className="stack">
      <div className="grid span-main">
        <Panel title="Lab 5 requirements" hint="Checked against stored records">
          {!lab5 ? <Loading rows={3} /> : lab5.requirements.map((r: any) => (
            <div className="req" key={r.id}>
              {r.met ? <CheckCircle2 className="met" aria-label="Met" /> : <Circle className="unmet" aria-label="Not met" />}
              <span>{r.label}</span>
              <span className="small muted nowrap">{r.detail}</span>
            </div>
          ))}
        </Panel>
        <Panel title="AI timeline summary" hint="After your own analysis">
          <p className="small muted">
            The packet requires the team to finish its own analysis first. The student interpretation on each event stays separate from any AI summary, and AI text must be verified before it enters the report.
          </p>
          {teamDone ? (
            <Link className="btn" to="/ai?task=timeline_summary"><Bot /> Summarize timeline with AI</Link>
          ) : (
            <>
              <button className="btn" disabled title="Available once at least five timeline events have a student interpretation"><Bot /> Summarize timeline with AI</button>
              <p className="tiny faint" style={{ marginTop: 6 }}>{interpreted} of 5 events have a student interpretation.</p>
            </>
          )}
        </Panel>
      </div>

      <Panel
        title="Attack timeline"
        hint={rows.length ? `${filtered.length} of ${rows.length} events` : undefined}
        actions={
          <>
            <CaptureButton title="Completed attack timeline" compact />
            <button className="btn sm" disabled={!rows.length} onClick={() => download(`${base}/exports/timeline.csv`)}><Download /> CSV</button>
            <button className="btn primary sm" onClick={() => setEditing('new')}><Plus /> Add event</button>
          </>
        }
      >
        {rows.length > 0 && (
          <div className="filters" style={{ padding: '0 0 12px' }}>
            <input type="search" placeholder="Search timeline" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search timeline" />
            <Select ariaLabel="Fact or assumption" value={status} onChange={setStatus} placeholder="Facts and assumptions" options={[{ value: 'fact', label: 'Facts only' }, { value: 'assumption', label: 'Assumptions only' }, { value: 'requires_more_evidence', label: 'Requires additional evidence' }]} />
            <Select ariaLabel="Event type" value={type} onChange={setType} placeholder="Any event type" options={types} />
            <span className="legend" style={{ marginTop: 0 }}>
              <span className="row" style={{ gap: 6 }}><span className="tl-key solid" /> Order established</span>
              <span className="row" style={{ gap: 6 }}><span className="tl-key dashed" /> Order uncertain</span>
              <span className="row" style={{ gap: 6 }}><span className="tl-key hollow" /> Time unknown</span>
            </span>
          </div>
        )}
        {q.isError ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon={<ListOrdered />} title="The timeline is empty" actions={<><button className="btn primary" onClick={onGoEvents}>Pick events from imported logs</button><button className="btn" onClick={() => setEditing('new')}><Plus /> Add event manually</button></>}>
            Build a chronological timeline of at least five events from the supplied evidence. Each event keeps its original timestamp; events whose time cannot be established are kept in a separate “unplaced” group, never guessed.
          </EmptyState>
        ) : !filtered.length ? (
          <EmptyState title="No timeline events match these filters" />
        ) : (
          <div className="stack">
            {placed.length > 0 && (
              <div className="timeline" role="list" aria-label="Events in chronological order">
                {placed.map((t, i) => {
                  const prev = placed[i - 1];
                  const sameTime = prev && prev.normalized_ts === t.normalized_ts;
                  return <TimelineItem key={t.id} t={t} tz={tz} expanded={expanded.has(t.id)} onToggle={() => toggle(t.id)} onEdit={() => setEditing(t)} sameTimeAsPrev={!!sameTime} />;
                })}
              </div>
            )}
            {unplaced.length > 0 && (
              <div>
                <h3 className="row" style={{ gap: 8, marginBottom: 8 }}><Clock3 size={16} /> Unplaced: time unknown ({unplaced.length})</h3>
                <p className="tiny faint" style={{ marginTop: -4 }}>These events could not be placed on the clock. They are listed by sequence hint (if the evidence suggests an order), not positioned among timed events.</p>
                <div className="timeline unplaced" role="list" aria-label="Events without an established time">
                  {unplaced.map((t) => <TimelineItem key={t.id} t={t} tz={tz} expanded={expanded.has(t.id)} onToggle={() => toggle(t.id)} onEdit={() => setEditing(t)} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>

      <details className="panel norm-doc">
        <summary>How timestamps are normalized</summary>
        <ul className="small muted">
          <li>The original timestamp text from the evidence is always preserved and shown.</li>
          <li>Timestamps with an explicit offset (<code>Z</code>, <code>-04:00</code>) or epoch seconds are converted to UTC and displayed in your browser's local time.</li>
          <li>Timestamps without an offset are interpreted in the source timezone declared at import (or on the event) and labeled “assumed timezone”.</li>
          <li>Missing timestamps, syslog times without a year, and Wireshark relative times are never placed on the clock; those events appear under “Unplaced”.</li>
          <li>Events at the same second are shown in the order the evidence lists them; use “order uncertain” when the evidence cannot establish an exact order.</li>
        </ul>
      </details>

      <TimelineDrawer key={editing === 'new' ? 'new' : editing?.id ?? 'none'} item={editing} onClose={closeDrawer} />
    </div>
  );
}

function TimelineItem({ t, tz, expanded, onToggle, onEdit, sameTimeAsPrev }: { t: TimelineEvent; tz?: string; expanded: boolean; onToggle: () => void; onEdit: () => void; sameTimeAsPrev?: boolean }) {
  const cls = !t.normalized_ts ? 'unknown-time' : t.order_certainty === 'uncertain' || sameTimeAsPrev ? 'uncertain' : '';
  return (
    <div className={`tl-item ${cls}`} role="listitem" id={`tl-${t.id}`}>
      <div className="tl-card">
        <div className="tl-head">
          <button className="btn ghost icon sm" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? `Collapse ${t.code}` : `Expand ${t.code}`}>
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
          <div className="tl-time">
            {t.normalized_ts ? <span className="small">{fmtDateTime(t.normalized_ts)}</span> : <span className="small faint">Time unknown{t.sequence_hint !== null ? ` · sequence ${t.sequence_hint}` : ''}</span>}
            <span className="mono tiny faint">{t.original_timestamp ? `source: ${t.original_timestamp}` : 'no timestamp in source'}</span>
          </div>
          <span className="mono small tl-code">{t.code}</span>
          <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
            {t.time_certainty === 'approximate' && <Badge tone="warn">Approximate time</Badge>}
            {(t.order_certainty === 'uncertain' || sameTimeAsPrev) && <Badge tone="warn">{sameTimeAsPrev && t.order_certainty !== 'uncertain' ? 'Same second as previous' : 'Order uncertain'}</Badge>}
            <FactBadge value={t.verification_status} />
            <button className="btn ghost icon sm" onClick={onEdit} aria-label={`Edit ${t.code}`}><Pencil /></button>
          </span>
        </div>
        <div className="tl-body">
          <div className="row small" style={{ gap: 8 }}>
            {t.event_type && <span className="badge">{t.event_type}</span>}
            {(t.source_host || t.dest_host) && <span className="mono small">{t.source_host || '?'} → {t.dest_host || '?'}</span>}
          </div>
          <p className="tl-obs"><span className="tl-label">Observed</span>{t.observation}</p>
          <p className="tl-interp">
            <span className="tl-label">Student interpretation</span>
            {t.student_interpretation || <span className="faint">Not written yet: open the event to add your interpretation.</span>}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <EvidenceChips items={t.evidence} empty="No evidence linked" />
            {t.mappings.filter((m) => m.status !== 'rejected').map((m) => <Badge key={m.technique_id} tone={m.status === 'verified' ? 'ok' : 'muted'} title={m.status === 'verified' ? 'Verified ATT&CK mapping' : 'Proposed, not verified'}>{m.technique_id}{m.status !== 'verified' ? ' (proposed)' : ''}</Badge>)}
          </div>
        </div>
        {expanded && (
          <div className="tl-more">
            <KV items={[
              ['Normalized (UTC)', <span className="mono">{t.normalized_ts ?? 'Not placed'}</span>],
              ['Displayed in', tz ? `Browser local time (engagement timezone: ${tz})` : 'Browser local time'],
              ['Timezone note', t.timezone_note || '—'],
              ['Time certainty', humanize(t.time_certainty)],
              ['Order certainty', humanize(t.order_certainty)],
              ['Confidence', <ConfidenceBadge value={t.confidence} />],
              ['From log row', t.log_event_id ? 'Yes, copied from an imported log event' : 'No, entered manually'],
              ['Last updated', fmtDateTime(t.updated_at)],
            ]} />
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineDrawer({ item, onClose }: { item: TimelineEvent | 'new' | null; onClose: () => void }) {
  const { base, eid } = useEngagement();
  const eng = useEngagementDetail();
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = item === 'new';
  const r = item && item !== 'new' ? item : null;
  const [f, setF] = useState(() => ({
    original_timestamp: r?.original_timestamp ?? '',
    source_timezone: '',
    time_certainty: r?.time_certainty ?? 'exact',
    order_certainty: r?.order_certainty ?? 'established',
    sequence_hint: r?.sequence_hint?.toString() ?? '',
    source_host: r?.source_host ?? '',
    dest_host: r?.dest_host ?? '',
    event_type: r?.event_type ?? '',
    observation: r?.observation ?? '',
    student_interpretation: r?.student_interpretation ?? '',
    confidence: r?.confidence ?? 'unrated',
    verification_status: r?.verification_status ?? 'requires_more_evidence',
    evidence_ids: r?.evidence.map((e) => e.id) ?? [],
  }));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v }));
  const tz = f.source_timezone || eng.data?.timezone || 'UTC';
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['timeline', eid] });
    qc.invalidateQueries({ queryKey: ['log-events', eid] });
    qc.invalidateQueries({ queryKey: ['tracker', eid] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...f, sequence_hint: f.sequence_hint === '' ? null : Number(f.sequence_hint), source_timezone: tz };
      const timeChanged = isNew || (f.original_timestamp || '') !== (r?.original_timestamp ?? '');
      if (timeChanged) body.original_timestamp = f.original_timestamp.trim() || null;
      else { delete body.original_timestamp; delete body.source_timezone; }
      return isNew ? api.post(`${base}/timeline`, body) : api.patch(`${base}/timeline/${r!.id}`, body);
    },
    onSuccess: (x: any) => { invalidate(); toast.success(`${isNew ? 'Added' : 'Saved'} ${x.code}${x.normalized_ts ? '' : ' (time not placed on the clock)'}`); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del(`${base}/timeline/${r!.id}`),
    onSuccess: () => { invalidate(); toast.success(`Removed ${r!.code} from the timeline`); setConfirmDel(false); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Drawer
      open={!!item}
      onClose={onClose}
      title={isNew ? 'New timeline event' : `Edit ${r?.code}`}
      subtitle={r?.log_event_id ? 'Copied from an imported log event; the original timestamp came from the source row.' : 'Separate what the evidence shows (observation) from what you think it means (interpretation).'}
      footer={
        <>
          {r && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}><Trash2 /> Remove</button>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!f.observation.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending && <span className="spinner" />} {isNew ? 'Add event' : 'Save changes'}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Timestamp exactly as in the evidence" full htmlFor="tl-ts" help="Leave blank if the evidence has no time. Never estimate a time; use the sequence hint and “order uncertain” instead.">
          <input id="tl-ts" className="mono-input" value={f.original_timestamp} onChange={(e) => set('original_timestamp')(e.target.value)} placeholder="2026-10-08T10:12:04-04:00" />
        </Field>
        <Field label="Timezone if the timestamp has no offset" htmlFor="tl-tz"><Select id="tl-tz" value={tz} onChange={set('source_timezone')} options={timezoneOptions(tz)} /></Field>
        <Field label="Time certainty" htmlFor="tl-tc"><Select id="tl-tc" value={f.time_certainty} onChange={set('time_certainty')} options={['exact', 'approximate', 'unknown']} /></Field>
        <Field label="Order certainty" htmlFor="tl-oc"><Select id="tl-oc" value={f.order_certainty} onChange={set('order_certainty')} options={[{ value: 'established', label: 'Established by evidence' }, { value: 'uncertain', label: 'Uncertain' }]} /></Field>
        <Field label="Sequence hint (optional)" htmlFor="tl-seq" help="Relative order for events without a time"><input id="tl-seq" inputMode="numeric" value={f.sequence_hint} onChange={(e) => set('sequence_hint')(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Source" htmlFor="tl-src"><input id="tl-src" className="mono-input" value={f.source_host} onChange={(e) => set('source_host')(e.target.value)} /></Field>
        <Field label="Destination" htmlFor="tl-dst"><input id="tl-dst" className="mono-input" value={f.dest_host} onChange={(e) => set('dest_host')(e.target.value)} /></Field>
        <Field label="Event type" full htmlFor="tl-type"><input id="tl-type" value={f.event_type} onChange={(e) => set('event_type')(e.target.value)} placeholder="e.g. auth_failure, connection_attempt" /></Field>
        <Field label="Observed event (fact from the evidence)" full htmlFor="tl-obs"><textarea id="tl-obs" value={f.observation} onChange={(e) => set('observation')(e.target.value)} /></Field>
        <Field label="Student interpretation" full htmlFor="tl-int" help="Your team's own analysis. Kept separate from any AI summary."><textarea id="tl-int" value={f.student_interpretation} onChange={(e) => set('student_interpretation')(e.target.value)} /></Field>
        <Field label="Fact or assumption" htmlFor="tl-vs"><Select id="tl-vs" value={f.verification_status} onChange={set('verification_status')} options={[{ value: 'fact', label: 'Fact: the evidence shows it' }, { value: 'assumption', label: 'Assumption' }, { value: 'requires_more_evidence', label: 'Requires additional evidence' }]} /></Field>
        <Field label="Confidence" htmlFor="tl-conf"><Select id="tl-conf" value={f.confidence} onChange={set('confidence')} options={CONFIDENCE_OPTS} /></Field>
        <div className="full"><EvidencePicker value={f.evidence_ids} onChange={set('evidence_ids')} /></div>
      </div>
      {f.verification_status === 'fact' && !f.evidence_ids.length && <div style={{ marginTop: 12 }}><Notice tone="warn">A fact should be backed by at least one Evidence ID.</Notice></div>}
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={() => del.mutate()} busy={del.isPending} title={`Remove ${r?.code}?`} confirmLabel="Remove event">
        <p>The timeline event and its ATT&CK mappings are removed; the code is retired. Imported log rows and evidence are not affected.</p>
      </ConfirmDialog>
    </Drawer>
  );
}
