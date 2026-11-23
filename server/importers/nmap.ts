import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { emptyScan, type ParsedHost, type ParsedPort, type ParsedScan } from './scanTypes.js';

const ARRAYS = new Set(['host', 'port', 'hostname', 'address', 'osmatch', 'osclass', 'cpe', 'extraports', 'portused', 'script', 'elem', 'table']);

const epochIso = (v: unknown): string | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};
const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

/**
 * Parse Nmap XML (-oX). Version status rules:
 *  - 'detected' only when the service was identified by probing (method="probed") AND a version string was reported.
 *  - Otherwise 'unknown'. A method="table" service name is only a port-table guess, so the product/version
 *    are never filled in or promoted.
 */
export function parseNmapXml(text: string): ParsedScan {
  const out = emptyScan('nmap_xml');
  out.tool = 'Nmap';
  const valid = XMLValidator.validate(text);
  if (valid !== true) {
    out.errors.push({ row: valid.err.line, message: `XML is not well-formed (line ${valid.err.line}, col ${valid.err.col}): ${valid.err.msg}` });
    return out;
  }
  let doc: any;
  try {
    doc = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      isArray: (name) => ARRAYS.has(name),
      processEntities: true,
      allowBooleanAttributes: true,
    }).parse(text);
  } catch (e: any) {
    out.errors.push({ message: `Could not parse XML: ${e?.message ?? 'unknown error'}` });
    return out;
  }
  const run = doc?.nmaprun;
  if (!run || typeof run !== 'object') {
    out.errors.push({ message: 'This XML file is not Nmap output (no <nmaprun> element).' });
    return out;
  }
  out.tool_version = str(run.version);
  out.command = str(run.args);
  out.started_at = epochIso(run.start);
  out.finished_at = epochIso(run.runstats?.finished?.time);
  if (!out.finished_at) out.warnings.push('The scan has no <runstats> finish record; the file may be from an interrupted scan.');
  if (run.runstats?.finished?.exit && run.runstats.finished.exit !== 'success')
    out.warnings.push(`Nmap reported exit status “${run.runstats.finished.exit}”${run.runstats.finished.errormsg ? `: ${run.runstats.finished.errormsg}` : ''}.`);

  const hosts: any[] = run.host ?? [];
  if (!hosts.length) out.warnings.push('The scan contains no <host> entries.');

  hosts.forEach((h, idx) => {
    const addrs: any[] = h.address ?? [];
    const ip = str(addrs.find((a) => a.addrtype === 'ipv4')?.addr) ?? str(addrs.find((a) => a.addrtype === 'ipv6')?.addr);
    const mac = str(addrs.find((a) => a.addrtype === 'mac')?.addr);
    const hostnames: string[] = ((h.hostnames && typeof h.hostnames === 'object' ? h.hostnames.hostname : null) ?? [])
      .map((x: any) => str(x?.name))
      .filter(Boolean) as string[];
    const state = h.status?.state === 'up' ? 'up' : h.status?.state === 'down' ? 'down' : 'unknown';
    const observed_at = epochIso(h.endtime) ?? epochIso(h.starttime) ?? out.finished_at ?? out.started_at;
    const osMatches = ((h.os && typeof h.os === 'object' ? h.os.osmatch : null) ?? []).map((m: any) => ({
      name: String(m.name ?? ''),
      accuracy: m.accuracy !== undefined ? Number(m.accuracy) : null,
    })).filter((m: any) => m.name);

    const portList: any[] = (h.ports && typeof h.ports === 'object' ? h.ports.port : null) ?? [];
    const ports: ParsedPort[] = [];
    for (const p of portList) {
      const portNum = Number(p.portid);
      if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
        out.warnings.push(`Host ${ip ?? `#${idx + 1}`}: skipped a port entry with invalid port number “${p.portid}”.`);
        continue;
      }
      const s = p.service ?? {};
      const method = str(s.method);
      const product = str(s.product);
      const version = str(s.version);
      const probed = method === 'probed';
      ports.push({
        port: portNum,
        protocol: String(p.protocol ?? 'tcp').toLowerCase(),
        state: String(p.state?.state ?? 'unknown'),
        reason: str(p.state?.reason),
        service_name: str(s.name),
        product: probed ? product : null,
        version: probed ? version : null,
        extra_info: probed ? str(s.extrainfo) : null,
        version_status: probed && version ? 'detected' : 'unknown',
        service_method: method,
        service_conf: s.conf !== undefined ? Number(s.conf) : null,
        observed_at,
        notes: method === 'table' ? 'Service name from Nmap port table (not probed); product/version unknown.' : null,
      });
    }
    const extraports: any[] = (h.ports && typeof h.ports === 'object' ? h.ports.extraports : null) ?? [];
    const extraNote = extraports.map((e) => `${e.count} ${e.state}`).join(', ');

    if (!ip) {
      out.warnings.push(`Host #${idx + 1} has no IP address and was skipped.`);
      return;
    }
    if (state === 'down') {
      out.warnings.push(`Host ${ip} was reported down; no asset was created for it.`);
      if (!ports.length) return;
    }
    if (state === 'up' && !ports.length)
      out.warnings.push(`Host ${ip} is up but reported no individually listed ports${extraNote ? ` (${extraNote} not shown)` : ''}.`);

    const host: ParsedHost = {
      ip,
      hostname: hostnames[0] ?? null,
      hostnames,
      mac,
      state,
      os_matches: osMatches,
      os_text: osMatches[0] ? `${osMatches[0].name}${osMatches[0].accuracy !== null ? ` (${osMatches[0].accuracy}% accuracy)` : ''}` : null,
      observed_at,
      ports,
    };
    out.hosts.push(host);
  });

  if (out.hosts.some((h) => !h.observed_at)) out.warnings.push('Some hosts have no timestamp in the file; their observation time is unknown.');
  out.parseable = true;
  return out;
}
