import { parseCsv } from '../lib/csv.js';
import { normalizeTimestamp } from '../lib/time.js';
import { emptyScan, isIp, PORT_STATES, PROTOCOLS, type ParsedHost, type ParsedPort, type ParsedScan, type VersionStatus } from './scanTypes.js';

export const SCAN_CSV_COLUMNS = ['host_ip', 'hostname', 'port', 'protocol', 'state', 'service', 'product', 'version', 'version_status', 'os', 'observed_at', 'notes'];
const IGNORED_COLUMNS = new Set(['synthetic_note', 'note', 'comment']);

export const SCAN_CSV_TEMPLATE =
  'host_ip,hostname,port,protocol,state,service,product,version,version_status,os,observed_at,notes\n' +
  '# SYNTHETIC TEMPLATE EXAMPLE — replace these rows with your authorized scan results. Lines starting with # are ignored.\n' +
  '192.0.2.10,web01.cyberdome.example,22,tcp,open,ssh,OpenSSH,8.2p1,detected,Linux,2026-10-12T14:07:00Z,Banner read by service probe\n' +
  '192.0.2.10,web01.cyberdome.example,80,tcp,open,http,Apache httpd,,unknown,Linux,2026-10-12T14:07:00Z,Version not shown in output\n';

interface Row {
  host_ip?: string; hostname?: string; port?: any; protocol?: string; state?: string; service?: string; product?: string;
  version?: string; version_status?: string; os?: string; observed_at?: string; notes?: string;
}

/** Validate one flat row into a port observation (plus host fields). Row-level problems become errors or warnings. */
function rowToObservation(r: Row, rowNum: number, tz: string, out: ParsedScan, tsWarned: { v: boolean }): { ip: string; hostname: string | null; os: string | null; port: ParsedPort } | null {
  const ip = String(r.host_ip ?? '').trim();
  if (!ip) {
    out.errors.push({ row: rowNum, message: 'host_ip is required.' });
    return null;
  }
  if (!isIp(ip)) {
    out.errors.push({ row: rowNum, message: `host_ip “${ip}” is not a valid IP address.` });
    return null;
  }
  const portNum = Number(String(r.port ?? '').trim());
  if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    out.errors.push({ row: rowNum, message: `port “${r.port ?? ''}” must be a whole number from 0 to 65535.` });
    return null;
  }
  let protocol = String(r.protocol ?? '').trim().toLowerCase();
  if (!protocol) {
    protocol = 'tcp';
    out.warnings.push(`Row ${rowNum}: protocol missing; recorded as tcp.`);
  } else if (!PROTOCOLS.includes(protocol)) {
    out.errors.push({ row: rowNum, message: `protocol “${protocol}” is not one of ${PROTOCOLS.join(', ')}.` });
    return null;
  }
  const state = String(r.state ?? '').trim().toLowerCase();
  if (!PORT_STATES.includes(state)) {
    out.errors.push({ row: rowNum, message: `state “${r.state ?? ''}” must be one of ${PORT_STATES.join(', ')}.` });
    return null;
  }
  const version = String(r.version ?? '').trim() || null;
  const product = String(r.product ?? '').trim() || null;
  let vs = String(r.version_status ?? '').trim().toLowerCase() as VersionStatus | '';
  if (vs && !['detected', 'inferred', 'unknown'].includes(vs)) {
    out.warnings.push(`Row ${rowNum}: version_status “${vs}” not recognized; recorded as ${version ? 'inferred' : 'unknown'}.`);
    vs = '';
  }
  if (!vs) {
    vs = version ? 'inferred' : 'unknown';
    if (version) out.warnings.push(`Row ${rowNum}: version_status not given for version “${version}”; recorded as inferred (not detected).`);
  }
  if (vs === 'detected' && !version) {
    out.warnings.push(`Row ${rowNum}: version_status “detected” but no version supplied; recorded as unknown.`);
    vs = 'unknown';
  }
  if (vs === 'unknown' && version) {
    out.warnings.push(`Row ${rowNum}: version “${version}” supplied with status unknown; the value is kept but labeled unknown.`);
  }
  let observed_at: string | null = null;
  if (r.observed_at !== undefined && String(r.observed_at).trim()) {
    const ts = normalizeTimestamp(r.observed_at, tz);
    if (ts.status === 'unparseable') out.warnings.push(`Row ${rowNum}: observed_at “${r.observed_at}” could not be parsed; observation time left unknown.`);
    else {
      observed_at = ts.normalized;
      if (ts.status === 'assumed_timezone' && !tsWarned.v) {
        tsWarned.v = true;
        out.warnings.push(`Some observed_at values have no timezone offset; they were interpreted in the engagement timezone (${tz}).`);
      }
    }
  }
  return {
    ip,
    hostname: String(r.hostname ?? '').trim() || null,
    os: String(r.os ?? '').trim() || null,
    port: {
      port: portNum,
      protocol,
      state,
      reason: null,
      service_name: String(r.service ?? '').trim() || null,
      product,
      version,
      extra_info: null,
      version_status: vs as VersionStatus,
      service_method: 'analyst_supplied',
      service_conf: null,
      observed_at,
      notes: String(r.notes ?? '').trim() || null,
      row: rowNum,
    },
  };
}

