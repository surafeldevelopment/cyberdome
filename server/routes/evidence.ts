import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { nowIso, uid } from '../lib/codes.js';
import { parseJson } from '../db/index.js';
import { logActivity, currentActor } from '../lib/activity.js';
import {
  storeFileEvidence, storeReferenceEvidence, readEvidenceBytes, sha256, hydrateEvidence, type SourceCategory,
} from '../services/evidence.js';
import { IMAGE_TYPES, TEXT_TYPES } from '../lib/filetype.js';
import { readPcapMeta } from '../lib/pcap.js';
import { toCsv } from '../lib/csv.js';

const SOURCE = z.enum(['authorized_lab', 'instructor_supplied', 'external_reference', 'demo', 'project_artifact']);
const CONF = z.enum(['unrated', 'high', 'medium', 'low', 'requires_more_evidence']);
const SANI = z.enum(['not_reviewed', 'sanitized', 'no_sensitive_data', 'contains_sensitive']);

const tagsField = z
  .union([z.array(z.string().max(40)), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20))
  .optional();

const metaSchema = z.object({
  title: z.string().max(300).optional(),
  source_category: SOURCE,
  source_tool: z.string().max(200).optional(),
  collected_at: z.string().max(40).optional().nullable(),
  collected_at_note: z.string().max(500).optional(),
  observation: z.string().max(20000).optional(),
  interpretation: z.string().max(20000).optional(),
  confidence: CONF.optional(),
  tags: tagsField,
  sanitization_status: SANI.optional(),
  asset_ids: z.union([z.array(z.string()), z.string()]).transform((v) => (Array.isArray(v) ? v : v ? v.split(',') : [])).optional(),
});

const patchSchema = z
  .object({
    title: z.string().max(300).optional(),
    source_tool: z.string().max(200).optional(),
    collected_at: z.string().max(40).nullable().optional(),
    collected_at_note: z.string().max(500).optional(),
    observation: z.string().max(20000).optional(),
    interpretation: z.string().max(20000).optional(),
    confidence: CONF.optional(),
    tags: tagsField,
    sanitization_status: SANI.optional(),
    asset_ids: z.array(z.string()).optional(),
  })
  .strict();

const SORTS: Record<string, string> = {
  code: 'CAST(substr(e.code, instr(e.code, \'EV-\') + 3) AS INTEGER)',
  title: 'e.title COLLATE NOCASE',
  imported_at: 'e.imported_at',
  collected_at: 'e.collected_at',
  size: 'e.size_bytes',
  confidence: 'e.confidence',
};

