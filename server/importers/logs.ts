import { parseCsv } from '../lib/csv.js';
import { normalizeTimestamp, type TsStatus } from '../lib/time.js';

/**
 * Log / packet-export parsing. Pure functions — no I/O.
 *
 * Supported:
 *  - csv            generic CSV (template: timestamp, source, destination, src_port, dst_port, protocol, event_type, message)
 *  - jsonl / json   JSON Lines or JSON array of flat objects (same field names; common aliases accepted)
 *  - wireshark_csv  Wireshark "Export Packet Dissections → As CSV" (No., Time, Source, Destination, Protocol, Length, Info)
 *  - tshark_fields  tshark -T fields -E header=y -E separator=, (frame.time_epoch, ip.src, ip.dst, tcp.srcport, ...)
 *  - tshark_json    tshark -T json  (and -T ek lines)
 *
 * Timestamps: originals are always preserved. Normalization never invents a time.
 */
export type LogFormat = 'csv' | 'jsonl' | 'json' | 'wireshark_csv' | 'tshark_fields' | 'tshark_json' | 'tshark_ek' | 'tshark_processed';

export interface LogRow {
  row_number: number;
  original_timestamp: string | null;
  normalized_ts: string | null;
  ts_status: TsStatus;
  source: string | null;
  destination: string | null;
  src_port: number | null;
  dst_port: number | null;
  protocol: string | null;
  event_type: string | null;
  message: string | null;
  raw: Record<string, unknown>;
}

export interface LogParse {
  format: LogFormat;
  rows: LogRow[];
  total: number;
  skipped: number;
  errors: { row: number; message: string }[];
  warnings: string[];
  truncated: boolean;
  analysis_scope: string;
  ts_summary: Record<TsStatus, number>;
}

export const MAX_LOG_ROWS = 100_000;

const FIELD_ALIASES: Record<string, string[]> = {
  timestamp: ['timestamp', 'time', 'datetime', 'date_time', 'ts', '@timestamp', 'event_time', 'eventtime', 'time_created', 'timecreated', 'date'],
  source: ['source', 'src', 'src_ip', 'source_ip', 'source_address', 'sourceaddress', 'client_ip', 'client', 'srcip', 'source_host', 'host', 'hostname', 'computer'],
  destination: ['destination', 'dst', 'dest', 'dst_ip', 'dest_ip', 'destination_ip', 'destination_address', 'destinationaddress', 'server_ip', 'target', 'dstip', 'dest_host'],
  src_port: ['src_port', 'source_port', 'sport', 'srcport', 'sourceport'],
  dst_port: ['dst_port', 'dest_port', 'destination_port', 'dport', 'dstport', 'destinationport', 'port'],
  protocol: ['protocol', 'proto', 'transport'],
  event_type: ['event_type', 'eventtype', 'type', 'event', 'event_id', 'eventid', 'action', 'category'],
  message: ['message', 'msg', 'description', 'details', 'info', 'summary', 'log', 'text'],
};
const KNOWN_EXTRA = new Set(['user', 'username', 'account', 'process', 'pid', 'result', 'status', 'level', 'severity', 'length', 'no', 'no.']);

const keyNorm = (k: string) => k.trim().toLowerCase().replace(/[\s-]+/g, '_');

function pick(o: Record<string, any>, field: keyof typeof FIELD_ALIASES): [string | null, string | null] {
  for (const alias of FIELD_ALIASES[field]) {
    for (const k of Object.keys(o)) {
      if (keyNorm(k) === alias && o[k] !== null && o[k] !== undefined && String(o[k]).trim() !== '') return [String(o[k]).trim(), k];
    }
  }
  return [null, null];
}

function port(v: unknown, warn: (m: string) => void): number | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).split(',')[0].trim();
  if (!/^\d+$/.test(s)) {
    warn(`port value "${v}" is not a number`);
    return null;
  }
  const n = Number(s);
  if (n < 0 || n > 65535) {
    warn(`port value ${n} out of range`);
    return null;
  }
  return n;
}

const str = (v: unknown, max = 4000) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

