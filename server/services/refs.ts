import type { Db } from '../db/index.js';
import { parseJson } from '../db/index.js';
import type { AppConfig } from '../config.js';
import { nowIso, uid } from '../lib/codes.js';

/**
 * External reference integrations: NVD CVE API 2.0, CISA KEV catalog, MITRE ATT&CK (STIX).
 *
 * Reference data ENRICHES an assessment. It never proves that a lab asset is vulnerable
 * or compromised. No evidence or uploaded files are ever sent to these services — only
 * CVE identifiers (NVD) and plain catalog downloads (KEV, ATT&CK).
 */

export const OFFICIAL_KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
export const KEV_GITHUB_MIRROR = 'https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json';
export const REFERENCE_DISCLAIMER = 'Reference data describes the CVE in general; it does not prove this lab asset is vulnerable.';

export type RefState = 'ok' | 'not_found' | 'error' | 'rate_limited' | 'unavailable' | 'disabled' | 'not_loaded';

export interface CachedRow {
  source: string;
  ref_key: string;
  url: string;
  data: string | null;
  status: 'ok' | 'not_found' | 'error';
  error: string | null;
  origin: 'fetched' | 'imported';
  retrieved_at: string;
}

function readCache(db: Db, source: string, key: string): CachedRow | undefined {
  return db.get<CachedRow>('SELECT * FROM reference_cache WHERE source = ? AND ref_key = ?', source, key);
}

function writeCache(db: Db, source: string, key: string, row: { url: string; data: unknown; status: 'ok' | 'not_found' | 'error'; error?: string | null; origin: 'fetched' | 'imported' }) {
  db.run(
    `INSERT INTO reference_cache (id, source, ref_key, url, data, status, error, origin, retrieved_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source, ref_key) DO UPDATE SET url = excluded.url, data = excluded.data, status = excluded.status, error = excluded.error, origin = excluded.origin, retrieved_at = excluded.retrieved_at`,
    uid(), source, key, row.url, row.data === null || row.data === undefined ? null : JSON.stringify(row.data), row.status, row.error ?? null, row.origin, nowIso(),
  );
}

interface FetchOutcome {
  ok: boolean;
  status: number;
  state: RefState;
  body?: string;
  message: string;
}

async function fetchText(url: string, headers: Record<string, string> = {}, timeoutMs = 20000): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CyberDome-Command-Center/1.0 (NWIT 246 coursework)', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { ok: false, status: 0, state: 'unavailable', message: timeout ? `Request timed out after ${Math.round(timeoutMs / 1000)} s.` : 'The reference service could not be reached (network unavailable or blocked).' };
  }
  if (res.status === 429 || res.status === 403) {
    const retry = res.headers.get('retry-after');
    return {
      ok: false, status: res.status, state: 'rate_limited',
      message: `The service refused the request (HTTP ${res.status}), which usually means the public rate limit was reached${retry ? `; retry after ${retry} s` : ''}. Wait about 30 seconds or configure an API key.`,
    };
  }
  if (res.status === 404) return { ok: false, status: 404, state: 'not_found', message: 'Not found at the reference source.' };
  if (res.status >= 500) return { ok: false, status: res.status, state: 'unavailable', message: `The reference service is temporarily unavailable (HTTP ${res.status}).` };
  if (!res.ok) return { ok: false, status: res.status, state: 'error', message: `Unexpected response (HTTP ${res.status}).` };
  try {
    return { ok: true, status: res.status, state: 'ok', body: await res.text(), message: 'Retrieved.' };
  } catch {
    return { ok: false, status: res.status, state: 'unavailable', message: 'The response was interrupted before it finished downloading.' };
  }
}

/* =============================== NVD =============================== */

export interface CvssMetric {
  version: string;
  source: string;
  type: string;
  vector: string;
  base_score: number | null;
  base_severity: string | null;
}

export interface NvdCve {
  id: string;
  published: string | null;
  last_modified: string | null;
  vuln_status: string | null;
  description: string;
  metrics: CvssMetric[];
  cwes: string[];
  references: { url: string; source?: string; tags?: string[] }[];
  cisa: { exploit_add: string; action_due: string | null; required_action: string | null; vulnerability_name: string | null } | null;
}

