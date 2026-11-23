import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload, Download, Radar, CheckCircle2, Circle, Bot, Trash2, FileDown, Globe, Network, Cpu, Tag, FileText, Search, Paperclip, ShieldCheck, ListChecks, HelpCircle } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import type { EvidenceBrief } from '../lib/types';
import { fmtDate, fmtDateTime, fromLocalInput, humanize, toLocalInput, download } from '../lib/format';
import { PageHeader, Panel, EmptyState, ErrorState, Loading, Notice, Field, Select, Badge, Provenance, KV, HowCalculated } from '../components/ui';
import { DataTable, matchText } from '../components/DataTable';
import { Drawer, Modal, ConfirmDialog, useToast } from '../components/overlay';
import { EvidenceChips, EvidencePicker, FileDrop } from '../components/evidence';
import { CaptureButton } from '../components/CaptureButton';
import { KpiCard, KpiRow, AssetCell, StatusPill, RowAction } from '../components/kit';
import { Donut, LegendList, PALETTE, type Segment } from '../components/charts';
import { timezoneOptions, useEngagementDetail } from './attack/shared';
import '../styles/recon.css';

interface Recon {
  id: string;
  code: string;
  category: string;
  classification: string;
  value: string;
  description: string;
  source: string;
  source_category: string;
  collected_at: string | null;
  analyst_notes: string;
  verification_status: 'unverified' | 'verified' | 'disputed';
  verified_by: string | null;
  verified_at: string | null;
  next_step: string;
  origin: string;
  evidence: EvidenceBrief[];
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABEL: Record<string, string> = { domain: 'Domain', ip_range: 'IP range', technology: 'Technology', naming_pattern: 'Naming pattern', public_info: 'Public information', osint_artifact: 'OSINT artifact', other: 'Other' };
const CATEGORIES = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }));
const catLabel = (c?: string) => (c ? CATEGORY_LABEL[c] ?? humanize(c) : '—');
const CLASSES: { id: string; label: string; hint: string }[] = [
  { id: 'asset_discovery', label: 'Asset discovery', hint: 'Hosts, ranges, domains' },
  { id: 'technology_discovery', label: 'Technology discovery', hint: 'Software, platforms, versions' },
  { id: 'identity_discovery', label: 'Identity discovery', hint: 'Naming patterns, roles, accounts' },
  { id: 'attack_surface', label: 'Attack-surface understanding', hint: 'Exposure and context' },
];
const classLabel = (c: string) => CLASSES.find((x) => x.id === c)?.label ?? humanize(c);
const CLASS_COLOR: Record<string, string> = { asset_discovery: PALETTE.green, technology_discovery: PALETTE.greenDark, identity_discovery: PALETTE.greenLight, attack_surface: PALETTE.greenDeep };
const CATEGORY_ICON: Record<string, any> = { domain: Globe, ip_range: Network, technology: Cpu, naming_pattern: Tag, public_info: FileText, osint_artifact: Search, other: HelpCircle };
const CatIcon = ({ c }: { c: string }) => { const I = CATEGORY_ICON[c] ?? HelpCircle; return <I />; };

const complete = (r: Recon) => !!(r.source.trim() && r.analyst_notes.trim() && r.next_step.trim());

function VerificationPill({ value }: { value: string }) {
  if (value === 'verified') return <StatusPill tone="ok">Verified</StatusPill>;
  if (value === 'disputed') return <StatusPill tone="bad">Disputed</StatusPill>;
  return <StatusPill tone="warn">Unverified</StatusPill>;
}

function VerificationBadge({ value }: { value: string }) {
  if (value === 'verified') return <Badge tone="ok" icon={<CheckCircle2 />}>Verified</Badge>;
  if (value === 'disputed') return <Badge tone="bad">Disputed</Badge>;
  return <Badge tone="warn" icon={<Circle />}>Unverified</Badge>;
}