export function listEvidence(ctx: Ctx, eid: string, q: Record<string, any>, paginate = true) {
  const where = ['e.engagement_id = ?'];
  const params: any[] = [eid];
  if (q.q) {
    where.push('(e.code LIKE ? OR e.title LIKE ? OR e.original_filename LIKE ? OR e.observation LIKE ? OR e.interpretation LIKE ? OR e.sha256 LIKE ? OR e.tags LIKE ? OR e.source_tool LIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like, like, like, like, like, like);
  }
  for (const [key, col] of [['source_category', 'e.source_category'], ['confidence', 'e.confidence'], ['sanitization_status', 'e.sanitization_status'], ['detected_type', 'e.detected_type'], ['kind', 'e.kind']] as const) {
    if (q[key]) { where.push(`${col} = ?`); params.push(q[key]); }
  }
  if (q.status !== 'all') { where.push('e.status = ?'); params.push(q.status || 'active'); }
  if (q.tag) { where.push('e.tags LIKE ?'); params.push(`%"${String(q.tag).toLowerCase()}"%`); }
  if (q.asset) { where.push('EXISTS (SELECT 1 FROM evidence_assets ea WHERE ea.evidence_id = e.id AND ea.asset_id = ?)'); params.push(q.asset); }
  if (q.unlinked === '1') where.push(`NOT EXISTS (SELECT 1 FROM finding_evidence WHERE evidence_id = e.id) AND NOT EXISTS (SELECT 1 FROM timeline_evidence WHERE evidence_id = e.id) AND NOT EXISTS (SELECT 1 FROM recon_evidence WHERE evidence_id = e.id) AND NOT EXISTS (SELECT 1 FROM indicator_evidence WHERE evidence_id = e.id)`);
  const sort = SORTS[q.sort as string] ?? SORTS.code;
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const base = `FROM evidence e WHERE ${where.join(' AND ')}`;
  const total = ctx.db.scalar<number>(`SELECT COUNT(*) ${base}`, ...params);
  const limit = paginate ? Math.min(Number(q.limit ?? 50), 500) : -1;
  const offset = paginate ? Number(q.offset ?? 0) : 0;
  const items = ctx.db
    .all(
      `SELECT e.*,
        (SELECT COUNT(*) FROM finding_evidence x WHERE x.evidence_id = e.id) AS finding_links,
        (SELECT COUNT(*) FROM timeline_evidence x WHERE x.evidence_id = e.id) AS timeline_links,
        (SELECT COUNT(*) FROM recon_evidence x WHERE x.evidence_id = e.id) AS recon_links,
        (SELECT COUNT(*) FROM indicator_evidence x WHERE x.evidence_id = e.id) AS indicator_links,
        (SELECT group_concat(a.code || ' ' || COALESCE(a.ip, a.hostname), ', ') FROM evidence_assets ea JOIN assets a ON a.id = ea.asset_id WHERE ea.evidence_id = e.id) AS asset_labels
       ${base} ORDER BY ${sort} ${dir}, e.created_at ${dir} LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    )
    .map(hydrateEvidence);
  return { items, total };
}

export function evidenceDetail(ctx: Ctx, eid: string, idOrCode: string) {
  const { db } = ctx;
  const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND (id = ? OR code = ?)', eid, idOrCode, idOrCode.toUpperCase());
  if (!ev) throw notFound('Evidence');
  const id = ev.id;
  const aiSessions = db
    .all("SELECT id, code, task_type, created_at, review_status, evidence_codes, citations FROM ai_sessions WHERE engagement_id = ? AND evidence_codes LIKE ? ORDER BY created_at DESC", eid, `%"${ev.code}"%`)
    .map((s) => ({ id: s.id, code: s.code, task_type: s.task_type, created_at: s.created_at, review_status: s.review_status, cited: (parseJson<any>(s.citations, {}).valid ?? []).includes(ev.code) }));
  return {
    ...hydrateEvidence(ev),
    assets: db.all('SELECT a.id, a.code, a.ip, a.hostname FROM evidence_assets ea JOIN assets a ON a.id = ea.asset_id WHERE ea.evidence_id = ?', id),
    findings: db.all('SELECT f.id, f.code, f.title, f.severity, f.validation_status, f.status FROM finding_evidence l JOIN findings f ON f.id = l.finding_id WHERE l.evidence_id = ? ORDER BY f.code', id),
    timeline: db.all('SELECT t.id, t.code, t.observation, t.normalized_ts, t.original_timestamp, t.verification_status FROM timeline_evidence l JOIN timeline_events t ON t.id = l.timeline_id WHERE l.evidence_id = ? ORDER BY t.normalized_ts', id),
    recon: db.all('SELECT r.id, r.code, r.value, r.classification, r.verification_status FROM recon_evidence l JOIN recon_observations r ON r.id = l.recon_id WHERE l.evidence_id = ? ORDER BY r.code', id),
    indicators: db.all('SELECT i.id, i.code, i.title, i.assessment, i.lab FROM indicator_evidence l JOIN indicators i ON i.id = l.indicator_id WHERE l.evidence_id = ? ORDER BY i.code', id),
    scan_imports: db.all('SELECT id, code, format, status, created_at, observations_count FROM scan_imports WHERE evidence_id = ?', id),
    log_imports: db.all('SELECT id, code, format, status, created_at, rows_imported FROM log_imports WHERE evidence_id = ?', id),
    finding_imports: db.all('SELECT id, code, format, status, created_at, created_count FROM finding_imports WHERE evidence_id = ?', id),
    services: db.all(
      `SELECT DISTINCT s.id, s.port, s.protocol, s.service_name, a.code AS asset_code, a.ip FROM service_observations o JOIN services s ON s.asset_id = o.asset_id AND s.port = o.port AND s.protocol = o.protocol JOIN assets a ON a.id = s.asset_id WHERE o.evidence_id = ? ORDER BY a.code, s.port LIMIT 200`,
      id,
    ),
    ai_sessions: aiSessions,
    derived_from: ev.derived_from_id ? db.get('SELECT id, code, title, sha256 FROM evidence WHERE id = ?', ev.derived_from_id) : null,
    derivatives: db.all('SELECT id, code, title, sha256, sanitization_status, created_at FROM evidence WHERE derived_from_id = ? ORDER BY created_at', id),
    reviews: db.all('SELECT * FROM evidence_reviews WHERE evidence_id = ? ORDER BY created_at DESC', id),
  };
}

export default function evidenceRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db, cfg } = ctx;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 40 } });

  r.get('/evidence', h((req, res) => {
    engagementFrom(ctx, req);
    res.json(listEvidence(ctx, req.params.eid, req.query as any));
  }));

  r.post(
    '/evidence',
    upload.single('file'),
    h((req, res) => {
      const eng = engagementFrom(ctx, req);
      if (!req.file) throw badRequest('Choose a file to upload.');
      const m = metaSchema.parse(req.body);
      if (eng.is_demo && m.source_category !== 'demo') m.source_category = 'demo';
      const result = storeFileEvidence(db, cfg, {
        engagementId: eng.id,
        buffer: req.file.buffer,
        originalFilename: req.file.originalname,
        sourceCategory: m.source_category as SourceCategory,
        sourceTool: m.source_tool,
        title: m.title,
        collectedAt: m.collected_at,
        collectedAtNote: m.collected_at_note,
        observation: m.observation,
        interpretation: m.interpretation,
        confidence: m.confidence,
        tags: m.tags,
        sanitizationStatus: m.sanitization_status,
        assetIds: validAssets(ctx, eng.id, m.asset_ids),
      });
      res.status(201).json({ ...evidenceDetail(ctx, eng.id, result.id), duplicate_of: result.duplicateOf });
    }),
  );

  r.post(
    '/evidence/text',
    h((req, res) => {
      const eng = engagementFrom(ctx, req);
      const b = metaSchema.extend({ text: z.string().min(1).max(5_000_000), filename: z.string().max(200).optional() }).parse(req.body);
      const result = storeFileEvidence(db, cfg, {
        engagementId: eng.id,
        buffer: Buffer.from(b.text, 'utf8'),
        originalFilename: b.filename || `${(b.title || 'pasted-output').replace(/[^\w-]+/g, '-').slice(0, 60)}.txt`,
        sourceCategory: (eng.is_demo ? 'demo' : b.source_category) as SourceCategory,
        sourceTool: b.source_tool,
        title: b.title,
        collectedAt: b.collected_at,
        collectedAtNote: b.collected_at_note,
        observation: b.observation,
        interpretation: b.interpretation,
        confidence: b.confidence,
        tags: b.tags,
        sanitizationStatus: b.sanitization_status,
        assetIds: validAssets(ctx, eng.id, b.asset_ids),
      });
      res.status(201).json({ ...evidenceDetail(ctx, eng.id, result.id), duplicate_of: result.duplicateOf });
    }),
  );

  r.post(
    '/evidence/reference',
    h((req, res) => {
      const eng = engagementFrom(ctx, req);
      const b = metaSchema
        .extend({ reference_uri: z.string().trim().min(1).max(2000), reference_sha256: z.string().trim().optional(), size_bytes: z.number().int().nonnegative().optional() })
        .parse(req.body);
      const result = storeReferenceEvidence(db, {
        engagementId: eng.id,
        referenceUri: b.reference_uri,
        referenceSha256: b.reference_sha256 || undefined,
        sizeBytes: b.size_bytes,
        sourceCategory: (eng.is_demo ? 'demo' : b.source_category) as SourceCategory,
        sourceTool: b.source_tool,
        title: b.title,
        collectedAt: b.collected_at,
        collectedAtNote: b.collected_at_note,
        observation: b.observation,
        interpretation: b.interpretation,
        confidence: b.confidence,
        tags: b.tags,
        sanitizationStatus: b.sanitization_status,
        assetIds: validAssets(ctx, eng.id, b.asset_ids),
      });
      res.status(201).json(evidenceDetail(ctx, eng.id, result.id));
    }),
  );

  r.get('/evidence/:id', h((req, res) => res.json(evidenceDetail(ctx, req.params.eid, req.params.id))));

  r.patch(
    '/evidence/:id',
    h((req, res) => {
      const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', req.params.eid, req.params.id);
      if (!ev) throw notFound('Evidence');
      const b = patchSchema.parse(req.body);
      const { asset_ids, ...fields } = b;
      db.tx(() => {
        db.update('evidence', ev.id, { ...fields, updated_at: nowIso() });
        if (asset_ids) {
          db.run('DELETE FROM evidence_assets WHERE evidence_id = ?', ev.id);
          for (const a of validAssets(ctx, req.params.eid, asset_ids)) db.run('INSERT OR IGNORE INTO evidence_assets (evidence_id, asset_id) VALUES (?,?)', ev.id, a);
        }
        if (b.sanitization_status && b.sanitization_status !== ev.sanitization_status)
          db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: `sanitization:${b.sanitization_status}`, notes: '', created_at: nowIso() });
        const changed = Object.keys(b).filter((k) => k !== 'sanitization_status');
        if (changed.length)
          db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: 'metadata_edited', notes: `Fields: ${changed.join(', ')}`, created_at: nowIso() });
        logActivity(db, req.params.eid, 'evidence.updated', 'evidence', `Updated ${ev.code}`, { id: ev.id, code: ev.code });
      });
      res.json(evidenceDetail(ctx, req.params.eid, ev.id));
    }),
  );

  r.post(
    '/evidence/:id/reviews',
    h((req, res) => {
      const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', req.params.eid, req.params.id);
      if (!ev) throw notFound('Evidence');
      const b = z.object({ action: z.enum(['reviewed', 'verified_against_source', 'needs_follow_up', 'note']), notes: z.string().max(4000).default('') }).strict().parse(req.body);
      db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: b.action, notes: b.notes, created_at: nowIso() });
      logActivity(db, req.params.eid, 'evidence.reviewed', 'evidence', `Review on ${ev.code}: ${b.action.replace(/_/g, ' ')}`, { id: ev.id, code: ev.code });
      res.status(201).json(evidenceDetail(ctx, req.params.eid, ev.id));
    }),
  );

  r.post(
    '/evidence/:id/withdraw',
    h((req, res) => {
      const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', req.params.eid, req.params.id);
      if (!ev) throw notFound('Evidence');
      const b = z.object({ reason: z.string().trim().min(3).max(2000), confirm: z.literal(true) }).strict().parse(req.body);
      db.update('evidence', ev.id, { status: 'withdrawn', withdrawn_reason: b.reason, withdrawn_at: nowIso(), updated_at: nowIso() });
      db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: 'withdrawn', notes: b.reason, created_at: nowIso() });
      logActivity(db, req.params.eid, 'evidence.withdrawn', 'evidence', `Withdrew ${ev.code}: ${b.reason} (ID is retired, links kept for traceability)`, { id: ev.id, code: ev.code });
      res.json(evidenceDetail(ctx, req.params.eid, ev.id));
    }),
  );

  r.post(
    '/evidence/:id/restore',
    h((req, res) => {
      const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', req.params.eid, req.params.id);
      if (!ev) throw notFound('Evidence');
      db.update('evidence', ev.id, { status: 'active', withdrawn_reason: null, withdrawn_at: null, updated_at: nowIso() });
      db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: 'restored', notes: '', created_at: nowIso() });
      logActivity(db, req.params.eid, 'evidence.restored', 'evidence', `Restored ${ev.code}`, { id: ev.id, code: ev.code });
      res.json(evidenceDetail(ctx, req.params.eid, ev.id));
    }),
  );

  r.post(
    '/evidence/:id/derivative',
    upload.single('file'),
    h((req, res) => {
      const eng = engagementFrom(ctx, req);
      const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
      if (!ev) throw notFound('Evidence');
      const text = typeof req.body?.text === 'string' ? req.body.text : null;
      const buffer = req.file?.buffer ?? (text ? Buffer.from(text, 'utf8') : null);
      if (!buffer) throw badRequest('Provide the sanitized file or text.');
      const note = String(req.body?.derivation_note ?? '').slice(0, 2000);
      const result = storeFileEvidence(db, cfg, {
        engagementId: eng.id,
        buffer,
        originalFilename: req.file?.originalname ?? `${ev.code}-sanitized.txt`,
        sourceCategory: ev.source_category,
        sourceTool: ev.source_tool,
        title: `${ev.title} (sanitized)`,
        collectedAt: ev.collected_at,
        collectedAtNote: ev.collected_at_note,
        observation: ev.observation,
        interpretation: ev.interpretation,
        confidence: ev.confidence,
        tags: [...parseJson<string[]>(ev.tags, []), 'sanitized'],
        sanitizationStatus: 'sanitized',
        derivedFromId: ev.id,
        derivationNote: note || 'Sanitized derivative created by analyst.',
        assetIds: db.all('SELECT asset_id FROM evidence_assets WHERE evidence_id = ?', ev.id).map((x) => x.asset_id),
      });
      db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: 'sanitized_derivative_created', notes: `Derivative ${result.code}. ${note}`, created_at: nowIso() });
      res.status(201).json(evidenceDetail(ctx, eng.id, result.id));
    }),
  );

  r.post(
    '/evidence/:id/verify-hash',
    h((req, res) => {
      const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', req.params.eid, req.params.id);
      if (!ev) throw notFound('Evidence');
      if (ev.kind !== 'file') throw badRequest('Only stored files can be re-hashed. References are not stored in this application.');
      const bytes = readEvidenceBytes(cfg, ev);
      if (!bytes) {
        db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: 'hash_check_failed', notes: 'Stored file is missing.', created_at: nowIso() });
        return res.json({ match: false, stored: ev.sha256, computed: null, message: 'The stored file is missing from evidence storage.' });
      }
      const computed = sha256(bytes);
      const match = computed === ev.sha256;
      db.insert('evidence_reviews', { id: uid(), evidence_id: ev.id, reviewer: currentActor(db), action: match ? 'hash_verified' : 'hash_mismatch', notes: `Computed ${computed}`, created_at: nowIso() });
      logActivity(db, req.params.eid, 'evidence.hash_checked', 'evidence', `Re-hashed ${ev.code}: ${match ? 'matches' : 'MISMATCH'}`, { id: ev.id, code: ev.code });
      res.json({ match, stored: ev.sha256, computed, checked_at: nowIso() });
    }),
  );

  r.get(
    '/evidence/:id/preview',
    h((req, res) => {
      const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', req.params.eid, req.params.id);
      if (!ev) throw notFound('Evidence');
      if (ev.kind === 'reference') return res.json({ type: 'reference', uri: ev.reference_uri, note: 'This artifact is recorded by reference; the file is not stored here.' });
      const bytes = readEvidenceBytes(cfg, ev);
      if (!bytes) return res.json({ type: 'missing', note: 'The stored file could not be found in evidence storage.' });
      if (IMAGE_TYPES.includes(ev.detected_type)) return res.json({ type: 'image', url: `raw?inline=1` });
      if (ev.detected_type === 'pcap' || ev.detected_type === 'pcapng') return res.json({ type: 'pcap', meta: readPcapMeta(bytes) });
      if (TEXT_TYPES.includes(ev.detected_type)) {
        const max = 200_000;
        return res.json({
          type: 'text',
          text: bytes.subarray(0, max).toString('utf8'),
          truncated: bytes.length > max,
          untrusted_markup: ['html', 'svg'].includes(ev.detected_type),
          note: ['html', 'svg'].includes(ev.detected_type) ? 'Shown as plain text. Markup and scripts in uploaded files are never rendered.' : undefined,
        });
      }
      res.json({ type: 'none', note: `No safe inline preview for ${ev.detected_type ?? 'this'} files. Download to inspect it in an appropriate tool.` });
    }),
  );

  r.get(
    '/evidence/:id/raw',
    h((req, res) => {
      const ev = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND id = ?', req.params.eid, req.params.id);
      if (!ev) throw notFound('Evidence');
      const bytes = readEvidenceBytes(cfg, ev);
      if (!bytes) throw notFound('Stored evidence file');
      const inline = req.query.inline === '1' && IMAGE_TYPES.includes(ev.detected_type);
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', inline ? ev.mime_type : 'application/octet-stream');
      const fname = `${ev.code}_${ev.original_filename ?? 'evidence'}`.replace(/[^\w.\-()]+/g, '_');
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fname}"`);
      res.setHeader('X-Evidence-SHA256', ev.sha256 ?? '');
      res.send(bytes);
    }),
  );

  r.get(
    '/evidence-index.:fmt',
    h((req, res) => {
      const eng = engagementFrom(ctx, req);
      const { items } = listEvidence(ctx, eng.id, { ...req.query, status: req.query.status ?? 'all' }, false);
      const rows = items.map((e: any) => ({
        evidence_id: e.code,
        title: e.title,
        status: e.status,
        kind: e.kind,
        original_filename: e.original_filename ?? '',
        file_type: e.detected_type ?? '',
        size_bytes: e.size_bytes ?? '',
        sha256: e.sha256 ?? '',
        hash_origin: e.kind === 'file' ? 'calculated_from_bytes' : e.sha256 ? 'analyst_supplied' : '',
        reference_uri: e.reference_uri ?? '',
        source_category: e.source_category,
        source_tool: e.source_tool,
        collected_at: e.collected_at ?? '',
        collected_at_note: e.collected_at_note ?? '',
        imported_at: e.imported_at,
        assets: e.asset_labels ?? '',
        observation: e.observation,
        interpretation: e.interpretation,
        confidence: e.confidence,
        tags: (e.tags ?? []).join('; '),
        sanitization_status: e.sanitization_status,
        derived_from: e.derived_from_id ? db.scalar('SELECT code FROM evidence WHERE id = ?', e.derived_from_id) : '',
        linked_findings: e.finding_links,
        linked_timeline_events: e.timeline_links,
        linked_recon: e.recon_links,
        linked_indicators: e.indicator_links,
        analysis_status: e.analysis_status,
      }));
      logActivity(db, eng.id, 'export.evidence_index', 'export', `Exported evidence index (${rows.length} records, ${req.params.fmt})`);
      const stamp = new Date().toISOString().slice(0, 10);
      if (req.params.fmt === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="evidence-index-${stamp}.csv"`);
        return res.send(toCsv(rows));
      }
      if (req.params.fmt === 'json') {
        res.setHeader('Content-Disposition', `attachment; filename="evidence-index-${stamp}.json"`);
        return res.json({ engagement: eng.name, is_demo: !!eng.is_demo, exported_at: nowIso(), count: rows.length, note: 'SHA-256 values identify file contents; they do not by themselves establish authenticity or a complete chain of custody.', evidence: rows });
      }
      throw badRequest('Use .csv or .json');
    }),
  );

  return r;
}

function validAssets(ctx: Ctx, eid: string, ids?: string[]) {
  const out: string[] = [];
  for (const id of ids ?? []) {
    if (!id) continue;
    const a = ctx.db.get('SELECT id FROM assets WHERE engagement_id = ? AND (id = ? OR code = ?)', eid, id, id);
    if (!a) throw badRequest(`Unknown asset: ${id}`);
    out.push(a.id);
  }
  return out;
}
