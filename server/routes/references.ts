import { Router } from 'express';
import multer from 'multer';
import type { Ctx } from '../app.js';
import { badRequest, h } from '../lib/http.js';
import { logActivity } from '../lib/activity.js';
import {
  lookupCve, kevLookup, refreshKev, refreshAttack, getAttackTechniques, lookupTechnique, importReferenceDataset, referenceStatus,
} from '../services/refs.js';
import { CVE_RE } from '../importers/findings.js';

const TECH_RE = /^T\d{4}(\.\d{3})?$/i;

export default function referenceRoutes(ctx: Ctx) {
  const r = Router();
  const { db, cfg } = ctx;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(cfg.maxUploadBytes, 120 * 1024 * 1024), files: 1 } });

  r.get('/references/status', h((_req, res) => res.json(referenceStatus(db, cfg))));

  r.get(
    '/references/cve/:cveId',
    h(async (req, res) => {
      const id = String(req.params.cveId).toUpperCase();
      if (!CVE_RE.test(id)) throw badRequest('CVE identifiers look like CVE-2021-41617.');
      const out = await lookupCve(db, cfg, id, { refresh: req.query.refresh === '1', cachedOnly: req.query.cached_only === '1' });
      if (!out.cached && out.state === 'ok') logActivity(db, null, 'reference.nvd_lookup', 'reference', `Retrieved ${id} from NVD`);
      res.json({ ...out, kev: kevLookup(db, id) });
    }),
  );

  r.get(
    '/references/kev/:cveId',
    h((req, res) => {
      const id = String(req.params.cveId).toUpperCase();
      if (!CVE_RE.test(id)) throw badRequest('CVE identifiers look like CVE-2021-41617.');
      res.json(kevLookup(db, id));
    }),
  );

  r.post(
    '/references/kev/refresh',
    h(async (_req, res) => {
      const out = await refreshKev(db, cfg);
      logActivity(db, null, 'reference.kev_refresh', 'reference', `KEV catalog refresh: ${out.message}`);
      res.json(out);
    }),
  );

  r.post(
    '/references/attack/refresh',
    h(async (_req, res) => {
      const out = await refreshAttack(db, cfg);
      logActivity(db, null, 'reference.attack_refresh', 'reference', `ATT&CK refresh: ${out.message}`);
      res.json(out);
    }),
  );

  r.get(
    '/references/attack/techniques',
    h((req, res) => {
      const cat = getAttackTechniques(db);
      if (!cat) return res.json({ state: 'not_loaded', message: 'ATT&CK data has not been loaded. Refresh it in Settings or import the STIX bundle.', techniques: [], total: 0 });
      const q = String(req.query.q ?? '').trim().toLowerCase();
      const tactic = String(req.query.tactic ?? '').trim().toLowerCase();
      let list = cat.techniques;
      if (q) list = list.filter((t) => t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
      if (tactic) list = list.filter((t) => t.tactics.includes(tactic));
      const limit = Math.min(Number(req.query.limit ?? 50), 1000);
      res.json({ state: 'ok', version: cat.version, retrieved_at: cat.retrieved_at, origin: cat.origin, total: list.length, techniques: list.slice(0, limit), tactics: cat.tactics });
    }),
  );

  r.get(
    '/references/attack/technique/:tid',
    h((req, res) => {
      const tid = String(req.params.tid).toUpperCase();
      if (!TECH_RE.test(tid)) throw badRequest('Technique IDs look like T1046 or T1110.001.');
      const cat = getAttackTechniques(db);
      if (!cat) return res.json({ state: 'not_loaded', technique: null, message: 'ATT&CK data has not been loaded.' });
      const t = lookupTechnique(db, tid);
      res.json(t ? { state: 'ok', technique: t, version: cat.version, retrieved_at: cat.retrieved_at } : { state: 'not_found', technique: null, version: cat.version, message: `${tid} is not an active technique in ATT&CK ${cat.version}.` });
    }),
  );

  r.post(
    '/references/import',
    upload.single('file'),
    h((req, res) => {
      if (!req.file) throw badRequest('Choose a reference dataset file (JSON).');
      let out;
      try {
        out = importReferenceDataset(db, req.file.buffer.toString('utf8'), req.file.originalname);
      } catch (e: any) {
        throw badRequest(e.message);
      }
      logActivity(db, null, 'reference.imported', 'reference', `Imported reference dataset ${req.file.originalname}: ${out.message}`);
      res.status(201).json({ ...out, origin: 'imported', note: 'Imported reference data is labeled “imported” and shows the file name as its source.' });
    }),
  );

  return r;
}
