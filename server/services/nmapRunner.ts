import { execFile, execFileSync, type ChildProcess } from 'node:child_process';
import dns from 'node:dns/promises';
import type { Ctx } from '../app.js';
import type { Row } from '../db/index.js';
import { parseJson } from '../db/index.js';
import { badRequest, HttpError } from '../lib/http.js';
import { nextCode, nowIso, uid } from '../lib/codes.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { checkScope, isIPv4 } from '../lib/scope.js';
import { commitScan } from '../importers/scanImport.js';

/**
 * Local Nmap execution, restricted to the engagement's authorized scope.
 *
 * Safety model (enforced here on the server, not in the browser):
 *  - The engagement must be real (not demo).
 *  - Every address is expanded server-side and checked against the scope list. Each must
 *    match an authorized (in-scope) entry; exclusions always win and are dropped. A private
 *    address is never assumed to be authorized.
 *  - Arguments come from a fixed profile table. The only variable arguments are validated
 *    IPv4 addresses. execFile is used (no shell). Output is XML on stdout.
 *  - One scan at a time, a host cap, and a hard time limit.
 */

export const NMAP_PROFILES = {
  discovery: {
    label: 'Host discovery',
    description: 'Finds which in-scope addresses respond. No port scan.',
    args: ['-sn'],
  },
  quick: {
    label: 'Quick service scan',
    description: 'TCP connect scan of the 100 most common ports with light version detection.',
    args: ['-sT', '-sV', '--version-light', '--top-ports', '100'],
  },
  standard: {
    label: 'Standard service scan',
    description: 'TCP connect scan of the 1,000 most common ports with version detection (the classic nmap -sV).',
    args: ['-sT', '-sV', '--top-ports', '1000'],
  },
} as const;
export type NmapProfile = keyof typeof NMAP_PROFILES;

const COMMON_ARGS = ['-n', '-T3', '--max-retries', '2', '--host-timeout', '10m', '--reason', '--stats-every', '5s', '-oX', '-'];
export const NMAP_LIMITS = { maxHosts: 256, timeoutMs: 30 * 60_000, maxBufferBytes: 32 * 1024 * 1024 };

// ---------- binary detection ----------
let cache: { checked: number; path: string | null; version: string | null } | null = null;
export function nmapInfo(ctx: Ctx, fresh = false) {
  if (!fresh && cache && Date.now() - cache.checked < 60_000) return cache;
  const candidates = [ctx.cfg.nmapPath, 'nmap'];
  if (process.platform === 'win32') candidates.push('C:\\Program Files (x86)\\Nmap\\nmap.exe', 'C:\\Program Files\\Nmap\\nmap.exe');
  for (const bin of candidates.filter(Boolean) as string[]) {
    try {
      const out = execFileSync(bin, ['--version'], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const version = out.split('\n')[0].trim();
      if (/nmap/i.test(version)) {
        cache = { checked: Date.now(), path: bin, version };
        return cache;
      }
    } catch {
      /* try the next candidate */
    }
  }
  cache = { checked: Date.now(), path: null, version: null };
  return cache;
}

// ---------- target expansion ----------
const ipToInt = (ip: string) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const intToIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');

function unusable(ip: string): string | null {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0) return 'is in 0.0.0.0/8 (not a host address)';
  if (a >= 224) return 'is a multicast or reserved address';
  if (a === 255 && b === 255) return 'is a broadcast address';
  return null;
}