function group(out: ParsedScan, items: { ip: string; hostname: string | null; os: string | null; port: ParsedPort }[], hostTimes = new Map<string, string | null>()) {
  const byIp = new Map<string, ParsedHost>();
  for (const it of items) {
    let h = byIp.get(it.ip);
    if (!h) {
      h = { ip: it.ip, hostname: it.hostname, hostnames: [], mac: null, state: 'up', os_matches: [], os_text: it.os, observed_at: hostTimes.get(it.ip) ?? null, ports: [] };
      byIp.set(it.ip, h);
    }
    if (it.hostname && !h.hostnames.includes(it.hostname)) h.hostnames.push(it.hostname);
    if (!h.hostname && it.hostname) h.hostname = it.hostname;
    if (!h.os_text && it.os) h.os_text = it.os;
    const dup = h.ports.find((p) => p.port === it.port.port && p.protocol === it.port.protocol);
    if (dup) {
      out.warnings.push(`Row ${it.port.row}: duplicate of row ${dup.row} (${it.ip} ${it.port.port}/${it.port.protocol}) within this file; skipped.`);
      continue;
    }
    if (!h.observed_at || (it.port.observed_at && it.port.observed_at > h.observed_at)) h.observed_at = it.port.observed_at ?? h.observed_at;
    h.ports.push(it.port);
  }
  out.hosts = [...byIp.values()];
}

export function parseScanCsv(text: string, tz: string): ParsedScan {
  const out = emptyScan('csv');
  out.tool = 'CSV import';
  const cleaned = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#')).join('\n');
  const parsed = parseCsv(cleaned);
  if (!parsed.headers.length) {
    out.errors.push({ message: 'The CSV file has no header row.' });
    return out;
  }
  const missing = ['host_ip', 'port', 'state'].filter((c) => !parsed.headers.includes(c));
  if (missing.length) {
    out.errors.push({ message: `Missing required column(s): ${missing.join(', ')}. Download the CSV template for the expected columns.` });
    return out;
  }
  const unknown = parsed.headers.filter((h) => !SCAN_CSV_COLUMNS.includes(h) && !IGNORED_COLUMNS.has(h) && h);
  if (unknown.length) out.warnings.push(`Unknown column(s) ignored: ${unknown.join(', ')}.`);
  for (const e of parsed.errors) out.warnings.push(`Row ${e.row}: ${e.message}`);
  const tsWarned = { v: false };
  const items = parsed.rows.map((r, i) => rowToObservation(r as Row, i + 2, tz, out, tsWarned)).filter(Boolean) as any[];
  group(out, items);
  if (!parsed.rows.length) out.errors.push({ message: 'The CSV file has a header but no data rows.' });
  if (out.hosts.some((h) => h.ports.some((p) => !p.observed_at))) out.warnings.push('Some rows have no observed_at value; their observation time is unknown.');
  out.parseable = items.length > 0;
  return out;
}

const JSON_TOP = new Set(['tool', 'tool_version', 'command', 'scanned_at', 'finished_at', 'hosts', 'synthetic_note', 'note']);
const JSON_HOST = new Set(['ip', 'host_ip', 'hostname', 'hostnames', 'os', 'mac', 'observed_at', 'ports']);
const JSON_PORT = new Set(['port', 'protocol', 'state', 'service', 'product', 'version', 'version_status', 'observed_at', 'notes']);

