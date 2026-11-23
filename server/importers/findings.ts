import { XMLParser } from 'fast-xml-parser';
import { parseCsv } from '../lib/csv.js';

/**
 * Vulnerability report parsers. Every parser returns normalized rows plus row-level
 * errors and warnings. Parsing never writes to the database.
 *
 * Supported formats:
 *  - normalized_csv / normalized_json : the documented CyberDome template
 *  - nessus        : Tenable .nessus v2 XML (NessusClientData_v2)
 *  - greenbone_xml : Greenbone / OpenVAS XML report (GMP get_reports_response or <report>)
 */
export type FindingFormat = 'normalized_csv' | 'normalized_json' | 'nessus' | 'greenbone_xml';
export type Sev = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ParsedFinding {
  row: number;
  title: string;
  severity: Sev;
  host_ip: string | null;
  hostname: string | null;
  port: number | null;
  protocol: string | null;
  service_name: string | null;
  cves: string[];
  cvss_score: number | null;
  cvss_version: string | null;
  cvss_vector: string | null;
  description: string;
  impact: string;
  remediation: string;
  scanner: string;
  plugin_id: string | null;
  evidence_note: string;
}

export interface RowIssue {
  row: number;
  message: string;
}

export interface FindingParseResult {
  format: FindingFormat;
  scanner: string;
  rows: ParsedFinding[];
  errors: RowIssue[];
  warnings: RowIssue[];
  unknown_columns: string[];
  skipped_info: number;
  total_rows: number;
}

export const NORMALIZED_COLUMNS = [
  'title', 'severity', 'host_ip', 'port', 'protocol', 'cves', 'cvss_score', 'cvss_version', 'cvss_vector',
  'description', 'impact', 'remediation', 'scanner', 'plugin_id', 'evidence_note',
] as const;

export const FINDINGS_TEMPLATE_CSV =
  NORMALIZED_COLUMNS.join(',') +
  '\n' +
  '"SYNTHETIC EXAMPLE - Outdated OpenSSH version reported",medium,192.0.2.30,22,tcp,CVE-2021-41617,7.0,3.1,CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:H,"Scanner reported OpenSSH 7.6p1 from the service banner.","Possible privilege escalation if the vulnerable configuration is present.","Upgrade OpenSSH to a supported release.",ExampleScanner,EX-1001,"Banner observed in synthetic scan output"\n';

export const CVE_RE = /^CVE-\d{4}-\d{4,}$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function normalizeSeverity(v: unknown): Sev | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (['critical', 'crit', '4'].includes(s)) return 'critical';
  if (['high', '3'].includes(s)) return 'high';
  if (['medium', 'moderate', 'med', '2'].includes(s)) return 'medium';
  if (['low', '1'].includes(s)) return 'low';
  if (['info', 'informational', 'none', 'log', 'debug', '0'].includes(s)) return 'info';
  return null;
}

/** CVSS v3/v4 qualitative severity bands from a base score. */
export function severityFromScore(score: number): Sev {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'info';
}

function splitCves(v: unknown, row: number, warnings: RowIssue[]): string[] {
  const parts = (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;|]+/))
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (CVE_RE.test(p)) {
      if (!out.includes(p)) out.push(p);
    } else warnings.push({ row, message: `Ignored malformed CVE identifier “${p}”.` });
  }
  return out;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}

function txt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const t = (v as any)['#text'];
    return t === undefined ? '' : String(t).trim();
  }
  return String(v).trim();
}

function cvssVersionFromVector(vec: string | null): string | null {
  if (!vec) return null;
  const m = vec.match(/^CVSS:(\d\.\d)/);
  if (m) return m[1];
  if (/^AV:[LANP]\/AC:/.test(vec) && /Au:/.test(vec)) return '2.0';
  return null;
}

