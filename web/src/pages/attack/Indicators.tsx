import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, Trash2, ShieldQuestion, CheckCircle2, Circle, User, Cpu, Network, FileText, Database, ScrollText, Server, HelpCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useEngagement } from '../../lib/engagement';
import { download, fmtDateTime, humanize } from '../../lib/format';
import { Panel, EmptyState, ErrorState, Loading, Field, Select, ConfidenceBadge, Notice, KV } from '../../components/ui';
import { DataTable, matchText } from '../../components/DataTable';
import { Drawer, ConfirmDialog, useToast } from '../../components/overlay';
import { EvidenceChips, EvidencePicker } from '../../components/evidence';
import { AssessmentBadge, AssessmentPill, KebabButton, CONFIDENCE_OPTS, timezoneOptions, useEngagementDetail, type Indicator } from './shared';
import { AssetCell } from '../../components/kit';
import '../../styles/attack.css';

const TYPES = ['account', 'process', 'network', 'file', 'registry', 'log', 'service', 'other'];
const TYPE_ICON: Record<string, any> = { account: User, process: Cpu, network: Network, file: FileText, registry: Database, log: ScrollText, service: Server, other: HelpCircle };
const TypeIcon = ({ t }: { t: string }) => { const I = TYPE_ICON[t] ?? HelpCircle; return <I />; };
const UNRESOLVED = ['unassessed', 'suspicious', 'requires_more_evidence'];

/** Lab 1 "complete" = observation + why suspicious + additional evidence needed + assessed + ≥1 evidence. */
export function indicatorComplete(i: Indicator) {
  if (i.lab === 'lab1')
    return !!(i.observation.trim() && i.why_suspicious.trim() && i.additional_evidence_needed.trim() && i.assessment !== 'unassessed' && i.evidence.some((e) => e.status !== 'withdrawn'));
  return !!((i.analyst_assessment.trim() || i.why_suspicious.trim()) && i.evidence.length);
}

/**
 * Indicator workflow shared by Engagement (Lab 1 signs of compromise) and Attack Evidence (Lab 5).
 * CONTRACT: IndicatorsPanel({ lab }) — imported by the Engagement page.
 */