export function parseNvdCve(cve: any): NvdCve {
  const metrics: CvssMetric[] = [];
  const m = cve?.metrics ?? {};
  for (const [key, ver] of [['cvssMetricV40', '4.0'], ['cvssMetricV31', '3.1'], ['cvssMetricV30', '3.0'], ['cvssMetricV2', '2.0']] as const) {
    for (const x of m[key] ?? []) {
      const d = x.cvssData ?? {};
      metrics.push({
        version: d.version ?? ver,
        source: x.source ?? '',
        type: x.type ?? '',
        vector: d.vectorString ?? '',
        base_score: typeof d.baseScore === 'number' ? d.baseScore : null,
        base_severity: d.baseSeverity ?? x.baseSeverity ?? null,
      });
    }
  }
  const cwes = new Set<string>();
  for (const w of cve?.weaknesses ?? []) for (const d of w.description ?? []) if (d.value && d.value !== 'NVD-CWE-noinfo' && d.value !== 'NVD-CWE-Other') cwes.add(d.value);
  return {
    id: cve?.id,
    published: cve?.published ?? null,
    last_modified: cve?.lastModified ?? null,
    vuln_status: cve?.vulnStatus ?? null,
    description: (cve?.descriptions ?? []).find((d: any) => d.lang === 'en')?.value ?? '',
    metrics,
    cwes: [...cwes],
    references: (cve?.references ?? []).slice(0, 40).map((r: any) => ({ url: r.url, source: r.source, tags: r.tags })),
    cisa: cve?.cisaExploitAdd
      ? { exploit_add: cve.cisaExploitAdd, action_due: cve.cisaActionDue ?? null, required_action: cve.cisaRequiredAction ?? null, vulnerability_name: cve.cisaVulnerabilityName ?? null }
      : null,
  };
}

export const nvdDetailUrl = (id: string) => `https://nvd.nist.gov/vuln/detail/${id}`;

function cveResponse(row: CachedRow, cached: boolean, extra: Partial<{ state: RefState; message: string; refresh_error: string }> = {}) {
  return {
    source: 'NVD CVE API 2.0',
    cve_id: row.ref_key,
    state: (extra.state ?? row.status) as RefState,
    cached,
    origin: row.origin,
    retrieved_at: row.retrieved_at,
    url: nvdDetailUrl(row.ref_key),
    api_url: row.url,
    data: row.status === 'ok' ? (parseJson<NvdCve | null>(row.data, null)) : null,
    message: extra.message ?? (row.status === 'not_found' ? 'NVD has no record for this CVE identifier.' : row.status === 'error' ? row.error ?? 'Lookup failed.' : cached ? 'Served from local cache.' : 'Retrieved from NVD.'),
    refresh_error: extra.refresh_error,
    disclaimer: REFERENCE_DISCLAIMER,
  };
}

export async function lookupCve(db: Db, cfg: AppConfig, cveId: string, opts: { refresh?: boolean; cachedOnly?: boolean } = {}) {
  const id = cveId.toUpperCase();
  const cached = readCache(db, 'nvd', id);
  const apiUrl = `${cfg.refs.nvdBase}?cveId=${encodeURIComponent(id)}`;
  if (cached && cached.status !== 'error' && !opts.refresh) return cveResponse(cached, true);
  if (opts.cachedOnly) {
    if (cached) return cveResponse(cached, true);
    return { source: 'NVD CVE API 2.0', cve_id: id, state: 'not_loaded' as RefState, cached: false, origin: null, retrieved_at: null, url: nvdDetailUrl(id), api_url: apiUrl, data: null, message: 'Not looked up yet. Only the CVE identifier is sent to NVD when you request a lookup.', disclaimer: REFERENCE_DISCLAIMER };
  }
  if (!cfg.referencesOnline) {
    if (cached) return cveResponse(cached, true, { message: 'Online lookups are disabled; showing cached data.' });
    return { source: 'NVD CVE API 2.0', cve_id: id, state: 'disabled' as RefState, cached: false, origin: null, retrieved_at: null, url: nvdDetailUrl(id), api_url: apiUrl, data: null, message: 'Online reference lookups are disabled (CYBERDOME_REFERENCES_ONLINE=false). Import a reference dataset in Settings instead.', disclaimer: REFERENCE_DISCLAIMER };
  }
  const out = await fetchText(apiUrl, cfg.nvdApiKey ? { apiKey: cfg.nvdApiKey } : {});
  if (!out.ok) {
    if (cached && cached.status === 'ok') return cveResponse(cached, true, { refresh_error: out.message, message: `Refresh failed; showing cached data. ${out.message}` });
    if (out.state === 'not_found') {
      writeCache(db, 'nvd', id, { url: apiUrl, data: null, status: 'not_found', origin: 'fetched' });
      return cveResponse(readCache(db, 'nvd', id)!, false);
    }
    return { source: 'NVD CVE API 2.0', cve_id: id, state: out.state, cached: false, origin: null, retrieved_at: null, url: nvdDetailUrl(id), api_url: apiUrl, data: null, message: out.message, http_status: out.status, disclaimer: REFERENCE_DISCLAIMER };
  }
  let body: any;
  try {
    body = JSON.parse(out.body!);
  } catch {
    return { source: 'NVD CVE API 2.0', cve_id: id, state: 'error' as RefState, cached: false, origin: null, retrieved_at: null, url: nvdDetailUrl(id), api_url: apiUrl, data: null, message: 'NVD returned a response that is not valid JSON.', disclaimer: REFERENCE_DISCLAIMER };
  }
  const vuln = (body?.vulnerabilities ?? []).find((v: any) => v?.cve?.id?.toUpperCase() === id);
  if (!vuln) {
    writeCache(db, 'nvd', id, { url: apiUrl, data: null, status: 'not_found', origin: 'fetched' });
    return cveResponse(readCache(db, 'nvd', id)!, false);
  }
  writeCache(db, 'nvd', id, { url: apiUrl, data: parseNvdCve(vuln.cve), status: 'ok', origin: 'fetched' });
  return cveResponse(readCache(db, 'nvd', id)!, false);
}

