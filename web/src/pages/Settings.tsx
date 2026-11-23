import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Bot, Globe, Cpu, Download, FlaskConical, Plus, Trash2, Save, RefreshCw, HardDrive, UserRound, Briefcase, PlugZap, Radar } from 'lucide-react';
import { api, ApiError, errorMessage, PREVIEW } from '../lib/api';
import { useEngagement } from '../lib/engagement';
import type { StatusInfo } from '../lib/types';
import { PageHeader, Panel, Field, Notice, KV, Loading, ErrorState, Mono } from '../components/ui';
import { KpiCard, KpiRow, AssetCell, StatusPill } from '../components/kit';
import { ConfirmDialog, Modal, useToast } from '../components/overlay';
import { fmtDateTime } from '../lib/format';
import '../styles/settings.css';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';
const STATE: Record<string, [Tone, string]> = {
  connected: ['ok', 'Connected'],
  configured: ['ok', 'Configured'],
  not_configured: ['muted', 'Not configured'],
  misconfigured: ['bad', 'Misconfigured'],
  error: ['bad', 'Error'],
  ok: ['ok', 'OK'],
  not_found: ['warn', 'Not found'],
};
const kpiTone = (t: Tone) => (t === 'ok' ? 'ok' : t === 'bad' ? 'bad' : t === 'warn' ? 'warn' : 'neutral') as 'ok' | 'bad' | 'warn' | 'neutral';