export function IndicatorsPanel({ lab }: { lab: 'lab1' | 'lab5' }) {
  const { base, eid } = useEngagement();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['indicators', eid, lab], queryFn: () => api.get<Indicator[]>(`${base}/indicators?lab=${lab}`), enabled: !!eid });
  const [search, setSearch] = useState('');
  const [assessment, setAssessment] = useState(params.get('unresolved') === '1' ? 'unresolved' : '');
  useEffect(() => { if (params.get('unresolved') === '1') setAssessment('unresolved'); }, [params]);
  const [editing, setEditing] = useState<Indicator | 'new' | null>(null);
  const rows = q.data ?? [];

  useEffect(() => {
    const focus = params.get('focus');
    if (focus && rows.length) {
      const r = rows.find((x) => x.id === focus || x.code === focus);
      if (r) setEditing(r);
    }
  }, [params, rows]);

  const filtered = useMemo(
    () => rows.filter((r) => (!assessment || (assessment === 'unresolved' ? UNRESOLVED.includes(r.assessment) : r.assessment === assessment)) && matchText(r, search, ['code', 'title', 'value', 'observation', 'source_host', 'dest_host', (x) => x.evidence.map((e) => e.code).join(' ')])),
    [rows, search, assessment],
  );
  const done = rows.filter(indicatorComplete).length;
  const isLab1 = lab === 'lab1';
  const close = () => {
    setEditing(null);
    if (params.get('focus')) {
      const p = new URLSearchParams(params);
      p.delete('focus');
      setParams(p, { replace: true });
    }
  };

  return (
    <Panel
      className="ind-panel"
      title={isLab1 ? 'Possible Signs of Compromise' : 'Indicators and Meaningful Events'}
      hint={`${done} of 5 complete`}
      flush
      actions={
        <>
          <button className="btn sm" disabled={!rows.length} onClick={() => download(`${base}/exports/indicators.csv?lab=${lab}`)}>
            <Download /> CSV
          </button>
          <button className="btn primary sm" onClick={() => setEditing('new')}>
            <Plus /> Add {isLab1 ? 'sign' : 'indicator'}
          </button>
        </>
      }
    >
      <div style={{ padding: '0 20px 14px' }}>
        <div className="req-meter" aria-label={`${done} of 5 required ${isLab1 ? 'signs of compromise' : 'indicators'} complete`}>
          <div className="progress" style={{ flex: 1 }}><div style={{ width: `${Math.min(100, (done / 5) * 100)}%` }} /></div>
          <span className="small muted nowrap">
            {done >= 5 ? <CheckCircle2 size={14} className="met-icon" /> : <Circle size={14} />} {done}/5 complete
          </span>
        </div>
        <p className="tiny faint" style={{ margin: '6px 0 0' }}>
          {isLab1
            ? 'Complete = what was observed, why it may be suspicious, what additional evidence is needed, an analyst assessment, and at least one linked Evidence ID. Use only instructor-approved Windows CMD or Kali evidence.'
            : 'Complete = an interpretation (why it matters) and at least one linked Evidence ID. Mark anything uncertain as “requires additional evidence”.'}
        </p>
      </div>
      <div className="filters">
        <input type="search" placeholder="Search indicators" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search indicators" />
        <Select ariaLabel="Assessment" value={assessment} onChange={setAssessment} placeholder="Any assessment" options={[{ value: 'unresolved', label: 'Unresolved (not benign)' }, { value: 'unassessed', label: 'Not assessed' }, { value: 'suspicious', label: 'Suspicious' }, { value: 'benign', label: 'Benign' }, { value: 'requires_more_evidence', label: 'Requires additional evidence' }]} />
        {(search || assessment) && <button className="btn ghost sm" onClick={() => { setSearch(''); setAssessment(''); }}>Clear filters</button>}
      </div>
      {q.isError ? (
        <div style={{ padding: 16 }}><ErrorState error={q.error} retry={() => q.refetch()} /></div>
      ) : q.isLoading ? (
        <div style={{ padding: 16 }}><Loading /></div>
      ) : (
        <DataTable
          caption={isLab1 ? 'Signs of compromise' : 'Indicators'}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={setEditing}
          initialSort={{ key: 'code', dir: 'asc' }}
          columns={[
            { key: 'code', header: 'Indicator', sortValue: (r) => Number(r.code.replace(/\D/g, '')), render: (r) => (
              <AssetCell icon={<TypeIcon t={r.indicator_type} />} title={r.title} sub={`${r.code}${r.value ? ` · ${r.value}` : ''}`} />
            ) },
            ...(isLab1
              ? [{ key: 'observation', header: 'Observed / why suspicious', render: (r: Indicator) => (
                  <div className="wrap-cell obs-why" style={{ maxWidth: '40ch' }}>
                    <span className="small clamp-1" title={r.observation}>{r.observation || <span className="faint">Observation missing</span>}</span>
                    <span className="tiny muted clamp-1" title={r.why_suspicious}>{r.why_suspicious ? `Why: ${r.why_suspicious}` : <span className="faint">Why suspicious: not written</span>}</span>
                  </div>
                ) }]
              : [{ key: 'observation', header: 'Observed', render: (r: Indicator) => <span className="small clamp-2 wrap-cell" style={{ maxWidth: '36ch' }}>{r.observation || <span className="faint">—</span>}</span> },{ key: 'observed_at', header: 'Source → destination / time', sortValue: (r: Indicator) => r.observed_at ?? '', render: (r: Indicator) => (
                  <div className="nowrap">
                    <div className="mono small">{r.source_host || '—'} → {r.dest_host || '—'}</div>
                    <div className="tiny faint">{r.observed_at ? fmtDateTime(r.observed_at) : r.observed_at_original ? <span title="Could not be placed on the clock">“{r.observed_at_original}” (not placed)</span> : 'Time unknown'}</div>
                  </div>
                ) }]),
            { key: 'evidence', header: 'Evidence', sortable: false, render: (r) => <EvidenceChips items={r.evidence} empty="None" /> },
            { key: 'assessment', header: 'Assessment', render: (r) => (
              <div>
                <AssessmentPill value={r.assessment} />
                <div className="tiny faint" style={{ marginTop: 4 }}>{CONFIDENCE_OPTS.find((c) => c.value === r.confidence)?.label ?? r.confidence} confidence</div>
              </div>
            ) },
            { key: 'action', header: 'Action', sortable: false, className: 'act', render: (r) => <KebabButton label={`Open ${r.code}`} onClick={() => setEditing(r)} /> },
          ]}
          empty={
            rows.length ? (
              <EmptyState title="No indicators match these filters" />
            ) : (
              <EmptyState icon={<ShieldQuestion />} title={isLab1 ? 'No signs of compromise recorded' : 'No indicators recorded'} actions={<button className="btn primary" onClick={() => setEditing('new')}><Plus /> Add {isLab1 ? 'sign of compromise' : 'indicator'}</button>}>
                {isLab1
                  ? 'Record at least five possible signs of compromise from your instructor-approved evidence. For each: what you saw, why it may be suspicious, plausible benign explanations, and what you would need before calling it malicious.'
                  : 'Record meaningful indicators from the supplied PCAP, log, or host evidence. Link each one to its Evidence ID.'}
              </EmptyState>
            )
          }
        />
      )}
      <IndicatorDrawer key={editing === 'new' ? 'new' : editing?.id ?? 'none'} lab={lab} item={editing} onClose={close} />
    </Panel>
  );
}

