import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { badRequest, h, notFound } from '../lib/http.js';
import { nextCode, nowIso, uid } from '../lib/codes.js';
import { parseJson } from '../db/index.js';
import { logActivity } from '../lib/activity.js';
import { checkScope } from '../lib/scope.js';
import { toCsv } from '../lib/csv.js';
import { commitScan, previewScan, type ScanFormat } from '../importers/scanImport.js';
import { SCAN_CSV_TEMPLATE } from '../importers/scanTabular.js';
import { isIp } from '../importers/scanTypes.js';

const FORMAT = z.enum(['nmap_xml', 'csv', 'json', 'raw_text']).optional();
const boolish = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true' || v === '1' || v === 'on').optional();

export const SCAN_JSON_TEMPLATE = {
  synthetic_note: 'SYNTHETIC TEMPLATE EXAMPLE — replace with your authorized scan results.',
  tool: 'Nmap',
  tool_version: '7.94',
  command: 'nmap -sV -oX scan.xml <INSTRUCTOR-APPROVED-TARGET>',
  scanned_at: '2026-10-12T14:05:00Z',
  hosts: [
    {
      ip: '192.0.2.10',
      hostname: 'web01.cyberdome.example',
      os: 'Linux',
      ports: [
        { port: 22, protocol: 'tcp', state: 'open', service: 'ssh', product: 'OpenSSH', version: '8.2p1', version_status: 'detected', notes: '' },
        { port: 80, protocol: 'tcp', state: 'open', service: 'http', product: 'Apache httpd', version: '', version_status: 'unknown', notes: 'Version not shown' },
      ],
    },
  ],
};

const assetSelect = `SELECT a.*,
   (SELECT COUNT(*) FROM services s WHERE s.asset_id = a.id AND s.state = 'open') AS open_services,
   (SELECT COUNT(*) FROM services s WHERE s.asset_id = a.id) AS total_services,
   (SELECT COUNT(*) FROM finding_assets fa JOIN findings f ON f.id = fa.finding_id WHERE fa.asset_id = a.id AND f.validation_status <> 'false_positive') AS findings,
   (SELECT COUNT(*) FROM evidence_assets ea JOIN evidence e ON e.id = ea.evidence_id AND e.status = 'active' WHERE ea.asset_id = a.id) AS evidence_count
 FROM assets a`;

const serviceSelect = `SELECT s.*, a.code AS asset_code, a.ip, a.hostname, a.criticality,
   si.code AS last_scan_code,
   (SELECT COUNT(*) FROM finding_services fs JOIN findings f ON f.id = fs.finding_id WHERE fs.service_id = s.id AND f.validation_status <> 'false_positive') AS findings
 FROM services s JOIN assets a ON a.id = s.asset_id LEFT JOIN scan_imports si ON si.id = s.last_scan_import_id`;

