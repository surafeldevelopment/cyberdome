import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { nextCode, nowIso, uid } from '../lib/codes.js';
import { parseJson, type Row } from '../db/index.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { evidenceBrief, resolveEvidence, setLinks, sha256, storeFileEvidence, type SourceCategory } from '../services/evidence.js';
import { toCsv } from '../lib/csv.js';
import {
  CVE_RE, FINDINGS_TEMPLATE_CSV, dedupeKey, parseFindingsFile, type FindingFormat, type FindingParseResult, type ParsedFinding,
} from '../importers/findings.js';

const SEV = z.enum(['critical', 'high', 'medium', 'low', 'info']);
const VALID = z.enum(['scanner_reported', 'potential', 'validated', 'false_positive']);
const STATUS = z.enum(['open', 'in_progress', 'remediated', 'risk_accepted']);
const factor = z.number().int().min(0).max(3).nullable().optional();

const findingBody = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20000).optional(),
    severity: SEV,
    severity_basis: z.enum(['scanner', 'analyst', 'cvss']).optional(),
    cves: z
      .array(z.string().trim().toUpperCase())
      .max(50)
      .refine((a) => a.every((c) => CVE_RE.test(c)), 'CVE identifiers must look like CVE-2021-41617')
      .optional(),
    cvss_score: z.number().min(0).max(10).nullable().optional(),
    cvss_version: z.enum(['2.0', '3.0', '3.1', '4.0']).nullable().optional(),
    cvss_vector: z.string().max(300).nullable().optional(),
    cvss_source: z.string().max(200).nullable().optional(),
    impact: z.string().max(10000).optional(),
    remediation: z.string().max(10000).optional(),
    validation_status: VALID.optional(),
    validation_notes: z.string().max(10000).optional(),
    status: STATUS.optional(),
    owner: z.string().max(200).optional(),
    priority_rationale: z.string().max(5000).optional(),
    f_evidence_strength: factor,
    f_exposure: factor,
    f_impact: factor,
    f_asset_importance: factor,
    f_remediation_available: factor,
    retest_notes: z.string().max(10000).optional(),
    asset_ids: z.array(z.string()).max(200).optional(),
    service_ids: z.array(z.string()).max(500).optional(),
    evidence_ids: z.array(z.string()).max(200).optional(),
  })
  .strict();

const FACTOR_KEYS = ['f_evidence_strength', 'f_exposure', 'f_impact', 'f_asset_importance', 'f_remediation_available'] as const;

const LIST_SQL = `SELECT f.*,
  (SELECT group_concat(a.code || '|' || a.id || '|' || COALESCE(a.ip,'') || '|' || COALESCE(a.hostname,''), ';;') FROM finding_assets fa JOIN assets a ON a.id = fa.asset_id WHERE fa.finding_id = f.id) AS asset_list,
  (SELECT group_concat(e.code || '|' || e.id || '|' || e.status, ';;') FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id WHERE fe.finding_id = f.id) AS evidence_list,
  (SELECT group_concat(a.code || ':' || s.port || '/' || s.protocol || COALESCE(' ' || s.service_name, ''), ', ') FROM finding_services fs JOIN services s ON s.id = fs.service_id JOIN assets a ON a.id = s.asset_id WHERE fs.finding_id = f.id) AS service_labels,
  (SELECT COUNT(*) FROM remediation_tasks t WHERE t.finding_id = f.id) AS task_count,
  (SELECT COUNT(*) FROM remediation_tasks t WHERE t.finding_id = f.id AND t.status IN ('done','wont_fix')) AS tasks_closed,
  (SELECT code FROM finding_imports i WHERE i.id = f.import_id) AS import_code
  FROM findings f`;