export default function Recon() {
  const { base, eid, isDemo } = useEngagement();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['recon', eid], queryFn: () => api.get<Recon[]>(`${base}/recon`), enabled: !!eid });
  const tracker = useQuery({ queryKey: ['tracker', eid], queryFn: () => api.get<any>(`${base}/tracker`), enabled: !!eid });
  const [search, setSearch] = useState('');
  const [cls, setCls] = useState('');
  const [cat, setCat] = useState('');
  const [ver, setVer] = useState('');
  const [linked, setLinked] = useState('');
  const [editing, setEditing] = useState<Recon | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(params.get('import') === '1');

  const rows = q.data ?? [];
  useEffect(() => {
    const focus = params.get('focus');
    if (focus && rows.length) {
      const r = rows.find((x) => x.id === focus || x.code === focus);
      if (r) setEditing(r);
    }
  }, [params, rows]);
  useEffect(() => {
    if (params.get('import') === '1') setImportOpen(true);
  }, [params]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!cls || r.classification === cls) &&
          (!cat || r.category === cat) &&
          (!ver || r.verification_status === ver) &&
          (!linked || (linked === 'linked' ? r.evidence.length > 0 : r.evidence.length === 0)) &&
          matchText(r, search, ['code', 'value', 'description', 'source', 'analyst_notes', 'next_step', (x) => x.evidence.map((e) => e.code).join(' ')]),
      ),
    [rows, cls, cat, ver, linked, search],
  );
  const lab2 = tracker.data?.labs?.find((l: any) => l.lab === 'lab2');
  const clearFilters = () => { setSearch(''); setCls(''); setCat(''); setVer(''); setLinked(''); };
  const classSegs: Segment[] = CLASSES.map((c) => ({
    key: c.id,
    label: c.label,
    value: rows.filter((r) => r.classification === c.id).length,
    color: CLASS_COLOR[c.id],
    onClick: () => setCls(cls === c.id ? '' : c.id),
  }));
  const verified = rows.filter((r) => r.verification_status === 'verified').length;
  const disputed = rows.filter((r) => r.verification_status === 'disputed').length;
  const withEv = rows.filter((r) => r.evidence.length > 0).length;
  const completeN = rows.filter(complete).length;

  const closeDrawer = () => {
    setEditing(null);
    if (params.get('focus')) {
      const p = new URLSearchParams(params);
      p.delete('focus');
      setParams(p, { replace: true });
    }
  };
  const closeImport = () => {
    setImportOpen(false);
    if (params.get('import')) {
      const p = new URLSearchParams(params);
      p.delete('import');
      setParams(p, { replace: true });
    }
  };

  return (
    <>
      <PageHeader
        title="Recon"
        subtitle="Lab 2: organize authorized reconnaissance into a structured target profile. Every observation keeps its source, collection time, evidence links, analyst note and proposed next authorized step."
        actions={
          <>
            <CaptureButton title="Recon dashboard" />
            <button className="btn" onClick={() => download(`${base}/exports/recon.csv`)} disabled={!rows.length}>
              <Download /> Export CSV
            </button>
            <button className="btn" onClick={() => setImportOpen(true)}>
              <Upload /> Import CSV/JSON
            </button>
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus /> Add observation
            </button>
          </>
        }
      />
      <div className="stack">
        <Notice tone="info" title="Authorized targets only.">
          Record information about the fictional client and instructor-approved targets only. CyberDome performs no reconnaissance itself. It stores and organizes what your team collected.
        </Notice>

        <KpiRow>
          <KpiCard icon={<Radar />} label="Recon observations" value={rows.length} pill={{ text: `${completeN} complete`, tone: completeN >= 5 ? 'ok' : 'neutral' }} onClick={clearFilters} calc="Recon observations stored for this engagement. Pill: observations with a source, analyst note and next authorized step (Lab 2 asks for at least five)." />
          <KpiCard icon={<ShieldCheck />} label="Verified observations" value={verified} pill={disputed ? { text: `${disputed} disputed`, tone: 'bad' } : { text: `of ${rows.length}`, tone: 'neutral' }} onClick={() => { clearFilters(); setVer('verified'); }} calc="Observations a team member marked verified. Disputed ones are counted separately." />
          <KpiCard icon={<Paperclip />} label="Linked to evidence" value={withEv} pill={{ text: `${rows.length - withEv} unlinked`, tone: rows.length - withEv ? 'warn' : 'ok' }} onClick={() => { clearFilters(); setLinked('linked'); }} calc="Observations with at least one linked Evidence ID." />
          <KpiCard icon={<ListChecks />} label="Lab 2 requirements met" value={lab2 ? `${lab2.met}/${lab2.total}` : '—'} pill={lab2 ? { text: lab2.met === lab2.total ? 'Complete' : `${lab2.total - lab2.met} open`, tone: lab2.met === lab2.total ? 'ok' : 'neutral' } : null} to="/tracker" calc="Lab 2 requirements checked against stored records by the project tracker." />
        </KpiRow>

        <div className="grid span-main">
          <Panel title="Observations" hint="By Classification" actions={<HowCalculated text="Count of recon observations grouped by their classification, calculated from stored records. Click a segment or legend row to filter the table." />}>
            {q.isLoading ? (
              <Loading rows={4} />
            ) : rows.length ? (
              <div className="donut-row recon-donut">
                <Donut segments={classSegs} centerLabel={cls ? 'Filtered' : 'Total'} centerValue={cls ? classSegs.find((c) => c.key === cls)?.value ?? 0 : rows.length} size={200} ariaLabel="Recon observations by classification" />
                <div className="stack tight" style={{ flex: '1 1 220px' }}>
                  <LegendList segments={classSegs} />
                  {cls && <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCls('')}>Show all classifications</button>}
                </div>
              </div>
            ) : (
              <p className="muted small">No observations yet. The breakdown appears once observations are recorded.</p>
            )}
          </Panel>
          <Panel title="Lab 2 requirements" hint="Checked against stored records">
            {!lab2 ? (
              <Loading rows={3} />
            ) : (
              <div>
                {lab2.requirements.map((r: any) => (
                  <div className="req" key={r.id}>
                    {r.met ? <CheckCircle2 className="met" aria-label="Met" /> : <Circle className="unmet" aria-label="Not met" />}
                    <span>{r.label}</span>
                    <span className="small muted nowrap">{r.detail}</span>
                  </div>
                ))}
                <div className="row" style={{ marginTop: 10 }}>
                  <Link className="btn sm" to="/ai?task=recon_summary">
                    <Bot /> Summarize recon with AI
                  </Link>
                  <span className="tiny faint">Verify and edit the AI draft before saving it.</span>
                </div>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Recon Observations" hint={rows.length ? `${filtered.length} of ${rows.length}` : undefined} flush className="recon-obs">
          <div className="filters">
            <input type="search" placeholder="Search value, source, notes, evidence ID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search recon observations" />
            <Select ariaLabel="Classification" value={cls} onChange={setCls} placeholder="All classifications" options={CLASSES.map((c) => ({ value: c.id, label: c.label }))} />
            <Select ariaLabel="Category" value={cat} onChange={setCat} placeholder="All categories" options={CATEGORIES} />
            <Select ariaLabel="Verification" value={ver} onChange={setVer} placeholder="Any verification" options={['unverified', 'verified', 'disputed']} />
            <Select ariaLabel="Evidence links" value={linked} onChange={setLinked} placeholder="Any evidence links" options={[{ value: 'linked', label: 'Linked to evidence' }, { value: 'unlinked', label: 'No evidence linked' }]} />
            {(search || cls || cat || ver || linked) && (
              <button className="btn ghost sm" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
          {q.isError ? (
            <div style={{ padding: 16 }}><ErrorState error={q.error} retry={() => q.refetch()} /></div>
          ) : q.isLoading ? (
            <div style={{ padding: 16 }}><Loading /></div>
          ) : (
            <DataTable
              caption="Recon observations"
              rows={filtered}
              rowKey={(r) => r.id}
              onRowClick={(r) => setEditing(r)}
              initialSort={{ key: 'code', dir: 'asc' }}
              columns={[
                { key: 'code', header: 'Observation', sortValue: (r) => Number(r.code.replace(/\D/g, '')), render: (r) => (
                  <AssetCell icon={<CatIcon c={r.category} />} title={r.value} sub={`${r.code} · ${catLabel(r.category)}`} mono={['domain', 'ip_range'].includes(r.category)} />
                ) },
                { key: 'classification', header: 'Useful for', className: 'wrap-ok', render: (r) => <span>{classLabel(r.classification)}</span> },
                { key: 'source', header: 'Source', render: (r) => (
                  <div className="cell-2">
                    <div className="clip" style={{ maxWidth: '18ch' }} title={r.source}>{r.source || <span className="faint">Source missing</span>}</div>
                    <div className="tiny faint nowrap">{r.collected_at ? fmtDate(r.collected_at) : 'Collection time not recorded'}</div>
                  </div>
                ) },
                { key: 'evidence', header: 'Evidence', sortable: false, render: (r) => <EvidenceChips items={r.evidence} empty="None linked" /> },
                { key: 'verification_status', header: 'Verification', render: (r) => <VerificationPill value={r.verification_status} /> },
                { key: 'complete', header: 'Lab 2', sortValue: (r) => (complete(r) ? 1 : 0), render: (r) => (complete(r) ? <StatusPill tone="ok">Complete</StatusPill> : <span title="Needs source, analyst note and next step"><StatusPill tone="muted">Incomplete</StatusPill></span>) },
                { key: 'action', header: 'Action', sortable: false, className: 'act', render: (r) => <RowAction to={`/recon?focus=${r.id}`} label={`Open ${r.code}`} /> },
              ]}
              empty={
                rows.length ? (
                  <EmptyState title="No observations match these filters" actions={<button className="btn" onClick={clearFilters}>Clear filters</button>} />
                ) : (
                  <EmptyState
                    icon={<Radar />}
                    title="No recon observations yet"
                    actions={
                      <>
                        <button className="btn primary" onClick={() => setEditing('new')}><Plus /> Add observation</button>
                        <button className="btn" onClick={() => setImportOpen(true)}><Upload /> Import CSV/JSON</button>
                      </>
                    }
                  >
                    Add what your team learned about the authorized target. Domains, IP ranges, technologies, naming patterns, public information or instructor-provided OSINT artifacts. Lab 2 needs at least five.
                  </EmptyState>
                )
              }
            />
          )}
        </Panel>
      </div>

      <ReconDrawer key={editing === 'new' ? 'new' : editing?.id ?? 'none'} item={editing} onClose={closeDrawer} isDemo={isDemo} />
      <ReconImport open={importOpen} onClose={closeImport} />
    </>
  );
}

function ReconDrawer({ item, onClose, isDemo }: { item: Recon | 'new' | null; onClose: () => void; isDemo: boolean }) {
  const { base, eid } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = item === 'new';
  const r = item && item !== 'new' ? item : null;
  const [f, setF] = useState(() => ({
    category: r?.category ?? 'domain',
    classification: r?.classification ?? 'asset_discovery',
    value: r?.value ?? '',
    description: r?.description ?? '',
    source: r?.source ?? '',
    source_category: r?.source_category ?? (isDemo ? 'demo' : 'instructor_supplied'),
    collected_at: toLocalInput(r?.collected_at),
    analyst_notes: r?.analyst_notes ?? '',
    next_step: r?.next_step ?? '',
    evidence_ids: r?.evidence.map((e) => e.id) ?? [],
  }));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: any = { ...f, collected_at: fromLocalInput(f.collected_at) };
      if (isDemo) delete body.source_category;
      return isNew ? api.post(`${base}/recon`, body) : api.patch(`${base}/recon/${r!.id}`, body);
    },
    onSuccess: (x: any) => {
      qc.invalidateQueries({ queryKey: ['recon', eid] });
      qc.invalidateQueries({ queryKey: ['tracker', eid] });
      toast.success(isNew ? `Added ${x.code}` : `Saved ${x.code}`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const verify = useMutation({
    mutationFn: (status: string) => api.patch(`${base}/recon/${r!.id}`, { verification_status: status }),
    onSuccess: (x: any) => {
      qc.invalidateQueries({ queryKey: ['recon', eid] });
      qc.invalidateQueries({ queryKey: ['tracker', eid] });
      toast.success(`${x.code} marked ${x.verification_status}`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del(`${base}/recon/${r!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recon', eid] });
      toast.success(`Deleted ${r!.code}. The code is retired; linked evidence was kept.`);
      setConfirmDel(false);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Drawer
      open={!!item}
      onClose={onClose}
      title={isNew ? 'New recon observation' : `${r?.code} · ${catLabel(r?.category)}`}
      subtitle={r ? <span className="row" style={{ gap: 8 }}><VerificationBadge value={r.verification_status} /><Provenance kind={r.origin === 'import' ? 'imported' : 'entered'} />{r.verified_by && <span className="tiny faint">by {r.verified_by} · {fmtDateTime(r.verified_at)}</span>}</span> : 'Only fictional or instructor-approved target information.'}
      footer={
        <>
          {r && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}>
              <Trash2 /> Delete
            </button>
          )}
          {r && r.verification_status !== 'verified' && (
            <button className="btn" onClick={() => verify.mutate('verified')} disabled={verify.isPending}>
              <CheckCircle2 /> Mark verified
            </button>
          )}
          {r && r.verification_status !== 'unverified' && (
            <button className="btn ghost" onClick={() => verify.mutate('unverified')} disabled={verify.isPending}>Mark unverified</button>
          )}
          <button className="btn primary" disabled={!f.value.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <span className="spinner" />} {isNew ? 'Add observation' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Category" htmlFor="rc-cat">
          <Select id="rc-cat" value={f.category} onChange={set('category')} options={CATEGORIES} />
        </Field>
        <Field label="Useful for" htmlFor="rc-cls">
          <Select id="rc-cls" value={f.classification} onChange={set('classification')} options={CLASSES.map((c) => ({ value: c.id, label: c.label }))} />
        </Field>
        <Field label="Observation" full htmlFor="rc-val" help="The fact itself, e.g. a domain, range, technology or naming pattern.">
          <input id="rc-val" className={['domain', 'ip_range'].includes(f.category) ? 'mono-input' : ''} value={f.value} onChange={(e) => set('value')(e.target.value)} />
        </Field>
        <Field label="Description" full htmlFor="rc-desc">
          <textarea id="rc-desc" value={f.description} onChange={(e) => set('description')(e.target.value)} />
        </Field>
        <Field label="Source" htmlFor="rc-src" help="Where it came from (instructor brief, OSINT packet, …)">
          <input id="rc-src" value={f.source} onChange={(e) => set('source')(e.target.value)} />
        </Field>
        <Field label="Collected at" htmlFor="rc-col" help="Your local time; leave blank if unknown">
          <input id="rc-col" type="datetime-local" value={f.collected_at} onChange={(e) => set('collected_at')(e.target.value)} />
        </Field>
        {!isDemo && (
          <Field label="Source category" htmlFor="rc-sc">
            <Select id="rc-sc" value={f.source_category} onChange={set('source_category')} options={[{ value: 'instructor_supplied', label: 'Instructor-supplied' }, { value: 'authorized_lab', label: 'Authorized lab evidence' }, { value: 'external_reference', label: 'External reference' }]} />
          </Field>
        )}
        <Field label="Analyst note" full htmlFor="rc-note" help="How this observation could guide the assessment.">
          <textarea id="rc-note" value={f.analyst_notes} onChange={(e) => set('analyst_notes')(e.target.value)} />
        </Field>
        <Field label="Proposed next authorized step" full htmlFor="rc-next">
          <textarea id="rc-next" value={f.next_step} onChange={(e) => set('next_step')(e.target.value)} style={{ minHeight: 60 }} />
        </Field>
        <div className="full">
          <EvidencePicker value={f.evidence_ids} onChange={set('evidence_ids')} help="Link the screenshot, OSINT artifact or notes that support this observation." />
        </div>
      </div>
      {r && (
        <>
          <div className="divider" />
          <KV items={[['Created', fmtDateTime(r.created_at)], ['Last updated', fmtDateTime(r.updated_at)], ['Origin', r.origin === 'import' ? 'Structured import' : 'Manual entry']]} />
        </>
      )}
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={() => del.mutate()} busy={del.isPending} title={`Delete ${r?.code}?`} confirmLabel="Delete observation">
        <p>The observation is removed and its code is retired (never reused). Linked evidence stays in the Evidence Locker.</p>
      </ConfirmDialog>
    </Drawer>
  );
}

function ReconImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { base, eid, isDemo } = useEngagement();
  const eng = useEngagementDetail();
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [tz, setTz] = useState('');
  const [sourceCategory, setSourceCategory] = useState('instructor_supplied');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const zone = tz || eng.data?.timezone || 'UTC';
  useEffect(() => {
    if (!open) { setFile(null); setPreview(null); setResult(null); }
  }, [open]);

  const form = () => {
    const fd = new FormData();
    fd.append('file', file!);
    fd.append('source_timezone', zone);
    fd.append('source_category', isDemo ? 'demo' : sourceCategory);
    return fd;
  };
  const doPreview = useMutation({ mutationFn: () => api.upload(`${base}/recon-imports/preview`, form()), onSuccess: setPreview, onError: (e) => toast.error(errorMessage(e)) });
  const doImport = useMutation({
    mutationFn: () => api.upload(`${base}/recon-imports`, form()),
    onSuccess: (r: any) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['recon', eid] });
      qc.invalidateQueries({ queryKey: ['tracker', eid] });
      qc.invalidateQueries({ queryKey: ['evidence', eid] });
      toast.success(`Imported ${r.created} observation(s); file stored as ${r.evidence.code}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import recon observations"
      size="wide"
      footer={
        result ? (
          <button className="btn primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => download(`${base}/recon-template.csv`)}>
              <FileDown /> Download template
            </button>
            <button className="btn" disabled={!file || doPreview.isPending} onClick={() => doPreview.mutate()}>
              {doPreview.isPending && <span className="spinner" />} Preview
            </button>
            <button className="btn primary" disabled={!file || !preview?.row_count || doImport.isPending} onClick={() => doImport.mutate()}>
              {doImport.isPending && <span className="spinner" />} Import {preview?.row_count ?? ''} row{preview?.row_count === 1 ? '' : 's'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack tight">
          <Notice tone={result.status === 'complete' ? 'ok' : 'warn'} title={result.status === 'complete' ? 'Import complete.' : 'Partial import.'}>
            {result.created} observation(s) created ({result.codes[0]}{result.codes.length > 1 ? `–${result.codes.at(-1)}` : ''}). {result.rejected ? `${result.rejected} row(s) were rejected.` : ''} The file is stored as{' '}
            <Link to={`/evidence/${result.evidence.id}`} onClick={onClose}>{result.evidence.code}</Link> and linked to every imported row.
          </Notice>
          <IssueList errors={result.errors} warnings={result.warnings} />
        </div>
      ) : (
        <div className="stack">
          <FileDrop file={file} onFile={(f) => { setFile(f); setPreview(null); }} accept=".csv,.json,text/csv,application/json" label="Drop a recon CSV or JSON file, or choose one" hint="Columns: category, classification, value, description, source, collected_at, analyst_notes, next_step" />
          <div className="form-grid">
            <Field label="Timezone for times without an offset" htmlFor="ri-tz">
              <Select id="ri-tz" value={zone} onChange={(v) => { setTz(v); setPreview(null); }} options={timezoneOptions(zone)} />
            </Field>
            {!isDemo && (
              <Field label="Source category" htmlFor="ri-sc">
                <Select id="ri-sc" value={sourceCategory} onChange={setSourceCategory} options={[{ value: 'instructor_supplied', label: 'Instructor-supplied' }, { value: 'authorized_lab', label: 'Authorized lab evidence' }]} />
              </Field>
            )}
          </div>
          {preview && (
            <div className="stack tight">
              <Notice tone={preview.errors.length ? 'warn' : 'ok'}>
                {preview.format.toUpperCase()} file: {preview.total} record(s), <strong>{preview.row_count} valid</strong>
                {preview.errors.length ? `, ${preview.errors.length} will be rejected` : ''}. Nothing has been saved yet.
              </Notice>
              <IssueList errors={preview.errors} warnings={preview.warnings} />
              {preview.rows.length > 0 && (
                <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                  <table className="data">
                    <caption className="sr-only">Import preview</caption>
                    <thead><tr><th>Row</th><th>Category</th><th>Useful for</th><th>Value</th><th>Source</th><th>Collected (UTC)</th></tr></thead>
                    <tbody>
                      {preview.rows.map((r: any) => (
                        <tr key={r.row}>
                          <td className="mono">{r.row}</td>
                          <td className="small">{catLabel(r.category)}</td>
                          <td className="small">{classLabel(r.classification)}</td>
                          <td className="clip" style={{ maxWidth: '36ch' }}>{r.value}</td>
                          <td className="small">{r.source || '—'}</td>
                          <td className="mono small">{r.collected_at ?? (r.collected_at_original ? `not placeable (“${r.collected_at_original}”)` : '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function IssueList({ errors, warnings }: { errors: { row: number; message: string }[]; warnings: string[] }) {
  if (!errors?.length && !warnings?.length) return null;
  return (
    <div className="issue-list">
      {errors?.length > 0 && (
        <details open={errors.length <= 8}>
          <summary className="small"><strong>{errors.length} rejected row{errors.length === 1 ? '' : 's'}</strong></summary>
          <ul className="small">
            {errors.slice(0, 100).map((e, i) => (
              <li key={i}><span className="mono">{e.row ? `Row ${e.row}` : 'File'}</span>: {e.message}</li>
            ))}
          </ul>
        </details>
      )}
      {warnings?.length > 0 && (
        <details open={warnings.length <= 5}>
          <summary className="small"><strong>{warnings.length} warning{warnings.length === 1 ? '' : 's'}</strong></summary>
          <ul className="small">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