/** Validate and normalize one row coming from any format. Returns null if unusable. */
function finishRow(
  raw: Partial<Record<string, unknown>>,
  row: number,
  scanner: string,
  errors: RowIssue[],
  warnings: RowIssue[],
): ParsedFinding | null {
  const title = txt(raw.title);
  const severity = normalizeSeverity(raw.severity);
  if (!title) {
    errors.push({ row, message: 'Missing required “title”.' });
    return null;
  }
  if (!severity) {
    errors.push({ row, message: `Missing or unrecognized severity “${txt(raw.severity)}” (use critical, high, medium, low, or info).` });
    return null;
  }
  let host_ip: string | null = txt(raw.host_ip) || null;
  let hostname: string | null = txt(raw.hostname) || null;
  if (host_ip && !IPV4_RE.test(host_ip)) {
    // A hostname in the IP column is kept as a hostname, never guessed into an IP.
    if (!hostname) hostname = host_ip;
    warnings.push({ row, message: `“${host_ip}” is not an IPv4 address; kept as hostname.` });
    host_ip = null;
  }
  if (!host_ip && !hostname) warnings.push({ row, message: 'No affected host given; the finding will not be linked to an asset.' });

  let port: number | null = null;
  const pn = num(raw.port);
  if (pn !== null) {
    if (Number.isNaN(pn) || !Number.isInteger(pn) || pn < 0 || pn > 65535) warnings.push({ row, message: `Invalid port “${txt(raw.port)}” ignored.` });
    else if (pn > 0) port = pn;
  }
  let protocol = txt(raw.protocol).toLowerCase() || null;
  if (protocol && !['tcp', 'udp', 'sctp', 'icmp'].includes(protocol)) {
    warnings.push({ row, message: `Unrecognized protocol “${protocol}” ignored.` });
    protocol = null;
  }
  if (port && !protocol) protocol = 'tcp';

  let cvss_score: number | null = null;
  const cs = num(raw.cvss_score);
  if (cs !== null) {
    if (Number.isNaN(cs) || cs < 0 || cs > 10) warnings.push({ row, message: `CVSS score “${txt(raw.cvss_score)}” is not between 0 and 10; ignored.` });
    else cvss_score = cs;
  }
  const cvss_vector = txt(raw.cvss_vector) || null;
  const cvss_version = txt(raw.cvss_version) || cvssVersionFromVector(cvss_vector);

  return {
    row,
    title: title.slice(0, 500),
    severity,
    host_ip,
    hostname,
    port,
    protocol,
    service_name: txt(raw.service_name) || null,
    cves: splitCves(raw.cves, row, warnings),
    cvss_score,
    cvss_version: cvss_version || null,
    cvss_vector,
    description: txt(raw.description).slice(0, 20000),
    impact: txt(raw.impact).slice(0, 10000),
    remediation: txt(raw.remediation).slice(0, 10000),
    scanner: txt(raw.scanner) || scanner,
    plugin_id: txt(raw.plugin_id) || null,
    evidence_note: txt(raw.evidence_note).slice(0, 4000),
  };
}

export function detectFindingFormat(text: string, filename = ''): FindingFormat | null {
  const head = text.slice(0, 4000).replace(/^﻿/, '').trimStart();
  const lower = head.toLowerCase();
  if (lower.startsWith('<')) {
    if (lower.includes('<nessusclientdata_v2')) return 'nessus';
    if (/<get_reports_response|<report[\s>]/.test(lower)) return 'greenbone_xml';
    return null;
  }
  if (head.startsWith('{') || head.startsWith('[')) return 'normalized_json';
  if (/\.json$/i.test(filename)) return 'normalized_json';
  return 'normalized_csv';
}

function emptyResult(format: FindingFormat, scanner: string): FindingParseResult {
  return { format, scanner, rows: [], errors: [], warnings: [], unknown_columns: [], skipped_info: 0, total_rows: 0 };
}

export function parseFindingsFile(text: string, filename = '', opts: { format?: FindingFormat; includeInfo?: boolean } = {}): FindingParseResult {
  const clean = text.replace(/^﻿/, '');
  const format = opts.format ?? detectFindingFormat(clean, filename);
  if (!format) {
    const r = emptyResult('normalized_csv', '');
    r.errors.push({ row: 0, message: 'Unrecognized file format. Use the CyberDome CSV/JSON template, a .nessus (v2) file, or a Greenbone/OpenVAS XML report.' });
    return r;
  }
  let result: FindingParseResult;
  try {
    if (format === 'normalized_csv') result = parseNormalizedCsv(clean);
    else if (format === 'normalized_json') result = parseNormalizedJson(clean);
    else if (format === 'nessus') result = parseNessus(clean);
    else result = parseGreenbone(clean);
  } catch (e: any) {
    result = emptyResult(format, '');
    result.errors.push({ row: 0, message: `File could not be parsed as ${format.replace('_', ' ')}: ${String(e?.message ?? e).slice(0, 200)}` });
    return result;
  }
  if (!opts.includeInfo) {
    const before = result.rows.length;
    result.rows = result.rows.filter((r) => r.severity !== 'info');
    result.skipped_info = before - result.rows.length;
  }
  return result;
}

