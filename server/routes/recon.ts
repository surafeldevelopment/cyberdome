import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { nextCode, nowIso, uid } from '../lib/codes.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { resolveEvidence, setLinks, evidenceBrief, storeFileEvidence, type SourceCategory } from '../services/evidence.js';
import { parseRecon, RECON_CATEGORIES, RECON_CLASSIFICATIONS } from '../importers/recon.js';
import { toCsv } from '../lib/csv.js';
import { isValidTimezone } from '../lib/time.js';

const SOURCE = z.enum(['authorized_lab', 'instructor_supplied', 'external_reference', 'demo', 'project_artifact']);

const reconSchema = z
  .object({
    category: z.enum(RECON_CATEGORIES),
    classification: z.enum(RECON_CLASSIFICATIONS),
    value: z.string().trim().min(1).max(2000),
    description: z.string().max(10000).optional(),
    source: z.string().max(500).optional(),
    source_category: SOURCE.optional(),
    collected_at: z.string().max(40).nullable().optional(),
    analyst_notes: z.string().max(10000).optional(),
    next_step: z.string().max(4000).optional(),
    verification_status: z.enum(['unverified', 'verified', 'disputed']).optional(),
    evidence_ids: z.array(z.string()).optional(),
  })
  .strict();

export function reconDetail(ctx: Ctx, eid: string, id: string) {
  const row = ctx.db.get('SELECT * FROM recon_observations WHERE engagement_id = ? AND (id = ? OR code = ?)', eid, id, id);
  if (!row) throw notFound('Recon observation');
  return { ...row, evidence: evidenceBrief(ctx.db, 'recon_evidence', 'recon_id', row.id) };
}

function listRecon(ctx: Ctx, eid: string) {
  const rows = ctx.db.all<any>('SELECT * FROM recon_observations WHERE engagement_id = ? ORDER BY created_at', eid);
  const links = ctx.db.all(
    `SELECT l.recon_id, e.id, e.code, e.title, e.status FROM recon_evidence l JOIN evidence e ON e.id = l.evidence_id JOIN recon_observations r ON r.id = l.recon_id WHERE r.engagement_id = ? ORDER BY e.code`,
    eid,
  );
  const by = new Map<string, any[]>();
  for (const l of links) {
    if (!by.has(l.recon_id)) by.set(l.recon_id, []);
    by.get(l.recon_id)!.push({ id: l.id, code: l.code, title: l.title, status: l.status });
  }
  return rows.map((r) => ({ ...r, evidence: by.get(r.id) ?? [] }));
}