function PanelIcon({ children }: { children: React.ReactNode }) {
  return <span className="panel-ic" aria-hidden>{children}</span>;
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, [Tone, string]> = {
    connected: ['ok', 'Connected'],
    configured: ['ok', 'Configured'],
    not_configured: ['muted', 'Not configured'],
    misconfigured: ['bad', 'Misconfigured'],
    error: ['bad', 'Error'],
    ok: ['ok', 'OK'],
    not_found: ['warn', 'Not found'],
  };
  const [tone, label] = map[state] ?? ['muted', state];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

function RefRow({ name, row }: { name: string; row: any }) {
  if (!row) return <><dt>{name}</dt><dd className="faint">Never retrieved in this installation</dd></>;
  return (
    <>
      <dt>{name}</dt>
      <dd>
        <span className="row" style={{ gap: 6 }}>
          <StateBadge state={row.status} />
          <StatusPill tone={row.origin === 'imported' ? 'muted' : 'info'}>{row.origin === 'imported' ? 'Imported file' : 'Retrieved online'}</StatusPill>
          <span className="small muted">{fmtDateTime(row.retrieved_at)}</span>
          <span className="tiny faint mono">{row.ref_key}</span>
        </span>
        {row.error && <div className="small" style={{ color: '#ff9aac' }}>{row.error}</div>}
      </dd>
    </>
  );
}

function AnalystName() {
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, string>>('/api/settings') });
  const [name, setName] = useState('');
  useEffect(() => setName(s.data?.analyst_name ?? ''), [s.data]);
  const m = useMutation({
    mutationFn: () => api.put('/api/settings', { analyst_name: name.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Analyst name saved.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Analyst identity" actions={<PanelIcon><UserRound /></PanelIcon>}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="field">
        <label htmlFor="analyst-name">Your name</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input id="analyst-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Jordan Lee" />
          <button className="btn primary" type="submit" disabled={m.isPending || name === (s.data?.analyst_name ?? '')}><Save /> Save</button>
        </div>
        <span className="help">Recorded on activity, evidence reviews, AI reviews, and sign-offs.</span>
      </form>
      <p className="small faint" style={{ marginTop: 10, marginBottom: 0 }}>
        This is a local single-user application without login, so this name is self-declared. It identifies who performed an action on this computer; it is not authentication.
      </p>
    </Panel>
  );
}

function Connections() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['status'], queryFn: () => api.get<StatusInfo>('/api/status') });
  const refresh = useMutation({
    mutationFn: (which: 'kev' | 'attack') => api.post(`/api/references/${which}/refresh`),
    onSuccess: (_d, which) => { qc.invalidateQueries({ queryKey: ['status'] }); toast.success(which === 'kev' ? 'CISA KEV catalog refreshed.' : 'MITRE ATT&CK techniques refreshed.'); },
    onError: (e) => { qc.invalidateQueries({ queryKey: ['status'] }); toast.error(e instanceof ApiError && e.status === 404 ? 'Reference refresh is not available on this server.' : errorMessage(e)); },
  });
  if (q.isLoading) return <Loading rows={4} />;
  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const s = q.data!;
  const go = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const [dbTone, dbLabel] = STATE[s.database.state] ?? ['muted', s.database.state];
  const [aiTone, aiLabel] = STATE[s.ai.state] ?? ['muted', s.ai.state];
  const loadedRefs = [s.references.nvd, s.references.kev, s.references.attack].filter((r) => r && r.status === 'ok').length;
  return (
    <>
      <KpiRow>
        <KpiCard icon={<Database />} label="Database schema" value={s.database.schemaVersion ? `v${s.database.schemaVersion}` : '—'} pill={{ text: dbLabel, tone: kpiTone(dbTone) }} onClick={go('set-db')} calc="Live check: the server ran a query against the SQLite database when this page loaded." />
        <KpiCard icon={<Bot />} label="AI provider" value={s.ai.provider === 'none' ? 'None' : s.ai.provider === 'openai' ? 'OpenAI-compatible' : s.ai.provider[0].toUpperCase() + s.ai.provider.slice(1)} pill={{ text: aiLabel, tone: kpiTone(aiTone) }} onClick={go('set-ai')} calc="Live server configuration (saved in Settings, or from .env). Keys stay on the server and are never sent back to the browser." />
        <KpiCard icon={<Globe />} label="Reference sources cached" value={`${loadedRefs}/3`} pill={{ text: s.references.online ? 'Lookups enabled' : 'Lookups disabled', tone: s.references.online ? 'ok' : 'neutral' }} onClick={go('set-refs')} calc="NVD, CISA KEV, and MITRE ATT&CK entries whose most recent cached retrieval succeeded." />
        <KpiCard icon={<Cpu />} label="Packet analysis (tshark)" value={s.tshark.available ? 'Available' : 'Not found'} pill={{ text: s.tshark.available ? 'On PATH' : 'Headers only', tone: s.tshark.available ? 'ok' : 'neutral' }} onClick={go('set-tshark')} calc="The server tried to run tshark --version. Without tshark, PCAPs are stored and only their headers are read." />
      </KpiRow>
      <div className="grid cols-2">
        <Panel id="set-db" title="Database" actions={<PanelIcon><Database /></PanelIcon>}>
          <KV items={[
            ['State', <StateBadge state={s.database.state} />],
            ['Schema version', s.database.schemaVersion ?? '—'],
            ['File', <Mono>{s.database.file ?? '—'}</Mono>],
            ['Mode', 'Local single-user · no login'],
            ['Bound to', <span className="row" style={{ gap: 8 }}><Mono>{s.bind}</Mono> {/^(127\.|localhost|::1)/.test(s.bind) ? <StatusPill tone="ok">Loopback only</StatusPill> : <StatusPill tone="bad">Not loopback</StatusPill>}</span>],
            ['Upload limit', `${s.maxUploadMb} MB per file`],
            ['Server time', fmtDateTime(s.serverTime)],
          ]} />
        </Panel>
        <Panel id="set-ai" title="AI provider" actions={<PanelIcon><Bot /></PanelIcon>}>
          <KV items={[
            ['State', <StateBadge state={s.ai.state} />],
            ['Provider', s.ai.provider],
            ['Model', s.ai.model ? <Mono>{s.ai.model}</Mono> : '—'],
            ['Endpoint', s.ai.endpoint ? <Mono>{s.ai.endpoint}</Mono> : '—'],
          ]} />
          {s.ai.message && s.ai.state !== 'not_configured' && <div style={{ marginTop: 10 }}><Notice tone={s.ai.state === 'misconfigured' ? 'bad' : 'info'}>{s.ai.message}</Notice></div>}
          <AiForm />
        </Panel>
        <UpdatesPanel />
        <Panel
          id="set-refs"
          title="External references"
          actions={
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm" disabled={!s.references.online || refresh.isPending} onClick={() => refresh.mutate('kev')}><RefreshCw /> KEV</button>
              <button className="btn sm" disabled={!s.references.online || refresh.isPending} onClick={() => refresh.mutate('attack')}><RefreshCw /> ATT&CK</button>
            </div>
          }
        >
          <KV items={[
            ['Online lookups', s.references.online ? <StatusPill tone="ok">Enabled</StatusPill> : <StatusPill tone="muted">Disabled (CYBERDOME_REFERENCES_ONLINE=false)</StatusPill>],
            ['NVD API key', s.references.nvdApiKey ? <StatusPill tone="ok">Present (server)</StatusPill> : <StatusPill tone="muted">None: public rate limits apply</StatusPill>],
          ]} />
          <dl className="kv" style={{ marginTop: 10 }}>
            <RefRow name="NVD (CVE)" row={s.references.nvd} />
            <RefRow name="CISA KEV" row={s.references.kev} />
            <RefRow name="MITRE ATT&CK" row={s.references.attack} />
          </dl>
          <p className="small faint" style={{ marginTop: 10, marginBottom: 0 }}>
            Reference data enriches findings; it never proves a lab asset is vulnerable. Uploaded evidence is never sent to these services. If you are offline, import reference files on the Vulnerabilities page instead.
          </p>
        </Panel>
        <Panel id="set-tshark" title="Packet analysis (tshark)" actions={<PanelIcon><Cpu /></PanelIcon>}>
          <KV items={[
            ['tshark', s.tshark.available ? <StatusPill tone="ok">Available</StatusPill> : <StatusPill tone="muted">Not found on PATH</StatusPill>],
            ['Version', s.tshark.version ?? '—'],
          ]} />
          <p className="small faint" style={{ marginTop: 10, marginBottom: 0 }}>
            Without tshark, PCAP files are stored and their headers read (packet count, time range). No packet analysis is claimed. Import a Wireshark/tshark CSV or JSON export for event-level analysis. Set <code>CYBERDOME_TSHARK_PATH</code> if tshark is installed in a non-standard location.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Engagements() {
  const { engagements, current, setEngagement } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/engagements', { name: name.trim() }),
    onSuccess: (e) => { qc.invalidateQueries({ queryKey: ['engagements'] }); setEngagement(e.id); setCreating(false); setName(''); toast.success('Engagement created and selected.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (e: { id: string; name: string }) => api.del(`/api/engagements/${e.id}`, { confirm: e.name }),
    onSuccess: () => { qc.invalidateQueries(); setDel(null); toast.success('Engagement deleted.'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Engagements" flush actions={<button className="btn sm" onClick={() => setCreating(true)}><Plus /> New engagement</button>}>
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">Engagements</caption>
          <thead><tr><th>Engagement</th><th>Type</th><th>Selected</th><th className="act">Action</th></tr></thead>
          <tbody>
            {engagements.map((e) => (
              <tr key={e.id}>
                <td><AssetCell icon={e.is_demo ? <FlaskConical /> : <Briefcase />} title={e.name} sub={`${e.client_name} · created ${fmtDateTime(e.created_at)}`} /></td>
                <td className="nowrap">{e.is_demo ? <StatusPill tone="muted">Demo data</StatusPill> : <StatusPill tone="info">Real engagement</StatusPill>}</td>
                <td className="nowrap">{e.id === current?.id ? <span className="small" style={{ color: 'var(--accent-strong)' }}>Current</span> : <button className="btn sm" onClick={() => setEngagement(e.id)}>Select</button>}</td>
                <td className="act nowrap">
                  <button className="kebab" aria-label={`Delete ${e.name}`} title="Delete" onClick={() => setDel({ id: e.id, name: e.name })}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New engagement" size="narrow" footer={<><button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create</button></>}>
        <Field label="Engagement name" htmlFor="new-eng"><input id="new-eng" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <p className="small faint" style={{ marginTop: 8 }}>The new engagement starts empty.</p>
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete engagement" confirmLabel="Delete permanently" requireText={del?.name} busy={remove.isPending} onConfirm={() => del && remove.mutate(del)}>
        <Notice tone="bad">This permanently deletes every record in the engagement (findings, assets, timeline, AI sessions, links). Download a backup first. The last real engagement cannot be deleted.</Notice>
      </ConfirmDialog>
    </Panel>
  );
}

function DemoData() {
  const { engagements, setEngagement } = useEngagement();
  const qc = useQueryClient();
  const toast = useToast();
  const demo = engagements.find((e) => e.is_demo);
  const [confirm, setConfirm] = useState(false);
  const load = useMutation({
    mutationFn: () => api.post<{ id?: string; engagement_id?: string }>('/api/demo/load'),
    onSuccess: (r) => { qc.invalidateQueries(); const id = r?.engagement_id ?? r?.id; if (id) setEngagement(id); toast.success('Demo engagement loaded. A “Demo Data” banner shows whenever it is selected.'); },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 404 ? 'Demo loading is not available on this server build.' : errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del('/api/demo', { confirm: true }),
    onSuccess: () => { qc.invalidateQueries(); setConfirm(false); toast.success('Demo engagement removed.'); },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 404 ? 'Demo removal is not available on this server build.' : errorMessage(e)),
  });
  return (
    <Panel title="Demo data" actions={<PanelIcon><FlaskConical style={{ color: 'var(--demo)' }} /></PanelIcon>}>
      <p className="small">
        The demo engagement is a separate, clearly labeled synthetic dataset for practicing the interface. It lives in its own engagement, uses <code>DEMO-</code> prefixed IDs, can never receive real evidence, and is never mixed into your real assessment, metrics, or reports.
      </p>
      <div className="row">
        {demo ? (
          <>
            <StatusPill tone="ok">Demo loaded</StatusPill>
            <button className="btn" onClick={() => setEngagement(demo.id)}>Switch to demo</button>
            <button className="btn danger" onClick={() => setConfirm(true)}><Trash2 /> Remove demo engagement</button>
          </>
        ) : (
          <button className="btn primary" onClick={() => load.mutate()} disabled={load.isPending}>{load.isPending ? <span className="spinner" /> : <FlaskConical />} Load demo engagement</button>
        )}
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Remove demo engagement" confirmLabel="Remove demo" busy={remove.isPending} onConfirm={() => remove.mutate()}>
        <p>Deletes the synthetic demo engagement and its records. Your real engagement is not affected.</p>
      </ConfirmDialog>
    </Panel>
  );
}

function Backup() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/backup');
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Backup failed (${res.status})`);
      const blob = await res.blob();
      const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'cyberdome-backup.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`Backup downloaded (${res.headers.get('x-backup-files') ?? '?'} files).`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Backup and restore" actions={<PanelIcon><HardDrive /></PanelIcon>}>
      <p className="small">
        A backup is a .zip with a consistent database snapshot, every evidence file, and a <code>manifest.json</code> listing each file’s SHA-256. It is safe to create while the app is running.
      </p>
      <button className="btn primary" onClick={run} disabled={busy}>{busy ? <span className="spinner" /> : <Download />} Download backup</button>
      <div className="divider" />
      <h3 style={{ fontSize: '0.96rem', marginBottom: 6 }}>Restore (command line only)</h3>
      <ol className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
        <li>Stop the server (Ctrl+C).</li>
        <li>Run <code>npm run restore -- path/to/cyberdome-backup.zip</code></li>
        <li>The script verifies every hash, moves the current data folder to <code>data.before-restore-&lt;time&gt;</code>, and writes the backup. Nothing is deleted.</li>
        <li>Start the app again with <code>npm start</code>.</li>
      </ol>
      <p className="small faint" style={{ marginTop: 8, marginBottom: 0 }}>Restore is deliberately not available from the browser so a web page can never overwrite your data. Command-line backups: <code>npm run backup</code> (written to <code>./backups/</code>). See docs/BACKUP_RESTORE.md.</p>
    </Panel>
  );
}

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Identity, connections, engagements, demo data, and backups for this local installation." />
      <div className="stack settings">
        <Connections />
        <div className="grid cols-2">
          <AnalystName />
          <DemoData />
        </div>
        <Engagements />
        <Backup />
        <Panel title="About external connections" actions={<PanelIcon><Globe /></PanelIcon>}>
          <p className="small" style={{ margin: 0 }}>
            The database, evidence files, and this interface stay on this computer. Outbound requests happen only for (1) AI requests you start, containing the context you previewed, and (2) reference lookups (NVD, CISA KEV, MITRE ATT&CK) containing only public identifiers such as CVE IDs.
          </p>
        </Panel>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ AI provider form */
interface AiSettings {
  provider: 'none' | 'anthropic' | 'openai';
  anthropic_model: string;
  openai_model: string;
  openai_base_url: string;
  anthropic_key_set: boolean;
  openai_key_set: boolean;
  source: 'settings' | 'env' | 'none';
  updated_at: string | null;
}

const PRESETS: Record<string, { label: string; provider: 'anthropic' | 'openai'; base?: string; model: string; needsKey: boolean }> = {
  anthropic: { label: 'Anthropic (Claude)', provider: 'anthropic', model: 'claude-sonnet-5-5', needsKey: true },
  openai: { label: 'OpenAI', provider: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true },
  ollama: { label: 'Ollama on this computer (free, offline)', provider: 'openai', base: 'http://localhost:11434/v1', model: 'llama3.1', needsKey: false },
  custom: { label: 'Other OpenAI-compatible server', provider: 'openai', model: '', needsKey: false },
};

function presetFor(a: AiSettings): string {
  if (a.provider === 'anthropic') return 'anthropic';
  if (a.provider === 'openai') return /localhost:11434|127\.0\.0\.1:11434/.test(a.openai_base_url) ? 'ollama' : /api\.openai\.com/.test(a.openai_base_url) ? 'openai' : 'custom';
  return 'anthropic';
}

function AiForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AiSettings>('/api/settings/ai') });
  const [preset, setPreset] = useState('anthropic');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [base, setBase] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'off'>('');
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!q.data) return;
    const p = presetFor(q.data);
    setPreset(p);
    setModel(q.data.provider === 'anthropic' ? q.data.anthropic_model : q.data.provider === 'openai' ? q.data.openai_model : PRESETS[p].model);
    setBase(q.data.provider === 'openai' ? q.data.openai_base_url : PRESETS[p].base ?? '');
  }, [q.data]);

  if (q.isLoading) return <Loading rows={2} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const a = q.data!;
  const P = PRESETS[preset];
  const keySet = P.provider === 'anthropic' ? a.anthropic_key_set : a.openai_key_set;
  const choose = (p: string) => {
    setPreset(p);
    setModel(PRESETS[p].model);
    setBase(PRESETS[p].base ?? '');
    setTest(null);
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-settings'] });
    qc.invalidateQueries({ queryKey: ['status'] });
  };
  const save = async (provider: 'none' | 'anthropic' | 'openai', extra: Record<string, unknown> = {}) => {
    setBusy(provider === 'none' ? 'off' : 'save');
    setTest(null);
    try {
      await api.put('/api/settings/ai', { provider, ...extra });
      setKey('');
      refresh();
      toast.success(provider === 'none' ? 'AI provider turned off.' : 'AI provider saved on the server.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  const runTest = async () => {
    setBusy('test');
    try {
      const r = await api.post<{ model: string; latency_ms: number; reply: string }>('/api/settings/ai/test');
      setTest({ ok: true, text: `Connected to ${r.model} in ${(r.latency_ms / 1000).toFixed(1)} s.` });
    } catch (e) {
      setTest({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy('');
    }
  };
  const canSave = !PREVIEW && (!P.needsKey || keySet || key.trim()) && model.trim() && (P.provider === 'anthropic' || base.trim());

  return (
    <div className="ai-form stack tight" style={{ marginTop: 14 }}>
      <Field label="Provider" htmlFor="ai-preset">
        <select id="ai-preset" value={preset} onChange={(e) => choose(e.target.value)}>
          {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      {P.provider === 'openai' && (
        <Field label="Base URL" htmlFor="ai-base"><input id="ai-base" className="mono-input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.openai.com/v1" /></Field>
      )}
      <Field label="Model" htmlFor="ai-model"><input id="ai-model" className="mono-input" value={model} onChange={(e) => setModel(e.target.value)} /></Field>
      <Field
        label={P.needsKey ? 'API key' : 'API key (optional)'}
        htmlFor="ai-key"
        help={keySet ? 'A key is saved on the server. Leave blank to keep it, or paste a new one to replace it.' : 'Stored only on this computer in data/ai-settings.json. It is never shown again or sent back to the browser.'}
      >
        <input id="ai-key" type="password" className="mono-input" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={keySet ? '•••••••• saved' : P.needsKey ? 'Paste your key' : 'Not needed for Ollama'} />
      </Field>
      {preset === 'ollama' && <p className="small faint">Install Ollama from ollama.com, run <code>ollama pull llama3.1</code>, and keep it open. Nothing leaves this computer.</p>}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn primary" disabled={!canSave || !!busy} onClick={() => save(P.provider, { api_key: key.trim() || undefined, model: model.trim(), base_url: P.provider === 'openai' ? base.trim() : undefined })}>
          <Save /> {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className="btn ghost" disabled={a.provider === 'none' || !!busy || PREVIEW} onClick={runTest}>
          <PlugZap /> {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        {keySet && <button className="btn ghost" disabled={!!busy || PREVIEW} onClick={() => save(P.provider, { clear_key: true, model: model.trim() || undefined })}>Remove key</button>}
        {a.provider !== 'none' && <button className="btn ghost" disabled={!!busy || PREVIEW} onClick={() => save('none')}>Turn off</button>}
      </div>
      {test && <Notice tone={test.ok ? 'ok' : 'bad'}>{test.text}</Notice>}
      <p className="small faint">
        The connection test sends one fixed sentence and no engagement data. During analysis only sanitized evidence you select is sent, after you see the exact context.
        {a.source === 'env' && ' The current values come from the .env file; saving here overrides them.'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ Desktop updates */
interface DesktopBridge {
  updateStatus: () => Promise<{ version: string; feed: string; autoCheck?: boolean; lastCheck?: string; skippedVersion?: string }>;
  checkForUpdates: () => Promise<void>;
  setAutoUpdate: (on: boolean) => Promise<unknown>;
}

function UpdatesPanel() {
  const bridge = (window as unknown as { cyberdomeDesktop?: DesktopBridge }).cyberdomeDesktop;
  const [st, setSt] = useState<Awaited<ReturnType<DesktopBridge['updateStatus']>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    bridge?.updateStatus().then(setSt).catch(() => setSt(null));
  }, [bridge]);
  if (!bridge) return null;
  const refresh = () => bridge.updateStatus().then(setSt);
  return (
    <Panel id="set-updates" title="Updates" actions={<PanelIcon><RefreshCw /></PanelIcon>}>
      <KV items={[
        ['Installed version', st ? <Mono>{st.version}</Mono> : '…'],
        ['Last checked', st?.lastCheck ? fmtDateTime(st.lastCheck) : 'Not yet'],
        ...(st?.skippedVersion ? [['Skipped version', <Mono>{st.skippedVersion}</Mono>] as [string, React.ReactNode]] : []),
      ]} />
      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await bridge.checkForUpdates(); } finally { setBusy(false); refresh(); } }}>
          <RefreshCw /> {busy ? 'Checking…' : 'Check for updates'}
        </button>
        <label className="check-row" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={st?.autoCheck !== false} onChange={async (e) => { await bridge.setAutoUpdate(e.target.checked); refresh(); }} />
          <span>Check automatically</span>
        </label>
      </div>
      <p className="small faint" style={{ marginBottom: 0 }}>
        When a new version is published you can update, be reminded later, or skip that version. The check downloads a small public file and sends nothing about your assessment.
      </p>
    </Panel>
  );
}