function IndicatorDrawer({ lab, item, onClose }: { lab: 'lab1' | 'lab5'; item: Indicator | 'new' | null; onClose: () => void }) {
  const { base, eid } = useEngagement();
  const eng = useEngagementDetail();
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = item === 'new';
  const r = item && item !== 'new' ? item : null;
  const [f, setF] = useState(() => ({
    title: r?.title ?? '',
    indicator_type: r?.indicator_type ?? 'other',
    value: r?.value ?? '',
    observation: r?.observation ?? '',
    why_suspicious: r?.why_suspicious ?? '',
    benign_explanations: r?.benign_explanations ?? '',
    additional_evidence_needed: r?.additional_evidence_needed ?? '',
    confidence: r?.confidence ?? 'unrated',
    assessment: r?.assessment ?? 'unassessed',
    analyst_assessment: r?.analyst_assessment ?? '',
    source_host: r?.source_host ?? '',
    dest_host: r?.dest_host ?? '',
    observed_at: r?.observed_at_original ?? '',
    source_timezone: '',
    evidence_ids: r?.evidence.map((e) => e.id) ?? [],
  }));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v }));
  const tz = f.source_timezone || eng.data?.timezone || 'UTC';
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['indicators', eid] });
    qc.invalidateQueries({ queryKey: ['tracker', eid] });
    qc.invalidateQueries({ queryKey: ['dashboard', eid] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...f, lab, source_timezone: tz, observed_at: f.observed_at.trim() || null };
      if (!isNew) delete body.lab;
      if (!isNew && (f.observed_at || '') === (r?.observed_at_original ?? '')) { delete body.observed_at; delete body.source_timezone; }
      return isNew ? api.post(`${base}/indicators`, body) : api.patch(`${base}/indicators/${r!.id}`, body);
    },
    onSuccess: (x: any) => { invalidate(); toast.success(`${isNew ? 'Added' : 'Saved'} ${x.code}`); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del(`${base}/indicators/${r!.id}`),
    onSuccess: () => { invalidate(); toast.success(`Deleted ${r!.code}`); setConfirmDel(false); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const isLab1 = lab === 'lab1';

  return (
    <Drawer
      open={!!item}
      onClose={onClose}
      title={isNew ? (isLab1 ? 'New sign of compromise' : 'New indicator') : `${r?.code} · ${r?.title}`}
      subtitle={r ? <span className="row" style={{ gap: 8 }}><AssessmentBadge value={r.assessment} />{indicatorComplete(r) ? <span className="tiny" style={{ color: 'var(--ok)' }}>Requirement fields complete</span> : <span className="tiny faint">Requirement fields incomplete</span>}</span> : 'Record what the evidence shows, then your reasoning. Do not declare anything malicious without supporting evidence.'}
      footer={
        <>
          {r && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}><Trash2 /> Delete</button>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <span className="spinner" />} {isNew ? 'Add' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Short title" full htmlFor="in-title"><input id="in-title" value={f.title} onChange={(e) => set('title')(e.target.value)} placeholder={isLab1 ? 'e.g. Unexpected admin account' : 'e.g. Repeated authentication failures'} /></Field>
        <Field label="Type" htmlFor="in-type"><Select id="in-type" value={f.indicator_type} onChange={set('indicator_type')} options={TYPES} /></Field>
        <Field label="Value (account, IP, port, path…)" htmlFor="in-val"><input id="in-val" className="mono-input" value={f.value} onChange={(e) => set('value')(e.target.value)} /></Field>
        {!isLab1 && (
          <>
            <Field label="Source" htmlFor="in-src"><input id="in-src" className="mono-input" value={f.source_host} onChange={(e) => set('source_host')(e.target.value)} /></Field>
            <Field label="Destination" htmlFor="in-dst"><input id="in-dst" className="mono-input" value={f.dest_host} onChange={(e) => set('dest_host')(e.target.value)} /></Field>
            <Field label="Timestamp (as shown in the evidence)" htmlFor="in-ts" help="Kept verbatim. Converted to UTC only if it can be placed on the clock.">
              <input id="in-ts" className="mono-input" value={f.observed_at} onChange={(e) => set('observed_at')(e.target.value)} placeholder="2026-10-08T10:12:04-04:00" />
            </Field>
            <Field label="Timezone if the timestamp has no offset" htmlFor="in-tz"><Select id="in-tz" value={tz} onChange={set('source_timezone')} options={timezoneOptions(tz)} /></Field>
          </>
        )}
        <Field label="Observation: what the evidence shows" full htmlFor="in-obs"><textarea id="in-obs" value={f.observation} onChange={(e) => set('observation')(e.target.value)} /></Field>
        <Field label="Why it may be suspicious" full htmlFor="in-why"><textarea id="in-why" value={f.why_suspicious} onChange={(e) => set('why_suspicious')(e.target.value)} /></Field>
        <Field label="Plausible benign explanations" full htmlFor="in-ben"><textarea id="in-ben" value={f.benign_explanations} onChange={(e) => set('benign_explanations')(e.target.value)} style={{ minHeight: 60 }} /></Field>
        <Field label="Additional evidence needed before calling it malicious" full htmlFor="in-add"><textarea id="in-add" value={f.additional_evidence_needed} onChange={(e) => set('additional_evidence_needed')(e.target.value)} style={{ minHeight: 60 }} /></Field>
        <div className="full"><EvidencePicker value={f.evidence_ids} onChange={set('evidence_ids')} label="Supporting evidence" help="Command output, screenshot, or log that shows this indicator." /></div>
        <Field label="Confidence" htmlFor="in-conf"><Select id="in-conf" value={f.confidence} onChange={set('confidence')} options={CONFIDENCE_OPTS} /></Field>
        <Field label="Assessment" htmlFor="in-as">
          <Select id="in-as" value={f.assessment} onChange={set('assessment')} options={[{ value: 'unassessed', label: 'Not assessed yet' }, { value: 'suspicious', label: 'Suspicious' }, { value: 'benign', label: 'Benign' }, { value: 'requires_more_evidence', label: 'Requires additional evidence' }]} />
        </Field>
        <Field label="Analyst assessment / interpretation" full htmlFor="in-aa"><textarea id="in-aa" value={f.analyst_assessment} onChange={(e) => set('analyst_assessment')(e.target.value)} style={{ minHeight: 60 }} /></Field>
      </div>
      {f.assessment === 'suspicious' && !f.evidence_ids.length && (
        <div style={{ marginTop: 12 }}><Notice tone="warn">A “suspicious” assessment should cite at least one Evidence ID.</Notice></div>
      )}
      {r && (
        <>
          <div className="divider" />
          <KV items={[['Lab', lab === 'lab1' ? 'Lab 1: signs of compromise' : 'Lab 5: attack evidence'], ['Normalized time (UTC)', r.observed_at ? <span className="mono">{r.observed_at}</span> : '—'], ['Last updated', fmtDateTime(r.updated_at)], ['Type', humanize(r.indicator_type)]]} />
        </>
      )}
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={() => del.mutate()} busy={del.isPending} title={`Delete ${r?.code}?`} confirmLabel="Delete indicator">
        <p>The indicator and its ATT&CK mappings are removed; its code is retired. Linked evidence stays in the Evidence Locker.</p>
      </ConfirmDialog>
    </Drawer>
  );
}