function hydrate(row: Row): Row {
  const split = (s: string | null) => (s ? s.split(';;').map((x) => x.split('|')) : []);
  return {
    ...row,
    cves: parseJson<string[]>(row.cves, []),
    assets: split(row.asset_list).map(([code, id, ip, hostname]) => ({ code, id, ip: ip || null, hostname })),
    evidence: split(row.evidence_list).map(([code, id, status]) => ({ code, id, status })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    asset_list: undefined,
    evidence_list: undefined,
  };
}

export function listFindings(ctx: Ctx, eid: string, q: Record<string, any>) {
  const where = ['f.engagement_id = ?'];
  const p: any[] = [eid];
  if (q.severity) {
    const sevs = String(q.severity).split(',').filter((s) => SEV.safeParse(s).success);
    if (sevs.length) { where.push(`f.severity IN (${sevs.map(() => '?').join(',')})`); p.push(...sevs); }
  }
  if (q.validation === 'unverified' || q.validation_status === 'unverified') where.push("f.validation_status IN ('scanner_reported','potential') AND f.status <> 'remediated'");
  else if (q.validation || q.validation_status) { where.push('f.validation_status = ?'); p.push(q.validation || q.validation_status); }
  if (q.status) { where.push('f.status = ?'); p.push(q.status); }
  if (q.exclude_fp === '1') where.push("f.validation_status <> 'false_positive'");
  if (q.asset) { where.push('EXISTS (SELECT 1 FROM finding_assets fa WHERE fa.finding_id = f.id AND fa.asset_id = ?)'); p.push(q.asset); }
  if (q.q) {
    const like = `%${q.q}%`;
    where.push('(f.code LIKE ? OR f.title LIKE ? OR f.description LIKE ? OR f.cves LIKE ? OR f.owner LIKE ?)');
    p.push(like, like, like, like, like);
  }
  return ctx.db
    .all(`${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, f.cvss_score DESC, f.code`, ...p)
    .map(hydrate);
}

export function findingDetail(ctx: Ctx, eid: string, idOrCode: string) {
  const { db } = ctx;
  const f = db.get(`${LIST_SQL} WHERE f.engagement_id = ? AND (f.id = ? OR f.code = ?)`, eid, idOrCode, idOrCode.toUpperCase());
  if (!f) throw notFound('Finding');
  const base = hydrate(f);
  return {
    ...base,
    services: db.all(
      `SELECT s.id, s.port, s.protocol, s.state, s.service_name, s.product, s.version, s.version_status, a.id AS asset_id, a.code AS asset_code, a.ip
       FROM finding_services fs JOIN services s ON s.id = fs.service_id JOIN assets a ON a.id = s.asset_id WHERE fs.finding_id = ? ORDER BY a.code, s.port`,
      f.id,
    ),
    evidence: evidenceBrief(db, 'finding_evidence', 'finding_id', f.id),
    tasks: db.all('SELECT * FROM remediation_tasks WHERE finding_id = ? ORDER BY created_at', f.id),
    attack_mappings: db.all("SELECT * FROM attack_mappings WHERE target_type = 'finding' AND target_id = ? ORDER BY technique_id", f.id),
    reviews: db.all("SELECT * FROM human_reviews WHERE target_type = 'finding' AND target_id = ? ORDER BY created_at DESC", f.id),
    import: f.import_id ? db.get('SELECT id, code, format, scanner, created_at, evidence_id, (SELECT code FROM evidence WHERE id = finding_imports.evidence_id) AS evidence_code FROM finding_imports WHERE id = ?', f.import_id) : null,
  };
}

function resolveAssets(ctx: Ctx, eid: string, ids: string[]) {
  return ids.map((id) => {
    const a = ctx.db.get('SELECT id FROM assets WHERE engagement_id = ? AND (id = ? OR code = ?)', eid, id, id);
    if (!a) throw badRequest(`Unknown asset: ${id}`);
    return a.id as string;
  });
}
function resolveServices(ctx: Ctx, eid: string, ids: string[]) {
  return ids.map((id) => {
    const s = ctx.db.get('SELECT id FROM services WHERE engagement_id = ? AND id = ?', eid, id);
    if (!s) throw badRequest(`Unknown service: ${id}`);
    return s.id as string;
  });
}

function addReview(ctx: Ctx, eid: string, findingId: string, decision: string, notes: string) {
  ctx.db.insert('human_reviews', { id: uid(), engagement_id: eid, target_type: 'finding', target_id: findingId, reviewer: currentActor(ctx.db), decision, notes, created_at: nowIso() });
}

/**
 * Apply create/update with link handling and validation-state rules.
 * - 'validated' requires at least one active linked evidence item and validation notes.
 * - 'false_positive' requires notes explaining why.
 */
function saveFinding(ctx: Ctx, eid: string, existing: Row | null, body: z.infer<typeof findingBody> | Partial<z.infer<typeof findingBody>>) {
  const { db } = ctx;
  const { asset_ids, service_ids, evidence_ids, ...fields } = body as any;
  const now = nowIso();
  let id = existing?.id as string;
  let code = existing?.code as string;
  db.tx(() => {
    const assets = asset_ids ? resolveAssets(ctx, eid, asset_ids) : null;
    const services = service_ids ? resolveServices(ctx, eid, service_ids) : null;
    const evidence = evidence_ids ? resolveEvidence(db, eid, evidence_ids) : null;
    if (!existing) {
      id = uid();
      code = nextCode(db, eid, 'finding');
      db.insert('findings', {
        id, engagement_id: eid, code,
        title: fields.title, description: fields.description ?? '', severity: fields.severity, severity_basis: fields.severity_basis ?? 'analyst',
        cves: fields.cves ?? [], cvss_score: fields.cvss_score ?? null, cvss_version: fields.cvss_version ?? null, cvss_vector: fields.cvss_vector ?? null, cvss_source: fields.cvss_source ?? null,
        impact: fields.impact ?? '', remediation: fields.remediation ?? '', validation_status: 'potential', validation_notes: fields.validation_notes ?? '',
        status: fields.status ?? 'open', owner: fields.owner ?? '', priority_rationale: fields.priority_rationale ?? '',
        f_evidence_strength: fields.f_evidence_strength ?? null, f_exposure: fields.f_exposure ?? null, f_impact: fields.f_impact ?? null,
        f_asset_importance: fields.f_asset_importance ?? null, f_remediation_available: fields.f_remediation_available ?? null,
        retest_notes: fields.retest_notes ?? '', origin: 'manual', created_at: now, updated_at: now,
      });
    } else {
      const patch: Row = { ...fields, updated_at: now };
      delete patch.validation_status;
      // An analyst changing the severity makes it an analyst judgement unless a basis is given.
      if (fields.severity && fields.severity !== existing.severity && !fields.severity_basis) patch.severity_basis = 'analyst';
      db.update('findings', id, patch);
    }
    if (assets) setLinks(db, 'finding_assets', 'finding_id', id, 'asset_id', assets);
    if (services) {
      setLinks(db, 'finding_services', 'finding_id', id, 'service_id', services);
      // A linked service implies its asset is affected.
      for (const sid of services) {
        const s = db.get('SELECT asset_id FROM services WHERE id = ?', sid);
        if (s) db.run('INSERT OR IGNORE INTO finding_assets (finding_id, asset_id) VALUES (?,?)', id, s.asset_id);
      }
    }
    if (evidence) setLinks(db, 'finding_evidence', 'finding_id', id, 'evidence_id', evidence.map((e) => e.id));

    // Validation transitions
    const target = fields.validation_status as string | undefined;
    const current = existing?.validation_status ?? 'potential';
    if (target && target !== current) {
      const row = db.get('SELECT * FROM findings WHERE id = ?', id)!;
      const notes = String(fields.validation_notes ?? row.validation_notes ?? '').trim();
      if (target === 'validated') {
        const active = db.scalar<number>("SELECT COUNT(*) FROM finding_evidence fe JOIN evidence e ON e.id = fe.evidence_id AND e.status = 'active' WHERE fe.finding_id = ?", id);
        if (!active) throw badRequest('A finding can only be marked analyst-validated after at least one active evidence item is linked to it.');
        if (notes.length < 10) throw badRequest('Describe how the finding was validated (at least 10 characters) before marking it analyst-validated. A version string or CVE match alone is not validation.');
        db.update('findings', id, { validation_status: 'validated', validated_by: currentActor(db), validated_at: now });
      } else if (target === 'false_positive') {
        if (notes.length < 10) throw badRequest('Explain why this is a false positive (at least 10 characters).');
        db.update('findings', id, { validation_status: 'false_positive', validated_by: currentActor(db), validated_at: now, priority_rank: null });
      } else {
        db.update('findings', id, { validation_status: target, validated_by: null, validated_at: null });
      }
      addReview(ctx, eid, id, `validation:${target}`, notes);
      logActivity(db, eid, 'finding.validation', 'finding', `${code} validation → ${target.replace('_', ' ')}`, { id, code });
    }
    if (existing && fields.status && fields.status !== existing.status) {
      addReview(ctx, eid, id, `status:${fields.status}`, String(fields.retest_notes ?? existing.retest_notes ?? ''));
      if (fields.status === 'remediated') db.update('findings', id, { priority_rank: null });
    }
    logActivity(db, eid, existing ? 'finding.updated' : 'finding.created', 'finding', existing ? `Updated ${code}` : `Created ${code}: ${fields.title}`, { id, code });
  });
  return id;
}

/* ---------------- Import helpers ---------------- */

interface PlannedRow extends ParsedFinding {
  asset: { id: string; code: string } | null;
  service: { id: string; label: string } | null;
  action: 'create' | 'update';
  existing_code: string | null;
  dedupe_key: string;
}

function findAsset(ctx: Ctx, eid: string, f: ParsedFinding) {
  if (f.host_ip) {
    const a = ctx.db.get('SELECT id, code FROM assets WHERE engagement_id = ? AND ip = ?', eid, f.host_ip);
    if (a) return a as { id: string; code: string };
  }
  if (f.hostname) {
    const hn = f.hostname.toLowerCase();
    const a = ctx.db.get(
      "SELECT id, code FROM assets WHERE engagement_id = ? AND (lower(hostname) = ? OR lower(hostname) = ? OR lower(hostnames) LIKE ?)",
      eid, hn, hn.split('.')[0], `%"${hn}"%`,
    );
    if (a) return a as { id: string; code: string };
  }
  return null;
}

function planImport(ctx: Ctx, eid: string, parsed: FindingParseResult) {
  const warnings = [...parsed.warnings];
  const missingHosts = new Set<string>();
  const rows: PlannedRow[] = parsed.rows.map((f) => {
    const asset = findAsset(ctx, eid, f);
    if (!asset && (f.host_ip || f.hostname)) missingHosts.add(f.host_ip || f.hostname!);
    let service: PlannedRow['service'] = null;
    if (asset && f.port) {
      const s = ctx.db.get('SELECT id, port, protocol, service_name FROM services WHERE asset_id = ? AND port = ? AND protocol = ?', asset.id, f.port, f.protocol ?? 'tcp');
      if (s) service = { id: s.id, label: `${asset.code}:${s.port}/${s.protocol}${s.service_name ? ' ' + s.service_name : ''}` };
    }
    const key = dedupeKey(f, parsed.format);
    const ex = ctx.db.get('SELECT code FROM findings WHERE engagement_id = ? AND dedupe_key = ?', eid, key);
    return { ...f, asset, service, action: ex ? 'update' : 'create', existing_code: ex?.code ?? null, dedupe_key: key };
  });
  for (const h of missingHosts)
    warnings.push({ row: 0, message: `Host ${h} is not in the asset inventory. Its findings will be imported without an asset link (the host is noted in the description). Import the scan first, then link the asset.` });
  return { rows, warnings };
}

const SCANNER_FORMATS: FindingFormat[] = ['nessus', 'greenbone_xml'];

export default function findingRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db, cfg } = ctx;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 20 } });

  r.get('/findings', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const items = listFindings(ctx, eng.id, req.query as any);
    res.json({ items, total: items.length });
  }));

  r.post('/findings', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const body = findingBody.parse(req.body);
    const id = saveFinding(ctx, eng.id, null, body);
    res.status(201).json(findingDetail(ctx, eng.id, id));
  }));

  r.get('/findings/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(findingDetail(ctx, eng.id, req.params.id));
  }));

  r.patch('/findings/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const f = db.get('SELECT * FROM findings WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!f) throw notFound('Finding');
    const body = findingBody.partial().strict().parse(req.body);
    saveFinding(ctx, eng.id, f, body);
    res.json(findingDetail(ctx, eng.id, f.id));
  }));

  r.delete('/findings/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const f = db.get('SELECT * FROM findings WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!f) throw notFound('Finding');
    if (String(req.body?.confirm ?? '') !== f.code) throw badRequest(`Type ${f.code} to confirm deletion.`);
    db.tx(() => {
      db.run("DELETE FROM attack_mappings WHERE target_type = 'finding' AND target_id = ?", f.id);
      db.run('DELETE FROM findings WHERE id = ?', f.id);
      logActivity(db, eng.id, 'finding.deleted', 'finding', `Deleted ${f.code} (${f.title}). Linked evidence was kept.`, { id: f.id, code: f.code });
    });
    res.json({ ok: true });
  }));

  /* ---------- Priorities ---------- */
  r.get('/priorities', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const all = listFindings(ctx, eng.id, { exclude_fp: '1' });
    res.json({
      ranked: all.filter((f) => f.priority_rank).sort((a, b) => a.priority_rank - b.priority_rank),
      candidates: all.filter((f) => f.status !== 'remediated'),
      factors: FACTOR_KEYS,
    });
  }));

  r.put('/priorities', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const body = z
      .object({
        items: z
          .array(
            z.object({
              finding_id: z.string(),
              rank: z.number().int().min(1).max(3),
              rationale: z.string().trim().min(10, 'Each priority needs a rationale of at least 10 characters.').max(5000),
            }).strict(),
          )
          .max(3),
      })
      .strict()
      .parse(req.body);
    const ranks = body.items.map((i) => i.rank);
    if (new Set(ranks).size !== ranks.length) throw badRequest('Each rank (1, 2, 3) can be used only once.');
    const ids = body.items.map((i) => i.finding_id);
    if (new Set(ids).size !== ids.length) throw badRequest('A finding can hold only one priority rank.');
    db.tx(() => {
      for (const it of body.items) {
        const f = db.get('SELECT id, code, validation_status FROM findings WHERE engagement_id = ? AND id = ?', eng.id, it.finding_id);
        if (!f) throw badRequest(`Unknown finding ${it.finding_id}.`);
        if (f.validation_status === 'false_positive') throw badRequest(`${f.code} is marked as a false positive and cannot be prioritized.`);
      }
      db.run('UPDATE findings SET priority_rank = NULL WHERE engagement_id = ?', eng.id);
      for (const it of body.items) db.run('UPDATE findings SET priority_rank = ?, priority_rationale = ?, updated_at = ? WHERE id = ?', it.rank, it.rationale, nowIso(), it.finding_id);
      const codes = body.items.sort((a, b) => a.rank - b.rank).map((i) => db.scalar<string>('SELECT code FROM findings WHERE id = ?', i.finding_id));
      logActivity(db, eng.id, 'finding.priorities', 'finding', `Top priorities set: ${codes.join(', ') || 'cleared'}`);
    });
    res.json({ ok: true });
  }));

  /* ---------- Remediation tasks ---------- */
  const taskBody = z
    .object({
      title: z.string().trim().min(1).max(300),
      owner: z.string().max(200).optional(),
      status: z.enum(['todo', 'in_progress', 'done', 'wont_fix']).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .strict();

  r.get('/remediation-tasks', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(
      db.all(
        `SELECT t.*, f.code AS finding_code, f.title AS finding_title, f.severity, f.status AS finding_status FROM remediation_tasks t JOIN findings f ON f.id = t.finding_id
         WHERE t.engagement_id = ? ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, t.due_date IS NULL, t.due_date, t.created_at`,
        eng.id,
      ),
    );
  }));

  r.post('/findings/:id/tasks', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const f = db.get('SELECT id, code FROM findings WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!f) throw notFound('Finding');
    const b = taskBody.parse(req.body);
    const id = uid();
    db.insert('remediation_tasks', { id, engagement_id: eng.id, finding_id: f.id, title: b.title, owner: b.owner ?? '', status: b.status ?? 'todo', due_date: b.due_date ?? null, notes: b.notes ?? '', created_at: nowIso(), updated_at: nowIso() });
    logActivity(db, eng.id, 'remediation.created', 'remediation_task', `Remediation task for ${f.code}: ${b.title}`, { id });
    res.status(201).json(db.get('SELECT * FROM remediation_tasks WHERE id = ?', id));
  }));

  r.patch('/remediation-tasks/:tid', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const t = db.get('SELECT * FROM remediation_tasks WHERE engagement_id = ? AND id = ?', eng.id, req.params.tid);
    if (!t) throw notFound('Remediation task');
    const b = taskBody.partial().strict().parse(req.body);
    db.update('remediation_tasks', t.id, { ...b, updated_at: nowIso() });
    logActivity(db, eng.id, 'remediation.updated', 'remediation_task', `Updated remediation task “${b.title ?? t.title}”${b.status ? ` → ${b.status.replace('_', ' ')}` : ''}`, { id: t.id });
    res.json(db.get('SELECT * FROM remediation_tasks WHERE id = ?', t.id));
  }));

  r.delete('/remediation-tasks/:tid', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const t = db.get('SELECT * FROM remediation_tasks WHERE engagement_id = ? AND id = ?', eng.id, req.params.tid);
    if (!t) throw notFound('Remediation task');
    db.run('DELETE FROM remediation_tasks WHERE id = ?', t.id);
    logActivity(db, eng.id, 'remediation.deleted', 'remediation_task', `Deleted remediation task “${t.title}”`, { id: t.id });
    res.json({ ok: true });
  }));

  /* ---------- Imports ---------- */
  const importOpts = z.object({
    format: z.enum(['auto', 'normalized_csv', 'normalized_json', 'nessus', 'greenbone_xml']).default('auto'),
    include_info: z.enum(['0', '1', 'true', 'false']).optional(),
    source_category: z.enum(['authorized_lab', 'instructor_supplied', 'demo']).default('instructor_supplied'),
    collected_at: z.string().max(40).optional(),
    title: z.string().max(300).optional(),
  });

  const parseUpload = (req: any) => {
    if (!req.file) throw badRequest('Choose a vulnerability report file.');
    const o = importOpts.parse(req.body ?? {});
    const text = req.file.buffer.toString('utf8');
    const parsed = parseFindingsFile(text, req.file.originalname, {
      format: o.format === 'auto' ? undefined : (o.format as FindingFormat),
      includeInfo: o.include_info === '1' || o.include_info === 'true',
    });
    return { o, parsed };
  };

  r.post('/finding-imports/preview', upload.single('file'), h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const { parsed } = parseUpload(req);
    const plan = planImport(ctx, eng.id, parsed);
    const hash = sha256(req.file!.buffer);
    const prior = db.get(
      `SELECT i.code, i.created_at FROM finding_imports i JOIN evidence e ON e.id = i.evidence_id WHERE i.engagement_id = ? AND e.sha256 = ? ORDER BY i.created_at DESC LIMIT 1`,
      eng.id, hash,
    );
    res.json({
      format: parsed.format,
      scanner: parsed.scanner,
      total_rows: parsed.total_rows,
      valid_rows: plan.rows.length,
      skipped_info: parsed.skipped_info,
      errors: parsed.errors,
      warnings: plan.warnings,
      unknown_columns: parsed.unknown_columns,
      rows: plan.rows,
      to_create: plan.rows.filter((r) => r.action === 'create').length,
      to_update: plan.rows.filter((r) => r.action === 'update').length,
      initial_validation_status: SCANNER_FORMATS.includes(parsed.format) ? 'scanner_reported' : 'potential',
      previously_imported: prior ? { code: prior.code, created_at: prior.created_at } : null,
      sha256: hash,
    });
  }));

  r.post('/finding-imports', upload.single('file'), h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const { o, parsed } = parseUpload(req);
    if (!parsed.rows.length)
      throw badRequest(parsed.errors.length ? `No valid findings to import. ${parsed.errors.slice(0, 3).map((e) => (e.row ? `Row ${e.row}: ` : '') + e.message).join(' ')}` : 'The file contains no findings to import.', { errors: parsed.errors });
    const plan = planImport(ctx, eng.id, parsed);
    const hash = sha256(req.file!.buffer);
    const category = (eng.is_demo ? 'demo' : o.source_category === 'demo' ? 'instructor_supplied' : o.source_category) as SourceCategory;

    // Reuse the stored artifact when this exact file was already imported (re-import updates findings instead of duplicating them).
    const existingEv = db.get("SELECT id, code FROM evidence WHERE engagement_id = ? AND sha256 = ? AND status = 'active' ORDER BY created_at LIMIT 1", eng.id, hash);
    let evidenceId: string;
    let evidenceCode: string;
    const warnings = [...plan.warnings];
    if (existingEv) {
      evidenceId = existingEv.id;
      evidenceCode = existingEv.code;
      warnings.push({ row: 0, message: `This exact file is already stored as ${existingEv.code}; it was reused instead of storing a duplicate copy.` });
    } else {
      const stored = storeFileEvidence(db, cfg, {
        engagementId: eng.id,
        buffer: req.file!.buffer,
        originalFilename: req.file!.originalname,
        sourceCategory: category,
        sourceTool: parsed.scanner || 'Vulnerability report (normalized)',
        title: o.title || `Vulnerability report: ${req.file!.originalname}`,
        collectedAt: o.collected_at || null,
        observation: `${parsed.scanner || 'Normalized'} vulnerability report with ${parsed.total_rows} row(s).`,
        tags: ['vulnerability-report', parsed.format],
        analysisStatus: 'parsed',
        analysisNote: `Parsed as ${parsed.format}: ${plan.rows.length} usable row(s), ${parsed.errors.length} error(s), ${parsed.skipped_info} informational row(s) skipped.`,
        assetIds: [...new Set(plan.rows.map((r) => r.asset?.id).filter(Boolean) as string[])],
      });
      evidenceId = stored.id;
      evidenceCode = stored.code;
    }

    const initialValidation = SCANNER_FORMATS.includes(parsed.format) ? 'scanner_reported' : 'potential';
    const importId = uid();
    let code = '';
    let created = 0, updated = 0, unchanged = 0;
    const createdCodes: string[] = [];
    db.tx(() => {
      code = nextCode(db, eng.id, 'finding_import');
      db.insert('finding_imports', {
        id: importId, engagement_id: eng.id, code, evidence_id: evidenceId, format: parsed.format, scanner: parsed.scanner,
        status: 'complete', rows_total: parsed.total_rows, created_by: currentActor(db), created_at: nowIso(),
      });
      const now = nowIso();
      for (const row of plan.rows) {
        const hostNote = !row.asset && (row.host_ip || row.hostname) ? `\n\n[Import note] Reported host: ${row.host_ip ?? row.hostname}${row.port ? ` port ${row.port}/${row.protocol}` : ''} — not linked because the host is not in the asset inventory.` : '';
        const existing = db.get('SELECT * FROM findings WHERE engagement_id = ? AND dedupe_key = ?', eng.id, row.dedupe_key);
        if (existing) {
          const patch: Row = {
            description: existing.description || row.description + hostNote,
            cves: JSON.stringify([...new Set([...parseJson<string[]>(existing.cves, []), ...row.cves])]),
            cvss_score: existing.cvss_source && existing.cvss_source !== row.scanner ? existing.cvss_score : row.cvss_score ?? existing.cvss_score,
            cvss_version: existing.cvss_source && existing.cvss_source !== row.scanner ? existing.cvss_version : row.cvss_version ?? existing.cvss_version,
            cvss_vector: existing.cvss_source && existing.cvss_source !== row.scanner ? existing.cvss_vector : row.cvss_vector ?? existing.cvss_vector,
            remediation: existing.remediation || row.remediation,
            severity: existing.severity_basis === 'scanner' ? row.severity : existing.severity,
          };
          const changed = Object.entries(patch).some(([k, v]) => String(v ?? '') !== String(existing[k] ?? ''));
          const linked = db.get('SELECT 1 FROM finding_evidence WHERE finding_id = ? AND evidence_id = ?', existing.id, evidenceId);
          if (changed) db.update('findings', existing.id, { ...patch, import_id: importId, updated_at: now });
          db.run('INSERT OR IGNORE INTO finding_evidence (finding_id, evidence_id) VALUES (?,?)', existing.id, evidenceId);
          if (row.asset) db.run('INSERT OR IGNORE INTO finding_assets (finding_id, asset_id) VALUES (?,?)', existing.id, row.asset.id);
          if (row.service) db.run('INSERT OR IGNORE INTO finding_services (finding_id, service_id) VALUES (?,?)', existing.id, row.service.id);
          if (changed || !linked) updated++;
          else unchanged++;
          continue;
        }
        const id = uid();
        const fcode = nextCode(db, eng.id, 'finding');
        db.insert('findings', {
          id, engagement_id: eng.id, code: fcode, title: row.title,
          description: row.description + hostNote + (row.evidence_note ? `\n\nSource detail: ${row.evidence_note}` : ''),
          severity: row.severity, severity_basis: 'scanner', cves: row.cves,
          cvss_score: row.cvss_score, cvss_version: row.cvss_version, cvss_vector: row.cvss_vector, cvss_source: row.cvss_score !== null ? row.scanner || parsed.scanner || 'imported file' : null,
          impact: row.impact, remediation: row.remediation, validation_status: initialValidation, status: 'open',
          scanner_name: row.scanner || parsed.scanner || null, scanner_plugin_id: row.plugin_id, dedupe_key: row.dedupe_key,
          origin: 'import', import_id: importId, created_at: now, updated_at: now,
        });
        db.run('INSERT INTO finding_evidence (finding_id, evidence_id) VALUES (?,?)', id, evidenceId);
        if (row.asset) db.run('INSERT OR IGNORE INTO finding_assets (finding_id, asset_id) VALUES (?,?)', id, row.asset.id);
        if (row.service) db.run('INSERT OR IGNORE INTO finding_services (finding_id, service_id) VALUES (?,?)', id, row.service.id);
        created++;
        createdCodes.push(fcode);
      }
      const status = parsed.errors.length ? 'partial' : 'complete';
      db.update('finding_imports', importId, {
        status, created_count: created, updated_count: updated, skipped_count: unchanged + parsed.skipped_info + parsed.errors.length,
        warnings, errors: parsed.errors,
      });
      logActivity(db, eng.id, 'finding_import.created', 'finding_import', `${code}: imported ${parsed.format} (${created} new, ${updated} updated, ${unchanged} unchanged) from ${evidenceCode}`, { id: importId, code });
    });
    res.status(201).json({
      ...db.get('SELECT * FROM finding_imports WHERE id = ?', importId),
      warnings, errors: parsed.errors, evidence_code: evidenceCode, evidence_id: evidenceId,
      created, updated, unchanged, skipped_info: parsed.skipped_info, created_codes: createdCodes,
    });
  }));

  r.get('/finding-imports', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    res.json(
      db
        .all(
          `SELECT i.*, e.code AS evidence_code, e.original_filename, e.sha256 FROM finding_imports i LEFT JOIN evidence e ON e.id = i.evidence_id WHERE i.engagement_id = ? ORDER BY i.created_at DESC`,
          eng.id,
        )
        .map((i) => ({ ...i, warnings: parseJson(i.warnings, []), errors: parseJson(i.errors, []) })),
    );
  }));

  r.get('/findings-template.csv', h((_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="findings-template.csv"');
    res.send(FINDINGS_TEMPLATE_CSV);
  }));

  /* ---------- Exports (all records, never just a page) ---------- */
  r.get('/exports/findings.:fmt', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const items = listFindings(ctx, eng.id, req.query as any);
    const rows = items.map((f: any) => ({
      finding_id: f.code, title: f.title, severity: f.severity, severity_basis: f.severity_basis,
      validation_status: f.validation_status, status: f.status, owner: f.owner,
      assets: f.assets.map((a: any) => `${a.code} ${a.ip ?? a.hostname}`).join('; '), services: f.service_labels ?? '',
      cves: f.cves.join('; '), cvss_score: f.cvss_score ?? '', cvss_version: f.cvss_version ?? '', cvss_vector: f.cvss_vector ?? '', cvss_source: f.cvss_source ?? '',
      evidence_ids: f.evidence.map((e: any) => e.code).join('; '), description: f.description, impact: f.impact, remediation: f.remediation,
      priority_rank: f.priority_rank ?? '', priority_rationale: f.priority_rationale, validation_notes: f.validation_notes, validated_by: f.validated_by ?? '',
      validated_at: f.validated_at ?? '', retest_notes: f.retest_notes, origin: f.origin, import: f.import_code ?? '', created_at: f.created_at, updated_at: f.updated_at,
    }));
    logActivity(db, eng.id, 'export.findings', 'export', `Exported ${rows.length} findings (${req.params.fmt})`);
    const stamp = new Date().toISOString().slice(0, 10);
    if (req.params.fmt === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="findings-${stamp}.csv"`);
      return res.send(toCsv(rows));
    }
    if (req.params.fmt === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="findings-${stamp}.json"`);
      return res.json({ engagement: eng.name, is_demo: !!eng.is_demo, exported_at: nowIso(), count: rows.length, findings: rows });
    }
    throw badRequest('Use .csv or .json');
  }));

  return r;
}