/* =============================== KEV =============================== */

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
  notes: string;
  cwes?: string[];
}

interface KevCatalog {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  url_used: string;
  vulnerabilities: KevEntry[];
}

function normalizeKev(body: any, urlUsed: string): KevCatalog {
  if (!body || !Array.isArray(body.vulnerabilities) || (body.vulnerabilities[0] && !body.vulnerabilities[0].cveID))
    throw new Error('The file is not a CISA KEV catalog (expected a “vulnerabilities” array with cveID fields).');
  const vulns: KevEntry[] = body.vulnerabilities.map((v: any) => ({
    cveID: String(v.cveID).toUpperCase(),
    vendorProject: v.vendorProject ?? '',
    product: v.product ?? '',
    vulnerabilityName: v.vulnerabilityName ?? '',
    dateAdded: v.dateAdded ?? '',
    shortDescription: v.shortDescription ?? '',
    requiredAction: v.requiredAction ?? '',
    dueDate: v.dueDate ?? '',
    knownRansomwareCampaignUse: v.knownRansomwareCampaignUse ?? '',
    notes: v.notes ?? '',
    cwes: v.cwes,
  }));
  return { title: body.title ?? 'CISA Catalog of Known Exploited Vulnerabilities', catalogVersion: body.catalogVersion ?? 'unknown', dateReleased: body.dateReleased ?? '', count: vulns.length, url_used: urlUsed, vulnerabilities: vulns };
}

let kevMemo: { at: string; map: Map<string, KevEntry>; meta: Omit<KevCatalog, 'vulnerabilities'> } | null = null;
function kevIndex(db: Db) {
  const row = readCache(db, 'kev', 'catalog');
  if (!row || row.status !== 'ok' || !row.data) return null;
  if (kevMemo && kevMemo.at === row.retrieved_at + row.origin) return { row, ...kevMemo };
  const cat = parseJson<KevCatalog | null>(row.data, null);
  if (!cat) return null;
  const { vulnerabilities, ...meta } = cat;
  kevMemo = { at: row.retrieved_at + row.origin, map: new Map(vulnerabilities.map((v) => [v.cveID, v])), meta };
  return { row, ...kevMemo };
}

export async function refreshKev(db: Db, cfg: AppConfig) {
  if (!cfg.referencesOnline) return { state: 'disabled' as RefState, message: 'Online reference lookups are disabled. Import the KEV JSON file instead.' };
  const attempts: { url: string; message: string }[] = [];
  const urls = [cfg.refs.kevUrl];
  if (cfg.refs.kevUrl === OFFICIAL_KEV_URL) urls.push(KEV_GITHUB_MIRROR);
  for (const url of urls) {
    const out = await fetchText(url, {}, 60000);
    if (!out.ok) {
      attempts.push({ url, message: out.message });
      continue;
    }
    try {
      const cat = normalizeKev(JSON.parse(out.body!), url);
      writeCache(db, 'kev', 'catalog', { url, data: cat, status: 'ok', origin: 'fetched' });
      kevMemo = null;
      return {
        state: 'ok' as RefState,
        message: `Retrieved KEV catalog version ${cat.catalogVersion} (${cat.count} entries)${url !== cfg.refs.kevUrl ? ' from the official CISA GitHub mirror because the primary URL failed' : ''}.`,
        url_used: url, attempts, catalogVersion: cat.catalogVersion, count: cat.count, retrieved_at: nowIso(),
      };
    } catch (e: any) {
      attempts.push({ url, message: e.message });
    }
  }
  const last = attempts[attempts.length - 1];
  return { state: 'unavailable' as RefState, message: `Could not retrieve the KEV catalog. ${last?.message ?? ''}`.trim(), attempts };
}

