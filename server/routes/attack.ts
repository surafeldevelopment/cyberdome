import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, h, notFound, conflict, HttpError } from '../lib/http.js';
import crypto from 'node:crypto';
import { nextCode, nowIso, uid } from '../lib/codes.js';
import { parseJson } from '../db/index.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { resolveEvidence, setLinks, evidenceBrief, storeFileEvidence, evidenceAbsPath, type SourceCategory } from '../services/evidence.js';
import { parseLogs, type LogFormat, type LogParse } from '../importers/logs.js';
import { toCsv } from '../lib/csv.js';
import { isValidTimezone, normalizeTimestamp } from '../lib/time.js';
import { tsharkInfo } from './system.js';
import { runTshark, TSHARK_LIMITS } from '../services/tshark.js';
import type { Db } from '../db/index.js';

const SOURCE = z.enum(['authorized_lab', 'instructor_supplied', 'external_reference', 'demo', 'project_artifact']);
const CONF = z.enum(['unrated', 'high', 'medium', 'low', 'requires_more_evidence']);
const FORMATS = ['csv', 'jsonl', 'json', 'wireshark_csv', 'tshark_fields', 'tshark_json', 'tshark_ek'] as const;
const TECHNIQUE_RE = /^T\d{4}(\.\d{3})?$/;

/* ------------------------------------------------------------------ helpers */

function linkedEvidenceMap(db: Db, table: string, ownerCol: string, ownerTable: string, eid: string) {
  const rows = db.all(
    `SELECT l.${ownerCol} AS owner, e.id, e.code, e.title, e.status FROM ${table} l JOIN evidence e ON e.id = l.evidence_id JOIN ${ownerTable} o ON o.id = l.${ownerCol} WHERE o.engagement_id = ? ORDER BY e.code`,
    eid,
  );
  const m = new Map<string, any[]>();
  for (const r of rows) {
    if (!m.has(r.owner)) m.set(r.owner, []);
    m.get(r.owner)!.push({ id: r.id, code: r.code, title: r.title, status: r.status });
  }
  return m;
}

function insertLogImport(
  db: Db,
  eng: any,
  p: LogParse,
  opts: { evidenceId: string; format: LogFormat; tz: string; extraScope?: string },
) {
  const id = uid();
  const now = nowIso();
  const status = p.rows.length === 0 ? 'failed' : p.errors.length || p.truncated || p.skipped ? 'partial' : 'complete';
  let code = '';
  db.tx(() => {
    code = nextCode(db, eng.id, 'log_import');
    db.insert('log_imports', {
      id, engagement_id: eng.id, code, evidence_id: opts.evidenceId, format: opts.format, source_timezone: opts.tz, status,
      rows_total: p.total, rows_imported: p.rows.length, rows_skipped: p.skipped,
      analysis_scope: [p.analysis_scope, opts.extraScope].filter(Boolean).join(' '),
      warnings: p.warnings.slice(0, 200), errors: p.errors.slice(0, 500), created_by: currentActor(db), created_at: now,
    });
    for (const r of p.rows) {
      db.insert('log_events', {
        id: uid(), engagement_id: eng.id, log_import_id: id, evidence_id: opts.evidenceId, row_number: r.row_number,
        original_timestamp: r.original_timestamp, normalized_ts: r.normalized_ts, ts_status: r.ts_status,
        source: r.source, destination: r.destination, src_port: r.src_port, dst_port: r.dst_port, protocol: r.protocol,
        event_type: r.event_type, message: r.message, raw: JSON.stringify(r.raw).slice(0, 20000), flagged: 0, created_at: now,
      });
    }
    logActivity(db, eng.id, 'logs.imported', 'log_import', `${code}: imported ${p.rows.length} of ${p.total} ${opts.format} record(s) (${status})`, { id, code });
  });
  return { id, code, status };
}

function logImportDetail(db: Db, eid: string, id: string) {
  const li = db.get(
    'SELECT li.*, e.code AS evidence_code, e.title AS evidence_title, e.original_filename, e.sha256 FROM log_imports li LEFT JOIN evidence e ON e.id = li.evidence_id WHERE li.engagement_id = ? AND (li.id = ? OR li.code = ?)',
    eid, id, id,
  );
  if (!li) throw notFound('Log import');
  const ts = db.all('SELECT ts_status, COUNT(*) n FROM log_events WHERE log_import_id = ? GROUP BY ts_status', li.id);
  const range = db.get('SELECT MIN(normalized_ts) first, MAX(normalized_ts) last FROM log_events WHERE log_import_id = ?', li.id);
  return { ...li, warnings: parseJson(li.warnings, []), errors: parseJson(li.errors, []), ts_summary: Object.fromEntries(ts.map((t) => [t.ts_status, t.n])), first_event: range?.first ?? null, last_event: range?.last ?? null };
}

function timelineDetail(db: Db, eid: string, id: string) {
  const t = db.get('SELECT * FROM timeline_events WHERE engagement_id = ? AND (id = ? OR code = ?)', eid, id, id);
  if (!t) throw notFound('Timeline event');
  return {
    ...t,
    evidence: evidenceBrief(db, 'timeline_evidence', 'timeline_id', t.id),
    log_event: t.log_event_id ? db.get('SELECT id, row_number, original_timestamp, message, log_import_id FROM log_events WHERE id = ?', t.log_event_id) : null,
    mappings: db.all("SELECT * FROM attack_mappings WHERE target_type = 'timeline' AND target_id = ? ORDER BY created_at", t.id),
  };
}

