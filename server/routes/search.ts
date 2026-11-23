import { Router } from 'express';
import type { Ctx } from '../app.js';
import { engagementFrom } from '../app.js';
import { h } from '../lib/http.js';

/** Global search across all record types in one engagement. Returns app routes for each hit. */
export default function searchRoutes(ctx: Ctx) {
  const r = Router({ mergeParams: true });
  const { db } = ctx;
  r.get('/search', h((req, res) => {
    const eng = engagementFrom(ctx, req);
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json({ q, results: [] });
    const like = `%${q}%`;
    const e = eng.id;
    const results = [
      ...db.all(`SELECT 'evidence' type, id, code, title AS label, source_tool AS meta FROM evidence WHERE engagement_id = ? AND (code LIKE ? OR title LIKE ? OR original_filename LIKE ? OR sha256 LIKE ? OR observation LIKE ? OR tags LIKE ?) LIMIT 8`, e, like, like, like, like, like, like)
        .map((x) => ({ ...x, route: `/evidence/${x.id}` })),
      ...db.all(`SELECT 'asset' type, id, code, COALESCE(NULLIF(hostname,''), ip) AS label, ip AS meta FROM assets WHERE engagement_id = ? AND (code LIKE ? OR ip LIKE ? OR hostname LIKE ? OR hostnames LIKE ? OR os_name LIKE ?) LIMIT 8`, e, like, like, like, like, like)
        .map((x) => ({ ...x, route: `/scan/assets/${x.id}` })),
      ...db.all(`SELECT 'service' type, s.id, a.code || ':' || s.port || '/' || s.protocol AS code, COALESCE(s.service_name,'') || ' ' || COALESCE(s.product,'') || ' ' || COALESCE(s.version,'') AS label, a.ip AS meta, a.id AS asset_id FROM services s JOIN assets a ON a.id = s.asset_id WHERE s.engagement_id = ? AND (s.service_name LIKE ? OR s.product LIKE ? OR s.version LIKE ? OR CAST(s.port AS TEXT) = ?) LIMIT 8`, e, like, like, like, q)
        .map((x) => ({ ...x, route: `/scan/assets/${x.asset_id}` })),
      ...db.all(`SELECT 'finding' type, id, code, title AS label, severity AS meta FROM findings WHERE engagement_id = ? AND (code LIKE ? OR title LIKE ? OR description LIKE ? OR cves LIKE ?) LIMIT 8`, e, like, like, like, like)
        .map((x) => ({ ...x, route: `/vulnerabilities/${x.id}` })),
      ...db.all(`SELECT 'recon' type, id, code, value AS label, classification AS meta FROM recon_observations WHERE engagement_id = ? AND (code LIKE ? OR value LIKE ? OR description LIKE ? OR analyst_notes LIKE ?) LIMIT 8`, e, like, like, like, like)
        .map((x) => ({ ...x, route: `/recon?focus=${x.id}` })),
      ...db.all(`SELECT 'indicator' type, id, code, title AS label, lab AS meta FROM indicators WHERE engagement_id = ? AND (code LIKE ? OR title LIKE ? OR observation LIKE ? OR value LIKE ?) LIMIT 8`, e, like, like, like, like)
        .map((x) => ({ ...x, route: x.meta === 'lab1' ? `/engagement?tab=indicators&focus=${x.id}` : `/attack?tab=indicators&focus=${x.id}` })),
      ...db.all(`SELECT 'timeline' type, id, code, observation AS label, original_timestamp AS meta FROM timeline_events WHERE engagement_id = ? AND (code LIKE ? OR observation LIKE ? OR student_interpretation LIKE ? OR source_host LIKE ? OR dest_host LIKE ?) LIMIT 8`, e, like, like, like, like, like)
        .map((x) => ({ ...x, route: `/attack?tab=timeline&focus=${x.id}` })),
      ...db.all(`SELECT 'ai' type, id, code, task_type AS label, review_status AS meta FROM ai_sessions WHERE engagement_id = ? AND (code LIKE ? OR question LIKE ? OR response_text LIKE ?) LIMIT 6`, e, like, like, like)
        .map((x) => ({ ...x, route: `/ai/${x.id}` })),
    ];
    res.json({ q, results });
  }));
  return r;
}