/** Expand an IPv4 address, CIDR (/23 or smaller), or range into individual addresses. */
export function expandIPv4(target: string): string[] | null {
  const t = target.trim();
  if (isIPv4(t)) return [t];
  const cidr = t.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
  if (cidr && isIPv4(cidr[1])) {
    const bits = Number(cidr[2]);
    if (bits > 32) return null;
    const size = 2 ** (32 - bits);
    if (size > NMAP_LIMITS.maxHosts * 2) throw badRequest(`${t} contains ${size.toLocaleString()} addresses. Scans are limited to ${NMAP_LIMITS.maxHosts} hosts; use a smaller range.`);
    const base = Math.floor(ipToInt(cidr[1]) / size) * size;
    const out: string[] = [];
    for (let i = 0; i < size; i++) {
      // Skip network and broadcast addresses for normal subnets.
      if (bits < 31 && (i === 0 || i === size - 1)) continue;
      out.push(intToIp(base + i));
    }
    return out;
  }
  const range = t.match(/^(\d+\.\d+\.\d+\.\d+)\s*-\s*(\d+(?:\.\d+\.\d+\.\d+)?)$/);
  if (range && isIPv4(range[1])) {
    const endRaw = range[2].includes('.') ? range[2] : range[1].split('.').slice(0, 3).join('.') + '.' + range[2];
    if (!isIPv4(endRaw)) return null;
    const s = ipToInt(range[1]);
    const e = ipToInt(endRaw);
    if (e < s) throw badRequest(`Range ${t} ends before it starts.`);
    if (e - s + 1 > NMAP_LIMITS.maxHosts) throw badRequest(`${t} contains ${e - s + 1} addresses. Scans are limited to ${NMAP_LIMITS.maxHosts} hosts.`);
    const out: string[] = [];
    for (let i = s; i <= e; i++) out.push(intToIp(i));
    return out;
  }
  return null;
}

export interface ScanPlan {
  ok: boolean;
  profile: NmapProfile;
  target_input: string;
  addresses: { ip: string; hostname: string | null; matched: string }[];
  excluded: { ip: string; matched: string }[];
  refused: { ip: string; reason: string }[];
  blockers: string[];
  warnings: string[];
  args: string[];
  command: string;
  nmap: { available: boolean; version: string | null };
}

/** Build and validate a scan plan. Never executes anything. */
export async function planScan(ctx: Ctx, eng: Row, targetInput: string, profile: NmapProfile, skipDiscovery: boolean): Promise<ScanPlan> {
  const { db } = ctx;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const addresses: ScanPlan['addresses'] = [];
  const excluded: ScanPlan['excluded'] = [];
  const refused: ScanPlan['refused'] = [];
  const target = String(targetInput ?? '').trim();
  const info = nmapInfo(ctx);

  if (!(profile in NMAP_PROFILES)) throw badRequest('Unknown scan profile.');
  if (eng.is_demo) blockers.push('Scans cannot be run in the demo engagement. Switch to your real engagement.');
  if (!info.path) blockers.push('Nmap was not found on this computer. Install it from nmap.org (include Npcap on Windows), then restart CyberDome.');
  if (!target) blockers.push('Enter a target.');
  if (target.length > 200 || /[\s,;|&`$<>]/.test(target.replace(/\s*-\s*/, '-'))) blockers.push('Enter one address, CIDR block, range, or hostname at a time.');

  if (target && !blockers.some((b) => b.startsWith('Enter'))) {
    let candidates: { ip: string; hostname: string | null }[] = [];
    const expanded = expandIPv4(target);
    if (expanded) candidates = expanded.map((ip) => ({ ip, hostname: null }));
    else if (/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,62})(\.[a-z0-9]([a-z0-9-]{0,62}))*\.?$/i.test(target)) {
      try {
        const res = await dns.lookup(target, { all: true, family: 4 });
        candidates = [...new Set(res.map((r) => r.address))].map((ip) => ({ ip, hostname: target.toLowerCase() }));
        if (!candidates.length) blockers.push(`${target} did not resolve to an IPv4 address.`);
      } catch {
        blockers.push(`${target} could not be resolved by this computer's DNS.`);
      }
    } else blockers.push(`"${target}" is not an IPv4 address, CIDR block, range, or hostname.`);

    for (const c of candidates) {
      const bad = unusable(c.ip);
      if (bad) {
        refused.push({ ip: c.ip, reason: `${c.ip} ${bad}` });
        continue;
      }
      const sc = checkScope(db, eng.id, c.ip, c.hostname);
      if (sc.status === 'excluded') excluded.push({ ip: c.ip, matched: sc.matched!.target });
      else if (sc.status === 'in_scope') addresses.push({ ip: c.ip, hostname: c.hostname, matched: sc.matched!.target });
      else if (sc.status === 'no_scope_defined') refused.push({ ip: c.ip, reason: 'no authorized targets are recorded on the Engagement page' });
      else refused.push({ ip: c.ip, reason: 'not covered by any authorized target' });
    }
    if (refused.length) blockers.push(`${refused.length} address(es) are not in the authorized scope. Add them on the Engagement page if your instructor approved them.`);
    if (!refused.length && candidates.length && !addresses.length) blockers.push('Every address in that target is excluded from scope.');
    if (addresses.length > NMAP_LIMITS.maxHosts) blockers.push(`That target covers ${addresses.length} hosts; the limit is ${NMAP_LIMITS.maxHosts}.`);
    if (excluded.length) warnings.push(`${excluded.length} excluded address(es) will be skipped.`);
  }

  const args = [...NMAP_PROFILES[profile].args, ...(skipDiscovery && profile !== 'discovery' ? ['-Pn'] : []), ...COMMON_ARGS, ...addresses.map((a) => a.ip)];
  const shown = addresses.length > 6 ? [...addresses.slice(0, 6).map((a) => a.ip), `… (${addresses.length} addresses)`] : addresses.map((a) => a.ip);
  const command = ['nmap', ...[...NMAP_PROFILES[profile].args, ...(skipDiscovery && profile !== 'discovery' ? ['-Pn'] : []), ...COMMON_ARGS], ...shown].join(' ');
  if (running.size) blockers.push('Another scan is already running. Wait for it to finish or cancel it.');
  return {
    ok: blockers.length === 0,
    profile,
    target_input: target,
    addresses,
    excluded,
    refused,
    blockers,
    warnings,
    args,
    command,
    nmap: { available: !!info.path, version: info.version },
  };
}