function indicatorDetail(db: Db, eid: string, id: string) {
  const i = db.get('SELECT * FROM indicators WHERE engagement_id = ? AND (id = ? OR code = ?)', eid, id, id);
  if (!i) throw notFound('Indicator');
  return {
    ...i,
    evidence: evidenceBrief(db, 'indicator_evidence', 'indicator_id', i.id),
    mappings: db.all("SELECT * FROM attack_mappings WHERE target_type = 'indicator' AND target_id = ? ORDER BY created_at", i.id),
  };
}

function targetLabel(db: Db, eid: string, type: string, targetId: string) {
  const table = type === 'finding' ? 'findings' : type === 'timeline' ? 'timeline_events' : 'indicators';
  const col = type === 'finding' ? 'title' : type === 'timeline' ? 'observation' : 'title';
  const extra = type === 'indicator' ? ', lab' : '';
  return db.get(`SELECT id, code, ${col} AS label${extra} FROM ${table} WHERE engagement_id = ? AND (id = ? OR code = ?)`, eid, targetId, targetId);
}

async function lookupTechniqueSafe(tid: string): Promise<{ name?: string; tactics?: string } | null> {
  try {
    const mod: any = await import('../services/refs.js' as string);
    if (typeof mod.lookupTechnique !== 'function') return null;
    const t = await mod.lookupTechnique(tid);
    if (!t) return null;
    return { name: t.name, tactics: Array.isArray(t.tactics) ? t.tactics.join(', ') : t.tactics };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ schemas */

const timelineSchema = z
  .object({
    original_timestamp: z.string().max(100).nullable().optional(),
    normalized_ts: z.string().max(40).nullable().optional(),
    source_timezone: z.string().max(64).optional(),
    timezone_note: z.string().max(500).optional(),
    time_certainty: z.enum(['exact', 'approximate', 'unknown']).optional(),
    order_certainty: z.enum(['established', 'uncertain']).optional(),
    sequence_hint: z.number().int().min(0).max(1_000_000).nullable().optional(),
    source_host: z.string().max(255).optional(),
    dest_host: z.string().max(255).optional(),
    event_type: z.string().max(120).optional(),
    observation: z.string().trim().min(1).max(10000),
    student_interpretation: z.string().max(10000).optional(),
    confidence: CONF.optional(),
    verification_status: z.enum(['fact', 'assumption', 'requires_more_evidence']).optional(),
    evidence_ids: z.array(z.string()).optional(),
  })
  .strict();

const indicatorSchema = z
  .object({
    lab: z.enum(['lab1', 'lab5']),
    title: z.string().trim().min(1).max(300),
    indicator_type: z.string().max(60).optional(),
    value: z.string().max(2000).optional(),
    observation: z.string().max(10000).optional(),
    why_suspicious: z.string().max(10000).optional(),
    benign_explanations: z.string().max(10000).optional(),
    additional_evidence_needed: z.string().max(10000).optional(),
    confidence: CONF.optional(),
    assessment: z.enum(['unassessed', 'suspicious', 'benign', 'requires_more_evidence']).optional(),
    analyst_assessment: z.string().max(10000).optional(),
    source_host: z.string().max(255).optional(),
    dest_host: z.string().max(255).optional(),
    observed_at: z.string().max(100).nullable().optional(),
    source_timezone: z.string().max(64).optional(),
    evidence_ids: z.array(z.string()).optional(),
  })
  .strict();

const mappingSchema = z
  .object({
    target_type: z.enum(['finding', 'timeline', 'indicator']),
    target_id: z.string().min(1),
    technique_id: z.string().trim().toUpperCase().regex(TECHNIQUE_RE, 'Technique ID must look like T1110 or T1110.001'),
    technique_name: z.string().max(300).optional(),
    tactics: z.string().max(300).optional(),
    rationale: z.string().max(4000).optional(),
    origin: z.enum(['analyst', 'ai_suggested']).optional(),
    ai_session_id: z.string().nullable().optional(),
  })
  .strict();

/** Resolve a manually entered timestamp: keep the original text, normalize without guessing. */
function resolveTime(input: string | null | undefined, tz: string) {
  if (!input) return { original: null, normalized: null, status: 'missing' as const };
  return normalizeTimestamp(input, tz);
}

/* ------------------------------------------------------------------ routes */

export default function attackRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db, cfg } = ctx;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadBytes, files: 1 } });

  const tzOf = (eng: any, v: unknown) => {
    const tz = typeof v === 'string' && v ? v : eng.timezone || 'UTC';
    if (!isValidTimezone(tz)) throw badRequest(`Unknown timezone: ${tz}`);
    return tz;
  };
  const formatOf = (v: unknown): LogFormat | undefined => {
    if (!v || v === 'auto') return undefined;
    if (!(FORMATS as readonly string[]).includes(String(v))) throw badRequest(`Unsupported format: ${v}`);
    return v as LogFormat;
  };

  /* ---------- log imports ---------- */

  r.post('/log-imports/preview', upload.single('file'), h((req, res) => {
    const eng = engagementFrom(ctx, req);
    if (!req.file) throw badRequest('Choose a log or packet-export file to preview.');
    const tz = tzOf(eng, req.body?.source_timezone);
    const p = parseLogs(req.file.buffer.toString('utf8'), { filename: req.file.originalname, format: formatOf(req.body?.format), sourceTz: tz });
    const dup = db.get(
      "SELECT li.code, e.code AS evidence_code FROM log_imports li JOIN evidence e ON e.id = li.evidence_id WHERE li.engagement_id = ? AND e.sha256 = ? AND e.status = 'active' LIMIT 1",
      eng.id,
      require_sha(req.file.buffer),
    );
    res.json({ ...p, rows: p.rows.slice(0, 100), row_count: p.rows.length, source_timezone: tz, duplicate_of: dup ?? null });
  }));

  r.post('/log-imports', upload.single('file'), h((req, res) => {
    const eng = engagementFrom(ctx, req);
    if (!req.file) throw badRequest('Choose a log or packet-export file to import.');
    const tz = tzOf(eng, req.body?.source_timezone);
    const sourceCategory = (eng.is_demo ? 'demo' : SOURCE.parse(req.body?.source_category ?? 'instructor_supplied')) as SourceCategory;
    const p = parseLogs(req.file.buffer.toString('utf8'), { filename: req.file.originalname, format: formatOf(req.body?.format), sourceTz: tz });
    if (!p.rows.length) throw badRequest('No usable records were found. Nothing was imported.', { errors: p.errors.slice(0, 50), warnings: p.warnings.slice(0, 20) });
    if (req.body?.allow_duplicate !== 'true') {
      const sha = require_sha(req.file.buffer);
      const dup = db.get(
        "SELECT li.code FROM log_imports li JOIN evidence e ON e.id = li.evidence_id WHERE li.engagement_id = ? AND e.sha256 = ? AND e.status = 'active' LIMIT 1",
        eng.id, sha,
      );
      if (dup) throw conflict(`This exact file was already imported as ${dup.code}. Re-importing would duplicate events. Confirm to import it again anyway.`, { duplicate_of: dup.code });
    }
    const ev = storeFileEvidence(db, cfg, {
      engagementId: eng.id,
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      sourceCategory,
      sourceTool: String(req.body?.source_tool || (p.format.startsWith('tshark') || p.format === 'wireshark_csv' ? 'Wireshark/tshark export' : 'Log file')).slice(0, 200),
      title: `Log import: ${req.file.originalname}`,
      collectedAtNote: 'Event times are recorded per row in the imported log events.',
      observation: `${p.format} file with ${p.total} record(s).`,
      tags: ['logs', p.format],
      analysisStatus: 'parsed',
      analysisNote: p.analysis_scope,
    });
    const li = insertLogImport(db, eng, p, { evidenceId: ev.id, format: p.format, tz });
    res.status(201).json({ ...logImportDetail(db, eng.id, li.id), evidence_duplicate_of: ev.duplicateOf });
  }));

  r.get('/log-imports', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(
      db.all(
        'SELECT li.*, e.code AS evidence_code, e.original_filename FROM log_imports li LEFT JOIN evidence e ON e.id = li.evidence_id WHERE li.engagement_id = ? ORDER BY li.created_at DESC',
        eng.id,
      ).map((x) => ({ ...x, warnings: parseJson(x.warnings, []), errors: parseJson(x.errors, []) })),
    );
  }));

  r.get('/log-imports/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(logImportDetail(db, eng.id, req.params.id));
  }));

  r.get('/logs-template.csv', h((_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="logs-template.csv"');
    res.send('timestamp,source,destination,src_port,dst_port,protocol,event_type,message\n2026-10-08T10:03:00-04:00,<source ip>,<destination ip>,<src port>,<dst port>,TCP,<event type>,<original log message>\n');
  }));

  /* ---------- PCAP processing ---------- */

  r.get('/pcap-evidence', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const ts = tsharkInfo(ctx);
    const rows = db.all(
      "SELECT id, code, title, original_filename, size_bytes, sha256, detected_type, analysis_status, analysis_note, status, kind, reference_uri FROM evidence WHERE engagement_id = ? AND (detected_type IN ('pcap','pcapng') OR (kind = 'reference' AND (lower(reference_uri) LIKE '%.pcap' OR lower(reference_uri) LIKE '%.pcapng' OR tags LIKE '%\"pcap\"%'))) ORDER BY code",
      eng.id,
    );
    const imports = db.all(
      "SELECT li.id, li.code, li.status, li.rows_imported, e.derived_from_id FROM log_imports li JOIN evidence e ON e.id = li.evidence_id WHERE li.engagement_id = ? AND li.format = 'tshark_processed'",
      eng.id,
    );
    res.json({
      tshark: { available: !!ts.path, version: ts.version },
      limits: { max_file_mb: TSHARK_LIMITS.maxFileBytes / 1024 / 1024, max_packets: TSHARK_LIMITS.maxPackets, timeout_s: TSHARK_LIMITS.timeoutMs / 1000 },
      captures: rows.map((r) => ({ ...r, processed_imports: imports.filter((i) => i.derived_from_id === r.id) })),
    });
  }));

  r.post('/evidence/:id/tshark-process', h(async (req, res) => {
    const eng = engagementFrom(ctx, req);
    const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!ev) throw notFound('Evidence');
    if (ev.kind !== 'file' || !['pcap', 'pcapng'].includes(ev.detected_type)) throw badRequest('Only stored PCAP/PCAPNG files can be processed. References are not stored in this application.');
    if (ev.status !== 'active') throw badRequest('This evidence has been withdrawn.');
    const ts = tsharkInfo(ctx);
    if (!ts.path) throw new HttpError(503, 'tshark is not installed or not on PATH. The capture remains stored; no packet analysis was performed.');
    const file = evidenceAbsPath(cfg, ev);
    if (!file) throw notFound('Stored capture file');
    const maxPackets = Number(req.body?.max_packets ?? TSHARK_LIMITS.maxPackets);
    if (!Number.isInteger(maxPackets) || maxPackets < 1) throw badRequest('max_packets must be a positive integer.');
    let out;
    try {
      out = await runTshark(ts.path, file, maxPackets);
    } catch (e: any) {
      logActivity(db, eng.id, 'pcap.tshark_failed', 'evidence', `tshark processing of ${ev.code} failed: ${e.message}`, { id: ev.id, code: ev.code });
      throw badRequest(e.message);
    }
    const tz = eng.timezone || 'UTC';
    const p = parseLogs(out.csv, { format: 'tshark_processed', sourceTz: tz });
    const capped = p.rows.length >= Math.min(maxPackets, TSHARK_LIMITS.maxPackets);
    if (capped) p.warnings.unshift(`Processing stopped at the ${Math.min(maxPackets, TSHARK_LIMITS.maxPackets)}-packet limit; later packets were not read.`);
    const derived = storeFileEvidence(db, cfg, {
      engagementId: eng.id,
      buffer: Buffer.from(out.csv, 'utf8'),
      originalFilename: `${ev.code}-tshark-fields.csv`,
      sourceCategory: ev.source_category,
      sourceTool: ts.version ?? 'tshark',
      title: `${ev.title} (tshark packet summary)`,
      collectedAt: ev.collected_at,
      observation: `Packet summary fields extracted locally by tshark from ${ev.code} (SHA-256 ${ev.sha256}).`,
      tags: ['pcap', 'tshark', 'derived'],
      sanitizationStatus: ev.sanitization_status,
      derivedFromId: ev.id,
      derivationNote: `tshark ${out.args.filter((a) => a !== file).join(' ')}`,
      analysisStatus: 'parsed',
      analysisNote: p.analysis_scope,
    });
    const li = insertLogImport(db, eng, p, {
      evidenceId: derived.id,
      format: 'tshark_processed',
      tz,
      extraScope: `Source capture ${ev.code}; ${p.rows.length} packet(s) read${capped ? ' (packet limit reached)' : ''}.`,
    });
    db.update('evidence', ev.id, {
      analysis_status: 'tshark_processed',
      analysis_note: `Processed locally with ${ts.version ?? 'tshark'} on ${nowIso()}: ${p.rows.length} packet summaries (frame time, IP addresses, ports, protocol, Info) imported as ${li.code} via derived evidence ${derived.code}. Payloads were not analyzed.`,
      updated_at: nowIso(),
    });
    db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: 'tshark_processed', notes: `Derived ${derived.code}; import ${li.code}.`, created_at: nowIso() });
    res.status(201).json({ ...logImportDetail(db, eng.id, li.id), derived_evidence: { id: derived.id, code: derived.code } });
  }));

  /* ---------- log events ---------- */

  function eventsQuery(eid: string, q: Record<string, any>) {
    const where = ['le.engagement_id = ?'];
    const p: any[] = [eid];
    if (q.q) {
      where.push('(le.message LIKE ? OR le.source LIKE ? OR le.destination LIKE ? OR le.event_type LIKE ? OR le.original_timestamp LIKE ?)');
      const like = `%${q.q}%`;
      p.push(like, like, like, like, like);
    }
    if (q.source) { where.push('le.source = ?'); p.push(q.source); }
    if (q.destination) { where.push('le.destination = ?'); p.push(q.destination); }
    if (q.host) { where.push('(le.source = ? OR le.destination = ?)'); p.push(q.host, q.host); }
    if (q.event_type) { where.push('le.event_type = ?'); p.push(q.event_type); }
    if (q.protocol) { where.push('le.protocol = ?'); p.push(q.protocol); }
    if (q.ts_status) { where.push('le.ts_status = ?'); p.push(q.ts_status); }
    if (q.port) { where.push('(le.src_port = ? OR le.dst_port = ?)'); p.push(Number(q.port), Number(q.port)); }
    if (q.flagged === '1') where.push('le.flagged = 1');
    if (q.import) { where.push('le.log_import_id = ?'); p.push(q.import); }
    if (q.from) { where.push('le.normalized_ts >= ?'); p.push(q.from); }
    if (q.to) { where.push('le.normalized_ts <= ?'); p.push(q.to); }
    return { where: where.join(' AND '), params: p };
  }

  r.get('/log-events', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const q = req.query as Record<string, any>;
    const { where, params } = eventsQuery(eng.id, q);
    const total = db.scalar<number>(`SELECT COUNT(*) FROM log_events le WHERE ${where}`, ...params);
    const limit = Math.min(Number(q.limit ?? 100), 1000);
    const offset = Math.max(0, Number(q.offset ?? 0));
    const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
    const items = db.all(
      `SELECT le.*, li.code AS import_code, e.code AS evidence_code, e.status AS evidence_status,
         (SELECT t.code FROM timeline_events t WHERE t.log_event_id = le.id LIMIT 1) AS timeline_code,
         (SELECT t.id FROM timeline_events t WHERE t.log_event_id = le.id LIMIT 1) AS timeline_id
       FROM log_events le JOIN log_imports li ON li.id = le.log_import_id LEFT JOIN evidence e ON e.id = le.evidence_id
       WHERE ${where} ORDER BY (le.normalized_ts IS NULL), le.normalized_ts ${dir}, li.created_at, le.row_number LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    ).map((x) => ({ ...x, raw: parseJson(x.raw, {}), flagged: !!x.flagged }));
    const facets = {
      event_types: db.all("SELECT event_type v, COUNT(*) n FROM log_events WHERE engagement_id = ? AND event_type IS NOT NULL GROUP BY event_type ORDER BY n DESC LIMIT 50", eng.id),
      protocols: db.all("SELECT protocol v, COUNT(*) n FROM log_events WHERE engagement_id = ? AND protocol IS NOT NULL GROUP BY protocol ORDER BY n DESC LIMIT 50", eng.id),
      sources: db.all("SELECT source v, COUNT(*) n FROM log_events WHERE engagement_id = ? AND source IS NOT NULL GROUP BY source ORDER BY n DESC LIMIT 50", eng.id),
      destinations: db.all("SELECT destination v, COUNT(*) n FROM log_events WHERE engagement_id = ? AND destination IS NOT NULL GROUP BY destination ORDER BY n DESC LIMIT 50", eng.id),
      ts_status: db.all('SELECT ts_status v, COUNT(*) n FROM log_events WHERE engagement_id = ? GROUP BY ts_status', eng.id),
    };
    res.json({ items, total, facets });
  }));

  r.patch('/log-events/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const ev = db.get('SELECT * FROM log_events WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!ev) throw notFound('Log event');
    const b = z.object({ flagged: z.boolean() }).strict().parse(req.body);
    db.run('UPDATE log_events SET flagged = ? WHERE id = ?', b.flagged ? 1 : 0, ev.id);
    logActivity(db, eng.id, 'logs.flagged', 'log_event', `${b.flagged ? 'Flagged' : 'Unflagged'} log event (row ${ev.row_number}${ev.original_timestamp ? `, ${ev.original_timestamp}` : ''})`, { id: ev.id });
    res.json({ ok: true, flagged: b.flagged });
  }));

  r.get('/exports/log-events.csv', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const { where, params } = eventsQuery(eng.id, req.query as any);
    const rows = db.all(
      `SELECT li.code AS import_code, e.code AS evidence_id, le.row_number, le.original_timestamp, le.normalized_ts AS normalized_utc, le.ts_status, li.source_timezone,
         le.source, le.src_port, le.destination, le.dst_port, le.protocol, le.event_type, le.message, le.flagged
       FROM log_events le JOIN log_imports li ON li.id = le.log_import_id LEFT JOIN evidence e ON e.id = le.evidence_id
       WHERE ${where} ORDER BY (le.normalized_ts IS NULL), le.normalized_ts, li.created_at, le.row_number`,
      ...params,
    );
    logActivity(db, eng.id, 'export.log_events', 'export', `Exported ${rows.length} log events`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="log-events-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(rows, ['import_code', 'evidence_id', 'row_number', 'original_timestamp', 'normalized_utc', 'ts_status', 'source_timezone', 'source', 'src_port', 'destination', 'dst_port', 'protocol', 'event_type', 'message', 'flagged']));
  }));

  /* ---------- timeline ---------- */

  function listTimeline(eid: string) {
    const rows = db.all<any>('SELECT * FROM timeline_events WHERE engagement_id = ?', eid);
    const ev = linkedEvidenceMap(db, 'timeline_evidence', 'timeline_id', 'timeline_events', eid);
    const maps = db.all("SELECT target_id, technique_id, status FROM attack_mappings WHERE engagement_id = ? AND target_type = 'timeline'", eid);
    return rows
      .map((t) => ({ ...t, evidence: ev.get(t.id) ?? [], mappings: maps.filter((m) => m.target_id === t.id) }))
      .sort((a, b) => {
        if (a.normalized_ts && b.normalized_ts) return a.normalized_ts < b.normalized_ts ? -1 : a.normalized_ts > b.normalized_ts ? 1 : (a.sequence_hint ?? 0) - (b.sequence_hint ?? 0);
        if (a.normalized_ts) return -1;
        if (b.normalized_ts) return 1;
        return (a.sequence_hint ?? 1e9) - (b.sequence_hint ?? 1e9) || a.created_at.localeCompare(b.created_at);
      });
  }

  r.get('/timeline', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(listTimeline(eng.id));
  }));

  r.get('/timeline/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(timelineDetail(db, eng.id, req.params.id));
  }));

  function timeFields(eng: any, b: z.infer<typeof timelineSchema> | Partial<z.infer<typeof timelineSchema>>, existing?: any) {
    const out: Record<string, any> = {};
    if (b.original_timestamp !== undefined || b.normalized_ts !== undefined) {
      const tz = tzOf(eng, b.source_timezone);
      if (b.original_timestamp) {
        const t = resolveTime(b.original_timestamp, tz);
        out.original_timestamp = b.original_timestamp;
        out.normalized_ts = t.normalized;
        if (!b.timezone_note) out.timezone_note = t.status === 'assumed_timezone' ? `No offset in source; interpreted as ${tz}.` : t.status === 'explicit_offset' ? 'Explicit offset in source; converted to UTC.' : 'Time could not be placed on the clock.';
        if (!t.normalized) out.time_certainty = 'unknown';
      } else if (b.normalized_ts) {
        const d = new Date(b.normalized_ts);
        if (isNaN(d.getTime())) throw badRequest('normalized_ts must be an ISO timestamp.');
        out.normalized_ts = d.toISOString();
        out.original_timestamp = existing?.original_timestamp ?? b.normalized_ts;
      } else {
        out.original_timestamp = null;
        out.normalized_ts = null;
        out.time_certainty = 'unknown';
      }
    }
    return out;
  }

  r.post('/timeline', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = timelineSchema.parse(req.body);
    const evidence = resolveEvidence(db, eng.id, b.evidence_ids);
    const id = uid();
    const now = nowIso();
    let code = '';
    const tf = timeFields(eng, { ...b, original_timestamp: b.original_timestamp ?? null });
    db.tx(() => {
      code = nextCode(db, eng.id, 'timeline');
      db.insert('timeline_events', {
        id, engagement_id: eng.id, code,
        original_timestamp: tf.original_timestamp ?? null, normalized_ts: tf.normalized_ts ?? null,
        timezone_note: b.timezone_note ?? tf.timezone_note ?? '',
        time_certainty: tf.time_certainty ?? b.time_certainty ?? (tf.normalized_ts ? 'exact' : 'unknown'),
        order_certainty: b.order_certainty ?? 'established', sequence_hint: b.sequence_hint ?? null,
        source_host: b.source_host ?? '', dest_host: b.dest_host ?? '', event_type: b.event_type ?? '',
        observation: b.observation, student_interpretation: b.student_interpretation ?? '',
        confidence: b.confidence ?? 'unrated', verification_status: b.verification_status ?? 'requires_more_evidence',
        created_at: now, updated_at: now,
      });
      setLinks(db, 'timeline_evidence', 'timeline_id', id, 'evidence_id', evidence.map((e) => e.id));
      logActivity(db, eng.id, 'timeline.created', 'timeline', `Added timeline event ${code}`, { id, code });
    });
    res.status(201).json(timelineDetail(db, eng.id, id));
  }));

  r.post('/timeline/from-log-event/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const le = db.get('SELECT le.*, li.source_timezone FROM log_events le JOIN log_imports li ON li.id = le.log_import_id WHERE le.engagement_id = ? AND le.id = ?', eng.id, req.params.id);
    if (!le) throw notFound('Log event');
    const existing = db.get('SELECT code FROM timeline_events WHERE log_event_id = ?', le.id);
    if (existing) throw conflict(`This log event is already on the timeline as ${existing.code}.`);
    const id = uid();
    const now = nowIso();
    let code = '';
    const tzNote =
      le.ts_status === 'explicit_offset' ? 'Explicit offset in source; converted to UTC.' :
      le.ts_status === 'assumed_timezone' ? `No offset in source; interpreted as ${le.source_timezone}.` :
      le.ts_status === 'missing' ? 'Source row had no timestamp.' : 'Source timestamp could not be placed on the clock.';
    db.tx(() => {
      code = nextCode(db, eng.id, 'timeline');
      db.insert('timeline_events', {
        id, engagement_id: eng.id, code, original_timestamp: le.original_timestamp, normalized_ts: le.normalized_ts, timezone_note: tzNote,
        time_certainty: le.normalized_ts ? 'exact' : 'unknown', order_certainty: le.normalized_ts ? 'established' : 'uncertain',
        source_host: [le.source, le.src_port].filter((x) => x !== null && x !== undefined && x !== '').join(':'),
        dest_host: [le.destination, le.dst_port].filter((x) => x !== null && x !== undefined && x !== '').join(':'),
        event_type: le.event_type ?? '', observation: (le.message || `${le.event_type ?? 'Event'} ${le.source ?? ''} → ${le.destination ?? ''}`).slice(0, 10000),
        student_interpretation: '', confidence: 'unrated', verification_status: 'requires_more_evidence', log_event_id: le.id, created_at: now, updated_at: now,
      });
      if (le.evidence_id) db.run('INSERT OR IGNORE INTO timeline_evidence (timeline_id, evidence_id) VALUES (?,?)', id, le.evidence_id);
      db.run('UPDATE log_events SET flagged = 1 WHERE id = ?', le.id);
      logActivity(db, eng.id, 'timeline.created', 'timeline', `Added timeline event ${code} from log row ${le.row_number}`, { id, code });
    });
    res.status(201).json(timelineDetail(db, eng.id, id));
  }));

  r.patch('/timeline/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const t = db.get('SELECT * FROM timeline_events WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!t) throw notFound('Timeline event');
    const b = timelineSchema.partial().strict().parse(req.body);
    const { evidence_ids, source_timezone: _tz, ...fields } = b;
    const evidence = evidence_ids ? resolveEvidence(db, eng.id, evidence_ids) : null;
    const tf = timeFields(eng, b, t);
    db.tx(() => {
      db.update('timeline_events', t.id, { ...fields, ...tf, timezone_note: b.timezone_note ?? tf.timezone_note, updated_at: nowIso() });
      if (evidence) setLinks(db, 'timeline_evidence', 'timeline_id', t.id, 'evidence_id', evidence.map((e) => e.id));
      logActivity(db, eng.id, 'timeline.updated', 'timeline', `Updated timeline event ${t.code} (${Object.keys(b).join(', ')})`, { id: t.id, code: t.code });
    });
    res.json(timelineDetail(db, eng.id, t.id));
  }));

  r.delete('/timeline/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const t = db.get('SELECT * FROM timeline_events WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!t) throw notFound('Timeline event');
    db.tx(() => {
      db.run("DELETE FROM attack_mappings WHERE target_type = 'timeline' AND target_id = ?", t.id);
      db.run('DELETE FROM timeline_events WHERE id = ?', t.id);
      logActivity(db, eng.id, 'timeline.deleted', 'timeline', `Removed timeline event ${t.code} (code retired; evidence kept)`, { id: t.id, code: t.code });
    });
    res.json({ ok: true });
  }));

  r.get('/exports/timeline.csv', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = listTimeline(eng.id).map((t) => ({
      code: t.code, original_timestamp: t.original_timestamp ?? '', normalized_utc: t.normalized_ts ?? '', timezone_note: t.timezone_note, time_certainty: t.time_certainty,
      order_certainty: t.order_certainty, sequence_hint: t.sequence_hint ?? '', source: t.source_host, destination: t.dest_host, event_type: t.event_type,
      observation: t.observation, student_interpretation: t.student_interpretation, confidence: t.confidence, verification_status: t.verification_status,
      evidence: t.evidence.map((e: any) => e.code).join('; '), attack_techniques: t.mappings.filter((m: any) => m.status === 'verified').map((m: any) => m.technique_id).join('; '),
    }));
    logActivity(db, eng.id, 'export.timeline', 'export', `Exported timeline (${rows.length} events)`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="timeline-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(rows, ['code', 'original_timestamp', 'normalized_utc', 'timezone_note', 'time_certainty', 'order_certainty', 'sequence_hint', 'source', 'destination', 'event_type', 'observation', 'student_interpretation', 'confidence', 'verification_status', 'evidence', 'attack_techniques']));
  }));

  /* ---------- indicators ---------- */

  function listIndicators(eid: string, lab?: string) {
    const rows = lab
      ? db.all<any>('SELECT * FROM indicators WHERE engagement_id = ? AND lab = ? ORDER BY created_at', eid, lab)
      : db.all<any>('SELECT * FROM indicators WHERE engagement_id = ? ORDER BY lab, created_at', eid);
    const ev = linkedEvidenceMap(db, 'indicator_evidence', 'indicator_id', 'indicators', eid);
    return rows.map((i) => ({ ...i, evidence: ev.get(i.id) ?? [] }));
  }

  r.get('/indicators', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const lab = typeof req.query.lab === 'string' && ['lab1', 'lab5'].includes(req.query.lab) ? req.query.lab : undefined;
    res.json(listIndicators(eng.id, lab));
  }));

  r.get('/indicators/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(indicatorDetail(db, eng.id, req.params.id));
  }));

  r.post('/indicators', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = indicatorSchema.parse(req.body);
    const evidence = resolveEvidence(db, eng.id, b.evidence_ids);
    const tz = tzOf(eng, b.source_timezone);
    const t = resolveTime(b.observed_at, tz);
    const id = uid();
    const now = nowIso();
    let code = '';
    db.tx(() => {
      code = nextCode(db, eng.id, 'indicator');
      db.insert('indicators', {
        id, engagement_id: eng.id, code, lab: b.lab, title: b.title, indicator_type: b.indicator_type ?? 'other', value: b.value ?? '',
        observation: b.observation ?? '', why_suspicious: b.why_suspicious ?? '', benign_explanations: b.benign_explanations ?? '',
        additional_evidence_needed: b.additional_evidence_needed ?? '', confidence: b.confidence ?? 'unrated', assessment: b.assessment ?? 'unassessed',
        analyst_assessment: b.analyst_assessment ?? '', source_host: b.source_host ?? '', dest_host: b.dest_host ?? '',
        observed_at: t.normalized, observed_at_original: b.observed_at || null, created_at: now, updated_at: now,
      });
      setLinks(db, 'indicator_evidence', 'indicator_id', id, 'evidence_id', evidence.map((e) => e.id));
      logActivity(db, eng.id, 'indicator.created', 'indicator', `Added ${b.lab === 'lab1' ? 'sign of compromise' : 'indicator'} ${code}: ${b.title}`, { id, code });
    });
    res.status(201).json(indicatorDetail(db, eng.id, id));
  }));

  r.patch('/indicators/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const i = db.get('SELECT * FROM indicators WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!i) throw notFound('Indicator');
    const b = indicatorSchema.partial().strict().parse(req.body);
    const { evidence_ids, source_timezone, observed_at, ...fields } = b;
    const evidence = evidence_ids ? resolveEvidence(db, eng.id, evidence_ids) : null;
    const patch: Record<string, any> = { ...fields, updated_at: nowIso() };
    if (observed_at !== undefined) {
      const t = resolveTime(observed_at, tzOf(eng, source_timezone));
      patch.observed_at = t.normalized;
      patch.observed_at_original = observed_at || null;
    }
    db.tx(() => {
      db.update('indicators', i.id, patch);
      if (evidence) setLinks(db, 'indicator_evidence', 'indicator_id', i.id, 'evidence_id', evidence.map((e) => e.id));
      const what = b.assessment && b.assessment !== i.assessment ? `assessed as ${b.assessment.replace(/_/g, ' ')}` : `updated (${Object.keys(b).join(', ')})`;
      logActivity(db, eng.id, 'indicator.updated', 'indicator', `${i.code} ${what}`, { id: i.id, code: i.code });
    });
    res.json(indicatorDetail(db, eng.id, i.id));
  }));

  r.delete('/indicators/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const i = db.get('SELECT * FROM indicators WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!i) throw notFound('Indicator');
    db.tx(() => {
      db.run("DELETE FROM attack_mappings WHERE target_type = 'indicator' AND target_id = ?", i.id);
      db.run('DELETE FROM indicators WHERE id = ?', i.id);
      logActivity(db, eng.id, 'indicator.deleted', 'indicator', `Removed indicator ${i.code} (code retired; evidence kept)`, { id: i.id, code: i.code });
    });
    res.json({ ok: true });
  }));

  r.get('/exports/indicators.csv', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const lab = typeof req.query.lab === 'string' ? req.query.lab : undefined;
    const rows = listIndicators(eng.id, lab).map((i) => ({
      code: i.code, lab: i.lab, title: i.title, indicator_type: i.indicator_type, value: i.value, source_host: i.source_host, dest_host: i.dest_host,
      observed_at_original: i.observed_at_original ?? '', observed_at_utc: i.observed_at ?? '', observation: i.observation, why_suspicious: i.why_suspicious,
      benign_explanations: i.benign_explanations, additional_evidence_needed: i.additional_evidence_needed, confidence: i.confidence, assessment: i.assessment,
      analyst_assessment: i.analyst_assessment, evidence: i.evidence.map((e: any) => e.code).join('; '),
    }));
    logActivity(db, eng.id, 'export.indicators', 'export', `Exported indicators (${rows.length})`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="indicators-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(rows, Object.keys(rows[0] ?? { code: '', lab: '', title: '', indicator_type: '', value: '', source_host: '', dest_host: '', observed_at_original: '', observed_at_utc: '', observation: '', why_suspicious: '', benign_explanations: '', additional_evidence_needed: '', confidence: '', assessment: '', analyst_assessment: '', evidence: '' })));
  }));

  /* ---------- ATT&CK mappings ---------- */

  function listMappings(eid: string) {
    return db.all<any>('SELECT m.*, s.code AS ai_session_code FROM attack_mappings m LEFT JOIN ai_sessions s ON s.id = m.ai_session_id WHERE m.engagement_id = ? ORDER BY m.created_at DESC', eid).map((m) => ({
      ...m,
      target: targetLabel(db, eid, m.target_type, m.target_id) ?? null,
    }));
  }

  r.get('/attack-mappings', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(listMappings(eng.id));
  }));

  r.post('/attack-mappings', h(async (req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = mappingSchema.parse(req.body);
    const target = targetLabel(db, eng.id, b.target_type, b.target_id);
    if (!target) throw badRequest(`Unknown ${b.target_type} for this engagement.`);
    if (b.ai_session_id && !db.get('SELECT id FROM ai_sessions WHERE engagement_id = ? AND id = ?', eng.id, b.ai_session_id)) throw badRequest('Unknown AI session.');
    const ref = !b.technique_name ? await lookupTechniqueSafe(b.technique_id) : null;
    const dupe = db.get("SELECT id FROM attack_mappings WHERE engagement_id = ? AND target_type = ? AND target_id = ? AND technique_id = ? AND status <> 'rejected'", eng.id, b.target_type, target.id, b.technique_id);
    if (dupe) throw conflict(`${b.technique_id} is already mapped to ${target.code}.`);
    const id = uid();
    const now = nowIso();
    db.insert('attack_mappings', {
      id, engagement_id: eng.id, target_type: b.target_type, target_id: target.id, technique_id: b.technique_id,
      technique_name: b.technique_name ?? ref?.name ?? '', tactics: b.tactics ?? ref?.tactics ?? '', rationale: b.rationale ?? '',
      origin: b.origin ?? 'analyst', status: 'proposed', ai_session_id: b.ai_session_id ?? null, created_at: now, updated_at: now,
    });
    logActivity(db, eng.id, 'attack_mapping.created', 'attack_mapping', `Proposed ${b.technique_id} for ${target.code}${b.origin === 'ai_suggested' ? ' (AI-suggested)' : ''}`, { id, code: target.code });
    res.status(201).json(listMappings(eng.id).find((m) => m.id === id));
  }));

  r.patch('/attack-mappings/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const m = db.get('SELECT * FROM attack_mappings WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!m) throw notFound('ATT&CK mapping');
    const b = z
      .object({ status: z.enum(['proposed', 'verified', 'rejected']).optional(), rationale: z.string().max(4000).optional(), technique_name: z.string().max(300).optional(), tactics: z.string().max(300).optional() })
      .strict()
      .parse(req.body);
    if (b.status === 'verified' && !(b.rationale ?? m.rationale).trim()) throw badRequest('Write the evidence-based rationale before verifying a mapping.');
    const patch: Record<string, any> = { ...b, updated_at: nowIso() };
    if (b.status && b.status !== m.status) patch.reviewed_by = b.status === 'proposed' ? null : currentActor(db);
    db.update('attack_mappings', m.id, patch);
    const target = targetLabel(db, eng.id, m.target_type, m.target_id);
    logActivity(db, eng.id, 'attack_mapping.updated', 'attack_mapping', `${m.technique_id} on ${target?.code ?? m.target_type} ${b.status ? `→ ${b.status}` : 'updated'}`, { id: m.id });
    res.json(listMappings(eng.id).find((x) => x.id === m.id));
  }));

  r.delete('/attack-mappings/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const m = db.get('SELECT * FROM attack_mappings WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!m) throw notFound('ATT&CK mapping');
    db.run('DELETE FROM attack_mappings WHERE id = ?', m.id);
    logActivity(db, eng.id, 'attack_mapping.deleted', 'attack_mapping', `Deleted mapping ${m.technique_id}`, { id: m.id });
    res.json({ ok: true });
  }));

  r.get('/attack-targets', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json({
      findings: db.all('SELECT id, code, title AS label FROM findings WHERE engagement_id = ? ORDER BY code', eng.id),
      timeline: db.all('SELECT id, code, observation AS label FROM timeline_events WHERE engagement_id = ? ORDER BY code', eng.id),
      indicators: db.all('SELECT id, code, title AS label, lab FROM indicators WHERE engagement_id = ? ORDER BY code', eng.id),
    });
  }));

  return r;
}

function require_sha(buf: Buffer) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