export function detectLogFormat(text: string, filename = ''): LogFormat {
  const t = text.replace(/^﻿/, '').trimStart();
  if (t.startsWith('[')) {
    if (/"_source"\s*:\s*\{\s*"layers"/.test(t.slice(0, 5000))) return 'tshark_json';
    return 'json';
  }
  if (t.startsWith('{')) {
    const first = t.split('\n', 1)[0];
    if (/^\{"index"\s*:/.test(first) || /"layers"\s*:\s*\{/.test(t.slice(0, 3000))) return 'tshark_ek';
    return /\.json$/i.test(filename) && !/\n\s*\{/.test(t) ? 'json' : 'jsonl';
  }
  const header = t.split(/\r?\n/, 1)[0].toLowerCase();
  if (/frame\.time_epoch|frame\.number|ip\.src|_ws\.col/.test(header)) return 'tshark_fields';
  if (/"?no\."?\s*,/.test(header) && /info/.test(header) && /source/.test(header)) return 'wireshark_csv';
  return 'csv';
}

const SCOPE_TEXT: Record<LogFormat, string> = {
  csv: 'Parsed log rows from the supplied CSV. Fields were mapped to timestamp, hosts, ports, protocol, event type and message; message text was stored verbatim and not interpreted.',
  jsonl: 'Parsed JSON Lines log records. Fields were mapped to timestamp, hosts, ports, protocol, event type and message; message text was stored verbatim and not interpreted.',
  json: 'Parsed a JSON array of log records. Fields were mapped to timestamp, hosts, ports, protocol, event type and message; message text was stored verbatim and not interpreted.',
  wireshark_csv: 'Parsed exported packet summary rows (Wireshark CSV: addresses, protocol, length, Info column). Payloads were not analyzed by this application.',
  tshark_fields: 'Parsed exported packet summary rows (tshark -T fields: addresses, ports, protocol, Info column). Payloads were not analyzed by this application.',
  tshark_json: 'Parsed tshark JSON packet dissections for frame time, IP addresses, ports and protocol stack only. Payloads were not analyzed by this application.',
  tshark_ek: 'Parsed tshark EK (Elasticsearch) lines for frame time, IP addresses, ports and protocol stack only. Payloads were not analyzed by this application.',
  tshark_processed: 'tshark read the stored capture locally and extracted packet summary fields (frame number, epoch time, IP addresses, TCP/UDP ports, protocol and Info column). Payloads were not analyzed.',
};

export function parseLogs(text: string, opts: { filename?: string; format?: LogFormat; sourceTz?: string } = {}): LogParse {
  const tz = opts.sourceTz || 'UTC';
  const body = text.replace(/^﻿/, '');
  const format = opts.format ?? detectLogFormat(body, opts.filename);
  const errors: { row: number; message: string }[] = [];
  const warnings: string[] = [];
  const rowWarnings: string[] = [];
  let records: { n: number; o: Record<string, any> }[] = [];

  // ---------- gather raw records ----------
  if (format === 'json' || format === 'tshark_json') {
    try {
      const data = JSON.parse(body);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : Array.isArray(data?.records) ? data.records : null;
      if (!arr) errors.push({ row: 0, message: 'JSON must be an array of records (or an object with an "events" array).' });
      else records = arr.map((o: any, i: number) => ({ n: i + 1, o }));
    } catch (e: any) {
      errors.push({ row: 0, message: `Invalid JSON: ${e.message}` });
    }
  } else if (format === 'jsonl' || format === 'tshark_ek') {
    body.split(/\r?\n/).forEach((line, i) => {
      const l = line.trim();
      if (!l) return;
      try {
        const o = JSON.parse(l);
        if (format === 'tshark_ek' && o && typeof o === 'object' && 'index' in o && Object.keys(o).length === 1) return; // ek index line
        records.push({ n: i + 1, o });
      } catch {
        errors.push({ row: i + 1, message: 'Line is not valid JSON.' });
      }
    });
  } else {
    const p = parseCsv(body);
    for (const e of p.errors) errors.push({ row: e.row, message: `CSV: ${e.message}` });
    records = p.rows.map((o, i) => ({ n: i + 2, o }));
    if (!p.headers.length) errors.push({ row: 1, message: 'No header row found.' });
  }

  let truncated = false;
  if (records.length > MAX_LOG_ROWS) {
    truncated = true;
    warnings.push(`File has ${records.length} records; only the first ${MAX_LOG_ROWS} were imported.`);
    records = records.slice(0, MAX_LOG_ROWS);
  }

  // ---------- map to rows ----------
  const unknown = new Set<string>();
  let relativeTime = 0;
  const rows: LogRow[] = [];
  const tsSummary: Record<TsStatus, number> = { explicit_offset: 0, assumed_timezone: 0, missing: 0, unparseable: 0 };

  for (const { n, o } of records) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      errors.push({ row: n, message: 'Record is not an object.' });
      continue;
    }
    const warn = (m: string) => rowWarnings.push(`Row ${n}: ${m}`);
    let r: Omit<LogRow, 'row_number' | 'normalized_ts' | 'ts_status'> & { tsInput: string | null; relative?: boolean };

    if (format === 'wireshark_csv') {
      const time = str(o['time']);
      const relative = !!time && /^-?\d+(\.\d+)?$/.test(time) && Number(time) < 1e8;
      if (relative) relativeTime++;
      r = {
        tsInput: relative ? null : time,
        original_timestamp: time,
        relative,
        source: str(o['source'], 255),
        destination: str(o['destination'], 255),
        src_port: port(o['src_port'] ?? o['source_port'] ?? o['srcport'], warn),
        dst_port: port(o['dst_port'] ?? o['destination_port'] ?? o['dstport'], warn),
        protocol: str(o['protocol'], 60),
        event_type: 'packet',
        message: str(o['info']),
        raw: o,
      };
    } else if (format === 'tshark_fields' || format === 'tshark_processed') {
      const epoch = str(o['frame.time_epoch']);
      r = {
        tsInput: epoch,
        original_timestamp: epoch ?? str(o['frame.time']),
        source: str(o['ip.src'] ?? o['ipv6.src'] ?? o['eth.src'], 255),
        destination: str(o['ip.dst'] ?? o['ipv6.dst'] ?? o['eth.dst'], 255),
        src_port: port(o['tcp.srcport'] || o['udp.srcport'], warn),
        dst_port: port(o['tcp.dstport'] || o['udp.dstport'], warn),
        protocol: str(o['_ws.col.protocol'] ?? o['_ws.col.Protocol'], 60),
        event_type: 'packet',
        message: str(o['_ws.col.info'] ?? o['_ws.col.Info']),
        raw: o,
      };
      if (!epoch && o['frame.time']) r.tsInput = str(o['frame.time']);
    } else if (format === 'tshark_json' || format === 'tshark_ek') {
      const layers = o?._source?.layers ?? o?.layers ?? {};
      const get = (layer: string, field: string) => {
        const L = layers[layer];
        if (!L) return null;
        const v = L[field] ?? L[field.replace(/\./g, '_')] ?? L[`${layer}_${field.replace(/\./g, '_')}`];
        return Array.isArray(v) ? v[0] : v;
      };
      const epoch = str(get('frame', 'frame.time_epoch') ?? o?.timestamp);
      const protos = str(get('frame', 'frame.protocols'));
      r = {
        tsInput: epoch,
        original_timestamp: epoch,
        source: str(get('ip', 'ip.src') ?? get('ipv6', 'ipv6.src'), 255),
        destination: str(get('ip', 'ip.dst') ?? get('ipv6', 'ipv6.dst'), 255),
        src_port: port(get('tcp', 'tcp.srcport') ?? get('udp', 'udp.srcport'), warn),
        dst_port: port(get('tcp', 'tcp.dstport') ?? get('udp', 'udp.dstport'), warn),
        protocol: protos ? protos.split(':').pop()!.toUpperCase() : null,
        event_type: 'packet',
        message: protos ? `Protocol stack: ${protos}` : null,
        raw: layers && Object.keys(layers).length ? { frame: layers.frame ?? null, ip: layers.ip ?? null, tcp: layers.tcp ?? null, udp: layers.udp ?? null } : o,
      };
      if (o?.timestamp && !get('frame', 'frame.time_epoch') && /^\d{13}$/.test(String(o.timestamp))) r.tsInput = String(o.timestamp);
    } else {
      // generic csv / json / jsonl
      const known = new Set<string>();
      const take = (f: keyof typeof FIELD_ALIASES) => {
        const [v, k] = pick(o, f);
        if (k) known.add(k);
        return v;
      };
      const ts = take('timestamp');
      r = {
        tsInput: ts,
        original_timestamp: ts,
        source: str(take('source'), 255),
        destination: str(take('destination'), 255),
        src_port: port(take('src_port'), warn),
        dst_port: port(take('dst_port'), warn),
        protocol: str(take('protocol'), 60),
        event_type: str(take('event_type'), 120),
        message: str(take('message')),
        raw: o,
      };
      for (const k of Object.keys(o)) if (!known.has(k) && !KNOWN_EXTRA.has(keyNorm(k))) unknown.add(k);
      // Extra fields commonly present are folded into the message for context, verbatim.
      const extras = Object.keys(o)
        .filter((k) => !known.has(k) && KNOWN_EXTRA.has(keyNorm(k)) && o[k] !== '' && o[k] !== null && o[k] !== undefined)
        .map((k) => `${k}=${typeof o[k] === 'object' ? JSON.stringify(o[k]) : o[k]}`);
      if (extras.length) r.message = [r.message, `[${extras.join(' ')}]`].filter(Boolean).join(' ');
    }

    const meaningful = r.original_timestamp || r.source || r.destination || r.message || r.event_type;
    if (!meaningful) {
      errors.push({ row: n, message: 'Row has no timestamp, hosts, event type or message; skipped.' });
      continue;
    }
    const t = r.relative ? { normalized: null, status: 'unparseable' as TsStatus } : normalizeTimestamp(r.tsInput, tz);
    if (!r.original_timestamp) t.status = 'missing';
    tsSummary[t.status]++;
    if (t.status === 'unparseable' && !r.relative) warn(`timestamp "${r.original_timestamp}" could not be placed on the clock; kept as original text only`);
    rows.push({
      row_number: n,
      original_timestamp: r.original_timestamp,
      normalized_ts: t.normalized,
      ts_status: t.status,
      source: r.source,
      destination: r.destination,
      src_port: r.src_port,
      dst_port: r.dst_port,
      protocol: r.protocol,
      event_type: r.event_type,
      message: r.message,
      raw: r.raw,
    });
  }

  if (relativeTime)
    warnings.push(
      `${relativeTime} row(s) have relative "Time" values (seconds since the first packet). Relative times cannot be placed on the clock, so these rows are marked unparseable. Re-export with absolute time (Wireshark View → Time Display Format → Date and Time of Day, or tshark -t ad / -e frame.time_epoch).`,
    );
  if (unknown.size) warnings.push(`Unmapped field(s) kept only in the raw record: ${[...unknown].slice(0, 20).join(', ')}`);
  if (tsSummary.missing) warnings.push(`${tsSummary.missing} row(s) have no timestamp; they were kept and marked "missing" (never assigned a time).`);
  if (tsSummary.assumed_timezone) warnings.push(`${tsSummary.assumed_timezone} timestamp(s) had no UTC offset and were interpreted in the declared source timezone (${tz}).`);
  const extraRowWarnings = rowWarnings.length > 50 ? [...rowWarnings.slice(0, 50), `…and ${rowWarnings.length - 50} more row warnings`] : rowWarnings;
  warnings.push(...extraRowWarnings);

  return {
    format,
    rows,
    total: records.length,
    skipped: records.length - rows.length,
    errors,
    warnings,
    truncated,
    analysis_scope: SCOPE_TEXT[format],
    ts_summary: tsSummary,
  };
}