export function kevLookup(db: Db, cveId: string) {
  const id = cveId.toUpperCase();
  const idx = kevIndex(db);
  if (!idx) return { source: 'CISA KEV', cve_id: id, state: 'not_loaded' as RefState, in_kev: null, message: 'The KEV catalog has not been retrieved yet. Refresh it or import the KEV JSON file.' };
  const entry = idx.map.get(id) ?? null;
  return {
    source: 'CISA KEV',
    cve_id: id,
    state: 'ok' as RefState,
    in_kev: !!entry,
    entry,
    catalog_version: idx.meta.catalogVersion,
    retrieved_at: idx.row.retrieved_at,
    origin: idx.row.origin,
    url: idx.meta.url_used,
    catalog_url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    message: entry
      ? `Listed in KEV (added ${entry.dateAdded}). Known exploitation in the wild does not mean this lab asset is affected.`
      : `Not in KEV catalog version ${idx.meta.catalogVersion} retrieved at ${idx.row.retrieved_at}.`,
  };
}

/* ============================ ATT&CK ============================ */

export interface AttackTechnique {
  id: string;
  name: string;
  tactics: string[];
  is_subtechnique: boolean;
  url: string;
  description: string;
}
interface AttackCatalog {
  version: string;
  url_used: string;
  techniques: AttackTechnique[];
  tactics: { id: string; shortname: string; name: string }[];
}

export function parseAttackBundle(bundle: any, urlUsed: string): AttackCatalog {
  if (!bundle || bundle.type !== 'bundle' || !Array.isArray(bundle.objects)) throw new Error('The file is not a STIX bundle (expected type “bundle” with an “objects” array).');
  const techniques: AttackTechnique[] = [];
  const tactics: AttackCatalog['tactics'] = [];
  let version = '';
  for (const o of bundle.objects) {
    if (o.type === 'x-mitre-collection' && o.x_mitre_version) version = o.x_mitre_version;
    if (o.revoked || o.x_mitre_deprecated) continue;
    const ext = (o.external_references ?? []).find((r: any) => r.source_name === 'mitre-attack');
    if (o.type === 'attack-pattern' && ext?.external_id) {
      techniques.push({
        id: ext.external_id,
        name: o.name,
        tactics: (o.kill_chain_phases ?? []).filter((k: any) => k.kill_chain_name === 'mitre-attack').map((k: any) => k.phase_name),
        is_subtechnique: !!o.x_mitre_is_subtechnique,
        url: ext.url ?? `https://attack.mitre.org/techniques/${ext.external_id.replace('.', '/')}/`,
        description: String(o.description ?? '').replace(/\(Citation:[^)]*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 300),
      });
    }
    if (o.type === 'x-mitre-tactic' && ext?.external_id) tactics.push({ id: ext.external_id, shortname: o.x_mitre_shortname, name: o.name });
  }
  if (!techniques.length) throw new Error('No ATT&CK techniques (attack-pattern objects with mitre-attack IDs) were found in the bundle.');
  techniques.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { version: version || 'unknown', url_used: urlUsed, techniques, tactics };
}

let attackMemo: { at: string; cat: AttackCatalog; map: Map<string, AttackTechnique> } | null = null;

/** Cached ATT&CK techniques (or null when not loaded). Used by the AI module to validate technique IDs. */
export function getAttackTechniques(db: Db): { version: string; retrieved_at: string; origin: string; techniques: AttackTechnique[]; tactics: AttackCatalog['tactics'] } | null {
  const row = readCache(db, 'attack', 'techniques');
  if (!row || row.status !== 'ok' || !row.data) return null;
  const key = row.retrieved_at + row.origin;
  if (!attackMemo || attackMemo.at !== key) {
    const cat = parseJson<AttackCatalog | null>(row.data, null);
    if (!cat) return null;
    attackMemo = { at: key, cat, map: new Map(cat.techniques.map((t) => [t.id.toUpperCase(), t])) };
  }
  return { version: attackMemo.cat.version, retrieved_at: row.retrieved_at, origin: row.origin, techniques: attackMemo.cat.techniques, tactics: attackMemo.cat.tactics };
}

/** Look up one technique ID (e.g. T1046 or T1110.001). Returns null when unknown or not loaded. */
export function lookupTechnique(db: Db, id: string): AttackTechnique | null {
  if (!getAttackTechniques(db)) return null;
  return attackMemo!.map.get(id.trim().toUpperCase()) ?? null;
}