function parseNormalizedCsv(text: string): FindingParseResult {
  const res = emptyResult('normalized_csv', '');
  const parsed = parseCsv(text);
  for (const e of parsed.errors) res.errors.push(e);
  if (!parsed.headers.includes('title') || !parsed.headers.includes('severity')) {
    res.errors.push({ row: 1, message: 'Header row must include at least “title” and “severity”. Download the template for the full column list.' });
    return res;
  }
  res.unknown_columns = parsed.headers.filter((h) => !(NORMALIZED_COLUMNS as readonly string[]).includes(h) && h !== 'hostname' && h !== 'service_name');
  if (res.unknown_columns.length)
    res.warnings.push({ row: 1, message: `Unknown columns ignored: ${res.unknown_columns.join(', ')}` });
  parsed.rows.forEach((raw, i) => {
    res.total_rows++;
    const f = finishRow(raw, i + 2, '', res.errors, res.warnings);
    if (f) res.rows.push(f);
  });
  return res;
}

function parseNormalizedJson(text: string): FindingParseResult {
  const res = emptyResult('normalized_json', '');
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e: any) {
    res.errors.push({ row: 0, message: `Invalid JSON: ${String(e.message).slice(0, 160)}` });
    return res;
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.findings) ? data.findings : null;
  if (!list) {
    res.errors.push({ row: 0, message: 'JSON must be an array of finding objects or an object with a “findings” array.' });
    return res;
  }
  const unknown = new Set<string>();
  list.forEach((raw: any, i: number) => {
    res.total_rows++;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      res.errors.push({ row: i + 1, message: 'Entry is not an object.' });
      return;
    }
    for (const k of Object.keys(raw)) if (!(NORMALIZED_COLUMNS as readonly string[]).includes(k) && k !== 'hostname' && k !== 'service_name') unknown.add(k);
    const f = finishRow(raw, i + 1, '', res.errors, res.warnings);
    if (f) res.rows.push(f);
  });
  res.unknown_columns = [...unknown];
  if (unknown.size) res.warnings.push({ row: 0, message: `Unknown fields ignored: ${[...unknown].join(', ')}` });
  return res;
}

const xml = () =>
  new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    isArray: (name, jpath) =>
      name === 'severity' ? String(jpath).endsWith('severities.severity') : ['ReportHost', 'ReportItem', 'cve', 'tag', 'result', 'ref'].includes(name),
  });

function parseNessus(text: string): FindingParseResult {
  const res = emptyResult('nessus', 'Nessus');
  const doc = xml().parse(text);
  const root = doc?.NessusClientData_v2;
  if (!root) {
    res.errors.push({ row: 0, message: 'Missing <NessusClientData_v2> root element.' });
    return res;
  }
  const reports = Array.isArray(root.Report) ? root.Report : root.Report ? [root.Report] : [];
  let n = 0;
  for (const report of reports) {
    for (const host of report?.ReportHost ?? []) {
      const tags: Record<string, string> = {};
      for (const t of host?.HostProperties?.tag ?? []) tags[t['@_name']] = txt(t);
      const ip = tags['host-ip'] || (IPV4_RE.test(host['@_name'] ?? '') ? host['@_name'] : '');
      const hostname = tags['host-fqdn'] || tags['hostname'] || (!IPV4_RE.test(host['@_name'] ?? '') ? host['@_name'] : '') || null;
      for (const item of host?.ReportItem ?? []) {
        n++;
        res.total_rows++;
        const sevNum = item['@_severity'];
        const cvss3 = txt(item.cvss3_base_score);
        const cvss2 = txt(item.cvss_base_score);
        const vec3 = txt(item.cvss3_vector);
        const vec2 = txt(item.cvss_vector);
        const synopsis = txt(item.synopsis);
        const desc = txt(item.description);
        const pluginOutput = txt(item.plugin_output);
        const raw = {
          title: item['@_pluginName'] || txt(item.plugin_name),
          severity: sevNum ?? txt(item.risk_factor),
          host_ip: ip || null,
          hostname,
          port: item['@_port'],
          protocol: item['@_protocol'],
          service_name: item['@_svc_name'],
          cves: (item.cve ?? []).map((c: any) => txt(c)),
          cvss_score: cvss3 || cvss2 || null,
          cvss_version: cvss3 ? (vec3.match(/^CVSS:(\d\.\d)/)?.[1] ?? '3.0') : cvss2 ? '2.0' : null,
          cvss_vector: cvss3 ? vec3 : vec2 || null,
          description: [synopsis, desc].filter(Boolean).join('\n\n') + (pluginOutput ? `\n\nPlugin output:\n${pluginOutput}` : ''),
          impact: '',
          remediation: txt(item.solution),
          plugin_id: item['@_pluginID'],
          evidence_note: `Nessus plugin ${item['@_pluginID'] ?? '?'} (${item['@_pluginFamily'] ?? 'unknown family'})`,
        };
        const f = finishRow(raw, n, 'Nessus', res.errors, res.warnings);
        if (f) res.rows.push(f);
      }
    }
  }
  if (!res.total_rows) res.warnings.push({ row: 0, message: 'The file contains no ReportItem entries.' });
  return res;
}