export default function scansRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db, cfg } = ctx;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 20 } });

  const hydrateAsset = (eid: string, a: any) => ({
    ...a,
    hostnames: parseJson<string[]>(a.hostnames, []),
    scope: checkScope(db, eid, a.ip, a.hostname || null),
  });

  // ---------- Imports ----------
  r.post('/scan-imports/preview', upload.single('file'), h((req, res) => {
    const eng = engagementFrom(ctx, req);
    if (!req.file) throw badRequest('Choose a scan file to preview.');
    const format = FORMAT.parse(req.body?.format || undefined) as ScanFormat | undefined;
    res.json(previewScan(ctx, eng, req.file.buffer, req.file.originalname, format));
  }));

  r.post('/scan-imports', upload.single('file'), h((req, res) => {
    const eng = engagementFrom(ctx, req);
    if (!req.file) throw badRequest('Choose a scan file to import.');
    const b = z
      .object({
        source_category: z.enum(['authorized_lab', 'instructor_supplied', 'demo']).default('authorized_lab'),
        collected_at: z.string().max(40).optional(),
        allow_duplicate: boolish,
        store_raw: boolish,
        format: FORMAT,
        title: z.string().max(300).optional(),
      })
      .parse(req.body ?? {});
    const result = commitScan(ctx, eng, req.file.buffer, req.file.originalname, {
      sourceCategory: b.source_category,
      collectedAt: b.collected_at || null,
      allowDuplicate: b.allow_duplicate,
      storeRaw: b.store_raw,
      forced: b.format as ScanFormat | undefined,
      title: b.title,
    });
    res.status(201).json(result);
  }));

  r.get('/scan-imports', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = db.all(
      `SELECT si.*, e.code AS evidence_code, e.original_filename, e.sha256, e.status AS evidence_status, d.code AS duplicate_of_code
       FROM scan_imports si LEFT JOIN evidence e ON e.id = si.evidence_id LEFT JOIN scan_imports d ON d.id = si.duplicate_of_import_id
       WHERE si.engagement_id = ? ORDER BY si.created_at DESC`,
      eng.id,
    );
    res.json(rows.map((x) => ({ ...x, warnings: parseJson(x.warnings, []), errors: parseJson(x.errors, []) })));
  }));

  r.get('/scan-imports/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const si = db.get(
      `SELECT si.*, e.code AS evidence_code, e.original_filename, e.sha256, e.status AS evidence_status, e.source_category, d.code AS duplicate_of_code
       FROM scan_imports si LEFT JOIN evidence e ON e.id = si.evidence_id LEFT JOIN scan_imports d ON d.id = si.duplicate_of_import_id
       WHERE si.engagement_id = ? AND (si.id = ? OR si.code = ?)`,
      eng.id, req.params.id, req.params.id,
    );
    if (!si) throw notFound('Scan import');
    const observations = db.all(
      `SELECT o.*, a.code AS asset_code FROM service_observations o JOIN assets a ON a.id = o.asset_id WHERE o.scan_import_id = ? ORDER BY a.code, o.protocol, o.port`,
      si.id,
    );
    res.json({ ...si, warnings: parseJson(si.warnings, []), errors: parseJson(si.errors, []), observations });
  }));

  // ---------- Assets ----------
  r.get('/assets', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = db.all(`${assetSelect} WHERE a.engagement_id = ? ORDER BY a.code`, eng.id);
    res.json(rows.map((a) => hydrateAsset(eng.id, a)));
  }));

  const assetCreate = z
    .object({
      ip: z.string().trim().max(64).optional(),
      hostname: z.string().trim().max(255).optional(),
      criticality: z.enum(['unknown', 'low', 'medium', 'high', 'critical']).optional(),
      role: z.string().max(200).optional(),
      notes: z.string().max(8000).optional(),
      os_name: z.string().max(200).optional(),
    })
    .strict();
  r.post('/assets', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const b = assetCreate.parse(req.body);
    if (!b.ip && !b.hostname) throw badRequest('Provide an IP address or a hostname.');
    if (b.ip && !isIp(b.ip)) throw badRequest(`“${b.ip}” is not a valid IP address.`);
    if (b.ip && db.get('SELECT id FROM assets WHERE engagement_id = ? AND ip = ?', eng.id, b.ip)) throw badRequest(`An asset with IP ${b.ip} already exists.`);
    const id = uid();
    const now = nowIso();
    const code = nextCode(db, eng.id, 'asset');
    db.insert('assets', {
      id, engagement_id: eng.id, code, ip: b.ip || null, hostname: b.hostname ?? '', hostnames: b.hostname ? [b.hostname] : [],
      criticality: b.criticality ?? 'unknown', role: b.role ?? '', notes: b.notes ?? '',
      os_name: b.os_name || null, os_source: b.os_name ? 'analyst' : 'unknown', origin: 'manual', created_at: now, updated_at: now,
    });
    logActivity(db, eng.id, 'asset.created', 'asset', `Added asset ${code} (${b.ip || b.hostname}) manually`, { id, code });
    const a = db.get(`${assetSelect} WHERE a.id = ?`, id);
    res.status(201).json(hydrateAsset(eng.id, a));
  }));

  r.get('/assets/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const a = db.get(`${assetSelect} WHERE a.engagement_id = ? AND (a.id = ? OR a.code = ?)`, eng.id, req.params.id, req.params.id);
    if (!a) throw notFound('Asset');
    const services = db.all(`${serviceSelect} WHERE s.asset_id = ? ORDER BY s.protocol, s.port`, a.id);
    const observations = db.all(
      `SELECT o.*, si.code AS scan_code, e.code AS evidence_code, e.status AS evidence_status
       FROM service_observations o JOIN scan_imports si ON si.id = o.scan_import_id LEFT JOIN evidence e ON e.id = o.evidence_id
       WHERE o.asset_id = ? ORDER BY o.protocol, o.port, COALESCE(o.observed_at, o.created_at) DESC`,
      a.id,
    );
    const osObservations = db.all(
      `SELECT DISTINCT o.os_observation, o.observed_at, si.code AS scan_code, e.id AS evidence_id, e.code AS evidence_code
       FROM service_observations o JOIN scan_imports si ON si.id = o.scan_import_id LEFT JOIN evidence e ON e.id = o.evidence_id
       WHERE o.asset_id = ? AND o.os_observation IS NOT NULL GROUP BY o.scan_import_id ORDER BY o.observed_at DESC`,
      a.id,
    );
    const findings = db.all(
      `SELECT f.id, f.code, f.title, f.severity, f.validation_status, f.status FROM finding_assets fa JOIN findings f ON f.id = fa.finding_id WHERE fa.asset_id = ? ORDER BY f.code`,
      a.id,
    );
    const evidence = db.all(
      `SELECT e.id, e.code, e.title, e.status, e.source_category, e.sanitization_status, e.collected_at FROM evidence_assets ea JOIN evidence e ON e.id = ea.evidence_id WHERE ea.asset_id = ? ORDER BY e.code`,
      a.id,
    );
    const scans = db.all(
      `SELECT DISTINCT si.id, si.code, si.created_at, si.scan_finished_at, si.status FROM service_observations o JOIN scan_imports si ON si.id = o.scan_import_id WHERE o.asset_id = ? ORDER BY si.created_at`,
      a.id,
    );
    res.json({ ...hydrateAsset(eng.id, a), services, observations, os_observations: osObservations, findings, evidence, scans });
  }));

  const assetPatch = z
    .object({
      criticality: z.enum(['unknown', 'low', 'medium', 'high', 'critical']).optional(),
      role: z.string().max(200).optional(),
      notes: z.string().max(8000).optional(),
      hostname: z.string().trim().max(255).optional(),
      os_name: z.string().trim().max(200).nullable().optional(),
    })
    .strict();
  r.patch('/assets/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const a = db.get('SELECT * FROM assets WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!a) throw notFound('Asset');
    const b = assetPatch.parse(req.body);
    const patch: Record<string, any> = { ...b, updated_at: nowIso() };
    if (b.os_name !== undefined) {
      // Analyst-entered OS is labeled as such; clearing it reverts to unknown (detections remain in history).
      patch.os_source = b.os_name ? 'analyst' : 'unknown';
      patch.os_name = b.os_name || null;
      patch.os_accuracy = null;
    }
    db.update('assets', a.id, patch);
    logActivity(db, eng.id, 'asset.updated', 'asset', `Updated ${a.code}: ${Object.keys(b).join(', ')}`, { id: a.id, code: a.code });
    const out = db.get(`${assetSelect} WHERE a.id = ?`, a.id);
    res.json(hydrateAsset(eng.id, out));
  }));

  // ---------- Services ----------
  r.get('/services', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const q = req.query as Record<string, string>;
    const where = ['s.engagement_id = ?'];
    const p: any[] = [eng.id];
    if (q.state) { where.push('s.state = ?'); p.push(q.state); }
    if (q.protocol) { where.push('s.protocol = ?'); p.push(q.protocol); }
    if (q.asset) { where.push('(a.id = ? OR a.code = ?)'); p.push(q.asset, q.asset); }
    if (q.needs_investigation === '1') where.push('s.needs_investigation = 1');
    if (q.version_status) { where.push('s.version_status = ?'); p.push(q.version_status); }
    if (q.q) {
      const like = `%${q.q}%`;
      where.push('(s.service_name LIKE ? OR s.product LIKE ? OR s.version LIKE ? OR a.ip LIKE ? OR a.hostname LIKE ? OR CAST(s.port AS TEXT) = ?)');
      p.push(like, like, like, like, like, q.q);
    }
    res.json(db.all(`${serviceSelect} WHERE ${where.join(' AND ')} ORDER BY a.code, s.protocol, s.port`, ...p));
  }));

  const servicePatch = z
    .object({
      normal_purpose: z.string().max(4000).optional(),
      analyst_notes: z.string().max(8000).optional(),
      needs_investigation: z.boolean().optional(),
      investigation_reason: z.string().max(4000).optional(),
    })
    .strict();
  r.patch('/services/:id', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const s = db.get('SELECT s.*, a.code AS asset_code FROM services s JOIN assets a ON a.id = s.asset_id WHERE s.engagement_id = ? AND s.id = ?', eng.id, req.params.id);
    if (!s) throw notFound('Service');
    const b = servicePatch.parse(req.body);
    if (b.needs_investigation && !(b.investigation_reason ?? s.investigation_reason).trim())
      throw badRequest('Explain why this service needs further investigation.');
    db.update('services', s.id, { ...b, needs_investigation: b.needs_investigation === undefined ? undefined : b.needs_investigation ? 1 : 0, updated_at: nowIso() });
    const label = `${s.asset_code} ${s.port}/${s.protocol}`;
    logActivity(
      db, eng.id, 'service.updated', 'service',
      b.needs_investigation === true ? `Flagged ${label} for further investigation` : b.needs_investigation === false ? `Cleared investigation flag on ${label}` : `Updated analyst notes on ${label}`,
      { id: s.id, code: label },
    );
    res.json(db.get(`${serviceSelect} WHERE s.id = ?`, s.id));
  }));

  r.get('/services/:id/history', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const s = db.get('SELECT * FROM services WHERE engagement_id = ? AND id = ?', eng.id, req.params.id);
    if (!s) throw notFound('Service');
    res.json(
      db.all(
        `SELECT o.*, si.code AS scan_code, e.code AS evidence_code, e.id AS evidence_id, e.status AS evidence_status
         FROM service_observations o JOIN scan_imports si ON si.id = o.scan_import_id LEFT JOIN evidence e ON e.id = o.evidence_id
         WHERE o.asset_id = ? AND o.port = ? AND o.protocol = ? ORDER BY COALESCE(o.observed_at, o.created_at) DESC`,
        s.asset_id, s.port, s.protocol,
      ),
    );
  }));

  // ---------- Exports & templates ----------
  r.get('/exports/assets.csv', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = db.all(`${assetSelect} WHERE a.engagement_id = ? ORDER BY a.code`, eng.id).map((a) => {
      const sc = checkScope(db, eng.id, a.ip, a.hostname || null);
      return {
        asset_id: a.code, ip: a.ip ?? '', hostname: a.hostname, other_hostnames: parseJson<string[]>(a.hostnames, []).join('; '),
        os: a.os_name ?? '', os_source: a.os_source, os_accuracy: a.os_accuracy ?? '', criticality: a.criticality, role: a.role,
        host_state: a.host_state, scope_status: sc.status, open_services: a.open_services, total_services: a.total_services,
        findings: a.findings, evidence_items: a.evidence_count, first_seen: a.first_seen ?? '', last_seen: a.last_seen ?? '', origin: a.origin, notes: a.notes,
      };
    });
    logActivity(db, eng.id, 'export.assets', 'export', `Exported asset inventory (${rows.length} rows)`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="assets-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(rows, rows.length ? undefined : ['asset_id', 'ip', 'hostname']));
  }));

  r.get('/exports/services.csv', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const rows = db.all(`${serviceSelect} WHERE s.engagement_id = ? ORDER BY a.code, s.protocol, s.port`, eng.id).map((s) => ({
      asset_id: s.asset_code, ip: s.ip ?? '', hostname: s.hostname, port: s.port, protocol: s.protocol, state: s.state,
      service: s.service_name ?? '', product: s.product ?? '', version: s.version ?? '', version_status: s.version_status,
      first_seen: s.first_seen ?? '', last_seen: s.last_seen ?? '', observations: s.observation_count, last_scan: s.last_scan_code ?? '',
      normal_purpose: s.normal_purpose, needs_investigation: s.needs_investigation ? 'yes' : 'no', investigation_reason: s.investigation_reason,
      analyst_notes: s.analyst_notes, linked_findings: s.findings,
    }));
    logActivity(db, eng.id, 'export.services', 'export', `Exported service inventory (${rows.length} rows)`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="services-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(rows, rows.length ? undefined : ['asset_id', 'ip', 'port', 'protocol', 'state']));
  }));

  r.get('/scan-template.csv', (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cyberdome-scan-template.csv"');
    res.send(SCAN_CSV_TEMPLATE);
  });
  r.get('/scan-template.json', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="cyberdome-scan-template.json"');
    res.json(SCAN_JSON_TEMPLATE);
  });

  return r;
}