export async function refreshAttack(db: Db, cfg: AppConfig) {
  if (!cfg.referencesOnline) return { state: 'disabled' as RefState, message: 'Online reference lookups are disabled. Import the ATT&CK STIX bundle instead.' };
  const out = await fetchText(cfg.refs.attackUrl, {}, 180000);
  if (!out.ok) return { state: out.state, message: `Could not download ATT&CK data. ${out.message}` };
  try {
    const cat = parseAttackBundle(JSON.parse(out.body!), cfg.refs.attackUrl);
    writeCache(db, 'attack', 'techniques', { url: cfg.refs.attackUrl, data: cat, status: 'ok', origin: 'fetched' });
    attackMemo = null;
    return { state: 'ok' as RefState, message: `Loaded ATT&CK ${cat.version}: ${cat.techniques.length} techniques and sub-techniques.`, version: cat.version, count: cat.techniques.length, retrieved_at: nowIso() };
  } catch (e: any) {
    return { state: 'error' as RefState, message: `ATT&CK data could not be parsed: ${e.message}` };
  }
}

/* ============================ Offline import ============================ */

export function importReferenceDataset(db: Db, text: string, filename: string) {
  let body: any;
  try {
    body = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('Reference datasets must be JSON files.');
  }
  const label = `imported file ${filename}`;
  if (body?.type === 'bundle' && Array.isArray(body.objects)) {
    const cat = parseAttackBundle(body, label);
    writeCache(db, 'attack', 'techniques', { url: label, data: cat, status: 'ok', origin: 'imported' });
    attackMemo = null;
    return { kind: 'attack', message: `Imported ATT&CK ${cat.version}: ${cat.techniques.length} techniques.`, count: cat.techniques.length };
  }
  if (Array.isArray(body?.vulnerabilities) && body.vulnerabilities[0]?.cveID) {
    const cat = normalizeKev(body, label);
    writeCache(db, 'kev', 'catalog', { url: label, data: cat, status: 'ok', origin: 'imported' });
    kevMemo = null;
    return { kind: 'kev', message: `Imported KEV catalog version ${cat.catalogVersion} (${cat.count} entries).`, count: cat.count };
  }
  if (Array.isArray(body?.vulnerabilities) && body.vulnerabilities[0]?.cve?.id) {
    let n = 0;
    for (const v of body.vulnerabilities) {
      if (!v?.cve?.id) continue;
      writeCache(db, 'nvd', String(v.cve.id).toUpperCase(), { url: label, data: parseNvdCve(v.cve), status: 'ok', origin: 'imported' });
      n++;
    }
    return { kind: 'nvd', message: `Imported ${n} NVD CVE record(s).`, count: n };
  }
  throw new Error('Unrecognized reference dataset. Supported: NVD CVE API 2.0 JSON, CISA KEV JSON, MITRE ATT&CK STIX bundle.');
}

export function referenceStatus(db: Db, cfg: AppConfig) {
  const nvd = db.get<{ n: number; last: string | null }>("SELECT COUNT(*) n, MAX(retrieved_at) last FROM reference_cache WHERE source = 'nvd' AND status = 'ok'");
  const nvdImported = db.scalar<number>("SELECT COUNT(*) FROM reference_cache WHERE source = 'nvd' AND origin = 'imported'");
  const kev = kevIndex(db);
  const attack = getAttackTechniques(db);
  return {
    online: cfg.referencesOnline,
    nvd: { cached_records: nvd?.n ?? 0, imported_records: nvdImported, last_retrieved_at: nvd?.last ?? null, api_key: !!cfg.nvdApiKey, endpoint: cfg.refs.nvdBase, rate_limit: cfg.nvdApiKey ? '50 requests / 30 s with key' : '5 requests / 30 s without key' },
    kev: kev
      ? { state: 'ok', catalog_version: kev.meta.catalogVersion, count: kev.meta.count, retrieved_at: kev.row.retrieved_at, origin: kev.row.origin, url: kev.meta.url_used }
      : { state: 'not_loaded', primary_url: cfg.refs.kevUrl },
    attack: attack
      ? { state: 'ok', version: attack.version, count: attack.techniques.length, retrieved_at: attack.retrieved_at, origin: attack.origin, url: readCache(db, 'attack', 'techniques')?.url }
      : { state: 'not_loaded', primary_url: cfg.refs.attackUrl },
    virustotal: { state: 'not_implemented', message: 'VirusTotal lookups are not implemented. Files are never uploaded to external services.' },
    disclaimer: REFERENCE_DISCLAIMER,
  };
}