/** Find all <result> arrays anywhere in a parsed Greenbone document. */
function collectResults(node: any, out: any[] = [], depth = 0): any[] {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const x of node) collectResults(x, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'result' && Array.isArray(v)) {
      for (const r of v) if (r && typeof r === 'object' && (r as any).nvt) out.push(r);
    } else if (k !== 'nvt' && typeof v === 'object') collectResults(v, out, depth + 1);
  }
  return out;
}

function parseTags(tags: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of tags.split('|')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function parseGreenbone(text: string): FindingParseResult {
  const res = emptyResult('greenbone_xml', 'Greenbone/OpenVAS');
  const doc = xml().parse(text);
  const results = collectResults(doc);
  if (!results.length) {
    if (!/<report/i.test(text)) res.errors.push({ row: 0, message: 'No <report> element found.' });
    else res.warnings.push({ row: 0, message: 'The report contains no <result> entries with NVT details.' });
    return res;
  }
  results.forEach((r, i) => {
    res.total_rows++;
    const nvt = r.nvt ?? {};
    const tags = parseTags(txt(nvt.tags));
    const hostNode = r.host;
    const host = typeof hostNode === 'object' ? txt(hostNode) : txt(hostNode);
    const hostname = typeof hostNode === 'object' ? txt(hostNode.hostname) || null : null;
    const portStr = txt(r.port);
    const pm = portStr.match(/^(\d+)\/(\w+)/);
    const gm = portStr.match(/^general\/(\w+)/);
    const sevScore = txt(r.severity);
    let threat = txt(r.threat);
    if (!threat && sevScore) threat = String(Number(sevScore) > 0 ? severityFromScore(Number(sevScore)) : 'info');
    const refs: any[] = nvt.refs?.ref ?? [];
    const cves = refs.filter((x) => (x['@_type'] ?? '').toLowerCase() === 'cve').map((x) => x['@_id']);
    if (!cves.length && nvt.cve && txt(nvt.cve) && txt(nvt.cve) !== 'NOCVE') cves.push(...txt(nvt.cve).split(/[,\s]+/));
    const sevList: any[] = nvt.severities?.severity ?? [];
    const v3 = sevList.find((s) => /cvss_base_v3|cvss_base_v4/.test(s['@_type'] ?? ''));
    const vector = v3 ? txt(v3.value) : tags.cvss_base_vector || null;
    const score = v3 ? txt(v3.score) : txt(nvt.cvss_base) || sevScore || null;
    const desc = [tags.summary, tags.insight, tags.affected, txt(r.description) ? `Detection result:\n${txt(r.description)}` : '']
      .filter(Boolean)
      .join('\n\n');
    const qod = r.qod ? `QoD ${txt(r.qod.value)}% (${txt(r.qod.type)})` : '';
    const raw = {
      title: txt(r.name) || txt(nvt.name),
      severity: threat,
      host_ip: host || null,
      hostname,
      port: pm ? pm[1] : null,
      protocol: pm ? pm[2] : gm ? gm[1] : null,
      cves,
      cvss_score: score,
      cvss_version: vector ? null : score ? '2.0' : null,
      cvss_vector: vector,
      description: desc,
      impact: tags.impact ?? '',
      remediation: txt(nvt.solution) || tags.solution || '',
      plugin_id: nvt['@_oid'] ?? null,
      evidence_note: [`Greenbone NVT ${nvt['@_oid'] ?? '?'}`, qod].filter(Boolean).join(' · '),
    };
    const f = finishRow(raw, i + 1, 'Greenbone/OpenVAS', res.errors, res.warnings);
    if (f) res.rows.push(f);
  });
  return res;
}

export function dedupeKey(f: ParsedFinding, format: FindingFormat): string {
  const scanner = (f.scanner || format).toLowerCase();
  const id = (f.plugin_id || f.title).toLowerCase();
  const host = (f.host_ip || f.hostname || 'nohost').toLowerCase();
  return `${scanner}|${id}|${host}|${f.port ?? 0}/${f.protocol ?? ''}`;
}