// ---------- execution ----------
const running = new Map<string, ChildProcess>();

export function markInterruptedRuns(ctx: Ctx) {
  ctx.db.run(
    "UPDATE scan_runs SET status = 'interrupted', finished_at = ?, error = 'CyberDome was stopped while this scan was running. No results were imported.' WHERE status = 'running'",
    nowIso(),
  );
}

export const hydrateRun = (r: Row) => ({
  ...r,
  addresses: parseJson(r.addresses, []),
  excluded: parseJson(r.excluded, []),
  args: parseJson(r.args, []),
  warnings: parseJson(r.warnings, []),
});

function childEnv() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(CYBERDOME_|AI_PROVIDER|NVD_API_KEY)|KEY|TOKEN|SECRET|PASSWORD/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

export function startScan(ctx: Ctx, eng: Row, plan: ScanPlan, scheduleId: string | null = null): Row {
  const { db } = ctx;
  if (!plan.ok) throw new HttpError(409, plan.blockers[0] ?? 'The scan plan is not valid.', { blockers: plan.blockers });
  const info = nmapInfo(ctx);
  if (!info.path) throw new HttpError(503, 'Nmap is not available.');
  const id = uid();
  const code = nextCode(db, eng.id, 'scan_run');
  const startedAt = nowIso();
  db.insert('scan_runs', {
    id, engagement_id: eng.id, code, profile: plan.profile, target_input: plan.target_input,
    addresses: plan.addresses, excluded: plan.excluded, args: plan.args, nmap_version: info.version,
    status: 'running', progress: 0, progress_note: 'Starting', warnings: plan.warnings,
    requested_by: scheduleId ? `${currentActor(db)} (automatic schedule)` : currentActor(db), started_at: startedAt, schedule_id: scheduleId,
  });
  logActivity(db, eng.id, 'scan_run.started', 'scan_run', `${scheduleId ? 'Automatic schedule started' : 'Started'} ${code}: ${NMAP_PROFILES[plan.profile].label} of ${plan.target_input} (${plan.addresses.length} in-scope address(es))`, { id, code });

  let stdout = '';
  let stderr = '';
  const child = execFile(info.path, plan.args, { timeout: NMAP_LIMITS.timeoutMs, maxBuffer: NMAP_LIMITS.maxBufferBytes, windowsHide: true, env: childEnv() }, (err) => {
    running.delete(id);
    const finishedAt = nowIso();
    const current = db.get('SELECT status FROM scan_runs WHERE id = ?', id);
    if (current?.status === 'cancelled') return;
    const exitCode = (err as any)?.code;
    if (err && !stdout.includes('</nmaprun>')) {
      const killed = (err as any).killed;
      const msg = killed
        ? 'Nmap exceeded the 30-minute limit and was stopped. No results were imported.'
        : `Nmap failed: ${(stderr.split('\n').find((l) => l.trim()) ?? err.message).slice(0, 400)}`;
      db.update('scan_runs', id, { status: 'failed', error: msg, exit_code: typeof exitCode === 'number' ? exitCode : null, stderr: stderr.slice(0, 8000), finished_at: finishedAt, progress_note: 'Failed' });
      logActivity(db, eng.id, 'scan_run.failed', 'scan_run', `${code} failed: ${msg}`, { id, code });
      return;
    }
    try {
      const buf = Buffer.from(stdout, 'utf8');
      const result = commitScan(ctx, db.get('SELECT * FROM engagements WHERE id = ?', eng.id)!, buf, `nmap-${code.toLowerCase()}-${plan.profile}.xml`, {
        sourceCategory: 'authorized_lab',
        collectedAt: null,
        allowDuplicate: true,
        storeRaw: true,
        title: `Nmap ${NMAP_PROFILES[plan.profile].label.toLowerCase()} of ${plan.target_input} (${code}, run from CyberDome)`,
      } as any);
      db.update('scan_runs', id, {
        status: 'completed', exit_code: 0, stderr: stderr.slice(0, 8000), finished_at: finishedAt, progress: 100, progress_note: 'Imported',
        scan_import_id: result.id, evidence_id: result.evidence_id,
      });
      logActivity(db, eng.id, 'scan_run.completed', 'scan_run', `${code} finished and was imported as ${result.code} (${result.evidence_code})`, { id, code });
    } catch (e: any) {
      db.update('scan_runs', id, { status: 'failed', error: `Nmap finished but the import failed: ${String(e?.message ?? e).slice(0, 400)}`, stderr: stderr.slice(0, 8000), finished_at: finishedAt });
    }
  });
  running.set(id, child);

  let lastWrite = 0;
  child.stdout?.on('data', (d: Buffer) => {
    stdout += d.toString('utf8');
    const m = [...stdout.slice(-4000).matchAll(/<taskprogress task="([^"]+)"[^>]*percent="([\d.]+)"/g)].pop();
    if (m && Date.now() - lastWrite > 1500) {
      lastWrite = Date.now();
      db.update('scan_runs', id, { progress: Number(m[2]), progress_note: m[1] });
    }
  });
  child.stderr?.on('data', (d: Buffer) => {
    if (stderr.length < 16_000) stderr += d.toString('utf8');
  });
  return hydrateRun(db.get('SELECT * FROM scan_runs WHERE id = ?', id)!);
}

export function cancelScan(ctx: Ctx, eng: Row, id: string) {
  const run = ctx.db.get('SELECT * FROM scan_runs WHERE engagement_id = ? AND (id = ? OR code = ?)', eng.id, id, id);
  if (!run) throw new HttpError(404, 'Scan run not found.');
  if (run.status !== 'running') throw badRequest(`${run.code} is not running.`);
  ctx.db.update('scan_runs', run.id, { status: 'cancelled', finished_at: nowIso(), progress_note: 'Cancelled', error: 'Cancelled by the analyst. No results were imported.' });
  running.get(run.id)?.kill();
  running.delete(run.id);
  logActivity(ctx.db, eng.id, 'scan_run.cancelled', 'scan_run', `Cancelled ${run.code}`, { id: run.id, code: run.code });
}

export const isScanRunning = () => running.size > 0;