export default function reconRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db, cfg } = ctx;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.min(cfg.maxUploadBytes, 10 * 1024 * 1024), files: 1 } });

  r.get('/recon', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(listRecon(ctx, eng.id));
  }));

  r.get('/recon/:id', h((req, res) => res.json(reconDetail(ctx, req.params.eid, req.params.id))));

  r.post('/recon', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = reconSchema.parse(req.body);
    const sourceCategory = eng.is_demo ? 'demo' : b.source_category ?? 'instructor_supplied';
    if (!eng.is_demo && sourceCategory === 'demo') throw badRequest('Demo data cannot be added to a real engagement.');
    const evidence = resolveEvidence(db, eng.id, b.evidence_ids);
    const id = uid();
    const now = nowIso();
    let code = '';
    db.tx(() => {
      code = nextCode(db, eng.id, 'recon');
      db.insert('recon_observations', {
        id, engagement_id: eng.id, code, category: b.category, classification: b.classification, value: b.value,
        description: b.description ?? '', source: b.source ?? '', source_category: sourceCategory, collected_at: b.collected_at || null,
        analyst_notes: b.analyst_notes ?? '', next_step: b.next_step ?? '',
        verification_status: b.verification_status ?? 'unverified',
        verified_by: b.verification_status === 'verified' ? currentActor(db) : null,
        verified_at: b.verification_status === 'verified' ? now : null,
        origin: 'manual', created_at: now, updated_at: now,
      });
      setLinks(db, 'recon_evidence', 'recon_id', id, 'evidence_id', evidence.map((e) => e.id));
      logActivity(db, eng.id, 'recon.created', 'recon', `Added recon observation ${code}: ${b.value.slice(0, 80)}`, { id, code });
    });
    res.status(201).json(reconDetail(ctx, eng.id, id));
  }));

  r.patch('/recon/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const row = db.get('SELECT * FROM recon_observations WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!row) throw notFound('Recon observation');
    const b = reconSchema.partial().strict().parse(req.body);
    if (!eng.is_demo && b.source_category === 'demo') throw badRequest('Demo data cannot be added to a real engagement.');
    const { evidence_ids, ...fields } = b;
    const evidence = evidence_ids ? resolveEvidence(db, eng.id, evidence_ids) : null;
    const patch: Record<string, any> = { ...fields, updated_at: nowIso() };
    if (eng.is_demo) delete patch.source_category;
    if (b.verification_status && b.verification_status !== row.verification_status) {
      patch.verified_by = b.verification_status === 'unverified' ? null : currentActor(db);
      patch.verified_at = b.verification_status === 'unverified' ? null : nowIso();
    }
    db.tx(() => {
      db.update('recon_observations', row.id, patch);
      if (evidence) setLinks(db, 'recon_evidence', 'recon_id', row.id, 'evidence_id', evidence.map((e) => e.id));
      const what = b.verification_status && b.verification_status !== row.verification_status ? `marked ${b.verification_status}` : `updated (${Object.keys(b).join(', ')})`;
      logActivity(db, eng.id, 'recon.updated', 'recon', `Recon observation ${row.code} ${what}`, { id: row.id, code: row.code });
    });
    res.json(reconDetail(ctx, eng.id, row.id));
  }));

  r.delete('/recon/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const row = db.get('SELECT * FROM recon_observations WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!row) throw notFound('Recon observation');
    db.run('DELETE FROM recon_observations WHERE id = ?', row.id);
    logActivity(db, eng.id, 'recon.deleted', 'recon', `Deleted recon observation ${row.code} (code retired; evidence kept)`, { id: row.id, code: row.code });
    res.json({ ok: true });
  }));

  // ---- Imports ----
  const tzOf = (eng: any, v: unknown) => {
    const tz = typeof v === 'string' && v ? v : eng.timezone || 'UTC';
    if (!isValidTimezone(tz)) throw badRequest(`Unknown timezone: ${tz}`);
    return tz;
  };

  r.post('/recon-imports/preview', upload.single('file'), h((req, res) => {
    const eng = engagementFrom(ctx, req);
    if (!req.file) throw badRequest('Choose a CSV or JSON file to preview.');
    const tz = tzOf(eng, req.body?.source_timezone);
    const p = parseRecon(req.file.buffer.toString('utf8'), req.file.originalname, tz);
    res.json({ ...p, rows: p.rows.slice(0, 200), row_count: p.rows.length, source_timezone: tz });
  }));

  r.post('/recon-imports', upload.single('file'), h((req, res) => {
    const eng = engagementFrom(ctx, req);
    if (!req.file) throw badRequest('Choose a CSV or JSON file to import.');
    const tz = tzOf(eng, req.body?.source_timezone);
    const sourceCategory = (eng.is_demo ? 'demo' : SOURCE.parse(req.body?.source_category ?? 'instructor_supplied')) as SourceCategory;
    const p = parseRecon(req.file.buffer.toString('utf8'), req.file.originalname, tz);
    if (!p.rows.length) throw badRequest('No valid observations found. Nothing was imported.', { errors: p.errors.slice(0, 50), warnings: p.warnings });
    const ev = storeFileEvidence(db, cfg, {
      engagementId: eng.id,
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      sourceCategory,
      sourceTool: String(req.body?.source_tool ?? 'Recon import').slice(0, 200),
      title: `Recon import: ${req.file.originalname}`,
      observation: `Structured recon dataset with ${p.total} record(s); ${p.rows.length} imported as recon observations.`,
      tags: ['recon', 'import'],
    });
    const created: string[] = [];
    const now = nowIso();
    db.tx(() => {
      for (const row of p.rows) {
        const id = uid();
        const code = nextCode(db, eng.id, 'recon');
        db.insert('recon_observations', {
          id, engagement_id: eng.id, code, category: row.category, classification: row.classification, value: row.value,
          description: row.description, source: row.source, source_category: sourceCategory, collected_at: row.collected_at,
          analyst_notes: row.analyst_notes, next_step: row.next_step, verification_status: 'unverified', origin: 'import',
          created_at: now, updated_at: now,
        });
        db.run('INSERT OR IGNORE INTO recon_evidence (recon_id, evidence_id) VALUES (?,?)', id, ev.id);
        created.push(code);
      }
      logActivity(db, eng.id, 'recon.imported', 'recon', `Imported ${created.length} recon observation(s) from ${ev.code}${p.errors.length ? ` (${p.errors.length} row(s) rejected)` : ''}`, { id: ev.id, code: ev.code });
    });
    res.status(201).json({
      status: p.errors.length ? 'partial' : 'complete',
      evidence: { id: ev.id, code: ev.code, duplicate_of: ev.duplicateOf },
      created: created.length,
      codes: created,
      rejected: p.errors.length,
      errors: p.errors.slice(0, 100),
      warnings: p.warnings,
    });
  }));

  r.get('/recon-template.csv', h((_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="recon-template.csv"');
    res.send(
      'category,classification,value,description,source,collected_at,analyst_notes,next_step\n' +
        'domain,asset_discovery,<authorized domain>,<what was observed>,<where it came from>,2026-10-01T09:00:00-04:00,<why it matters>,<next authorized step>\n',
    );
  }));

  r.get('/exports/recon.csv', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = listRecon(ctx, eng.id).map((x) => ({
      code: x.code, category: x.category, classification: x.classification, value: x.value, description: x.description, source: x.source,
      source_category: x.source_category, collected_at: x.collected_at ?? '', verification_status: x.verification_status, verified_by: x.verified_by ?? '',
      analyst_notes: x.analyst_notes, next_step: x.next_step, evidence: x.evidence.map((e: any) => e.code).join('; '), origin: x.origin,
    }));
    logActivity(db, eng.id, 'export.recon', 'export', `Exported recon observations (${rows.length})`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="recon-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(rows, ['code', 'category', 'classification', 'value', 'description', 'source', 'source_category', 'collected_at', 'verification_status', 'verified_by', 'analyst_notes', 'next_step', 'evidence', 'origin']));
  }));

  return r;
}