export function parseScanJson(text: string, tz: string): ParsedScan {
  const out = emptyScan('json');
  out.tool = 'JSON import';
  let doc: any;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e: any) {
    out.errors.push({ message: `Not valid JSON: ${e?.message ?? 'parse error'}` });
    return out;
  }
  const tsWarned = { v: false };
  const items: any[] = [];
  // Flat array of CSV-shaped rows is also accepted.
  if (Array.isArray(doc)) {
    doc.forEach((r, i) => {
      if (!r || typeof r !== 'object') return out.errors.push({ row: i + 1, message: 'Entry is not an object.' });
      const unk = Object.keys(r).filter((k) => !SCAN_CSV_COLUMNS.includes(k) && !IGNORED_COLUMNS.has(k));
      if (unk.length) out.warnings.push(`Entry ${i + 1}: unknown field(s) ignored: ${unk.join(', ')}.`);
      const o = rowToObservation(r, i + 1, tz, out, tsWarned);
      if (o) items.push(o);
    });
    group(out, items);
    out.parseable = items.length > 0;
    return out;
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.hosts)) {
    out.errors.push({ message: 'Expected an object with a "hosts" array (or an array of rows). See the JSON template.' });
    return out;
  }
  const unkTop = Object.keys(doc).filter((k) => !JSON_TOP.has(k));
  if (unkTop.length) out.warnings.push(`Unknown top-level field(s) ignored: ${unkTop.join(', ')}.`);
  out.tool = doc.tool ? String(doc.tool) : 'JSON import';
  out.tool_version = doc.tool_version ? String(doc.tool_version) : null;
  out.command = doc.command ? String(doc.command) : null;
  const scanTs = doc.scanned_at ? normalizeTimestamp(doc.scanned_at, tz) : null;
  out.started_at = scanTs?.normalized ?? null;
  if (doc.finished_at) out.finished_at = normalizeTimestamp(doc.finished_at, tz).normalized;
  let entry = 0;
  const hostTimes = new Map<string, string | null>();
  doc.hosts.forEach((h: any, hi: number) => {
    if (!h || typeof h !== 'object') return out.errors.push({ row: hi + 1, message: `hosts[${hi}] is not an object.` });
    const unkH = Object.keys(h).filter((k) => !JSON_HOST.has(k));
    if (unkH.length) out.warnings.push(`hosts[${hi}]: unknown field(s) ignored: ${unkH.join(', ')}.`);
    const ip = h.ip ?? h.host_ip;
    const hostTs = h.observed_at ? normalizeTimestamp(h.observed_at, tz).normalized : null;
    if (ip) hostTimes.set(String(ip), hostTs ?? out.finished_at ?? out.started_at);
    if (!Array.isArray(h.ports) || !h.ports.length) {
      if (ip && isIp(String(ip))) {
        out.warnings.push(`hosts[${hi}] (${ip}) lists no ports.`);
        items.push({ ip: String(ip), hostname: h.hostname ?? null, os: h.os ?? null, port: null });
      } else out.errors.push({ row: hi + 1, message: `hosts[${hi}] has no valid ip and no ports.` });
      return;
    }
    h.ports.forEach((p: any, pi: number) => {
      entry++;
      if (!p || typeof p !== 'object') return out.errors.push({ row: entry, message: `hosts[${hi}].ports[${pi}] is not an object.` });
      const unkP = Object.keys(p).filter((k) => !JSON_PORT.has(k));
      if (unkP.length) out.warnings.push(`hosts[${hi}].ports[${pi}]: unknown field(s) ignored: ${unkP.join(', ')}.`);
      const o = rowToObservation(
        { host_ip: ip, hostname: h.hostname, os: h.os, ...p, observed_at: p.observed_at ?? h.observed_at ?? doc.finished_at ?? doc.scanned_at },
        entry, tz, out, tsWarned,
      );
      if (o) items.push(o);
    });
  });
  // Hosts with no ports are kept as hosts with an empty port list.
  const withPorts = items.filter((i) => i.port);
  group(out, withPorts, hostTimes);
  for (const i of items.filter((x) => !x.port)) {
    if (!out.hosts.some((h) => h.ip === i.ip))
      out.hosts.push({ ip: i.ip, hostname: i.hostname, hostnames: i.hostname ? [i.hostname] : [], mac: null, state: 'up', os_matches: [], os_text: i.os, observed_at: hostTimes.get(i.ip) ?? null, ports: [] });
  }
  out.parseable = out.hosts.length > 0;
  return out;
}
