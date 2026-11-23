import { Router } from 'express';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import type { Ctx } from '../app.js';
import { h } from '../lib/http.js';
import { logActivity } from '../lib/activity.js';
import { applySavedAi, publicAi, readSavedAi, writeSavedAi } from '../services/aiSettings.js';
import { callProvider, ProviderError } from '../services/ai/provider.js';
import { HttpError } from '../lib/http.js';
import { nmapInfo } from '../services/nmapRunner.js';

export function aiStatus(ctx: Ctx) {
  const a = ctx.cfg.ai;
  if (a.provider === 'anthropic')
    return a.anthropicApiKey
      ? { state: 'configured', provider: 'anthropic', model: a.anthropicModel, endpoint: a.anthropicBaseUrl }
      : { state: 'misconfigured', provider: 'anthropic', model: a.anthropicModel, message: 'Anthropic is selected but no API key is saved. Add one in Settings → AI provider.' };
  if (a.provider === 'openai')
    return a.openaiApiKey || !a.openaiBaseUrl.includes('api.openai.com')
      ? { state: 'configured', provider: 'openai', model: a.openaiModel, endpoint: a.openaiBaseUrl }
      : { state: 'misconfigured', provider: 'openai', model: a.openaiModel, message: 'OpenAI is selected but no API key is saved. Add one in Settings → AI provider, or point the base URL at a local server such as Ollama.' };
  return { state: 'not_configured', provider: 'none', model: null, message: 'No AI provider is configured. Add one in Settings → AI provider.' };
}

let tsharkCache: { checked: number; path: string | null; version: string | null } | null = null;
export function tsharkInfo(ctx: Ctx) {
  if (tsharkCache && Date.now() - tsharkCache.checked < 60_000) return tsharkCache;
  const bin = ctx.cfg.tsharkPath || 'tshark';
  try {
    const out = execFileSync(bin, ['--version'], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    tsharkCache = { checked: Date.now(), path: bin, version: out.split('\n')[0].trim() };
  } catch {
    tsharkCache = { checked: Date.now(), path: null, version: null };
  }
  return tsharkCache;
}

export default function systemRoutes(ctx: Ctx) {
  const r = Router();
  const { db } = ctx;

  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.get(
    '/status',
    h((_req, res) => {
      let dbState: any;
      try {
        db.scalar('SELECT 1');
        dbState = { state: 'connected', schemaVersion: db.schemaVersion(), file: ctx.cfg.dbFile };
      } catch (e: any) {
        dbState = { state: 'error', message: 'Database query failed.' };
      }
      const refs = db.all('SELECT source, ref_key, status, origin, retrieved_at, error FROM reference_cache ORDER BY retrieved_at DESC LIMIT 200');
      const latest = (s: string) => refs.find((x) => x.source === s) ?? null;
      const ts = tsharkInfo(ctx);
      res.json({
        database: dbState,
        ai: aiStatus(ctx),
        references: {
          online: ctx.cfg.referencesOnline,
          nvdApiKey: !!ctx.cfg.nvdApiKey,
          nvd: latest('nvd'),
          kev: latest('kev'),
          attack: latest('attack'),
        },
        tshark: { available: !!ts.path, version: ts.version },
        nmap: (() => { const n = nmapInfo(ctx); return { available: !!n.path, version: n.version }; })(),
        mode: 'local_single_user',
        bind: `${ctx.cfg.host}:${ctx.cfg.port}`,
        maxUploadMb: Math.round(ctx.cfg.maxUploadBytes / 1024 / 1024),
        serverTime: new Date().toISOString(),
      });
    }),
  );

  r.get(
    '/settings',
    h((_req, res) => {
      const rows = db.all('SELECT key, value FROM settings');
      res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    }),
  );

  const settingsSchema = z.object({ analyst_name: z.string().trim().max(80).optional() }).strict();
  r.put(
    '/settings',
    h((req, res) => {
      const body = settingsSchema.parse(req.body);
      for (const [k, v] of Object.entries(body)) db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v ?? '');
      logActivity(db, null, 'settings.updated', 'settings', 'Updated settings');
      res.json({ ok: true });
    }),
  );

  r.get(
    '/activity',
    h((req, res) => {
      const eid = typeof req.query.engagement === 'string' ? req.query.engagement : null;
      const limit = Math.min(Number(req.query.limit ?? 50), 500);
      const rows = eid
        ? db.all('SELECT * FROM activity WHERE engagement_id = ? ORDER BY id DESC LIMIT ?', eid, limit)
        : db.all('SELECT * FROM activity ORDER BY id DESC LIMIT ?', limit);
      res.json(rows);
    }),
  );

  // ---------- AI provider settings (keys stay on the server) ----------
  r.get('/settings/ai', h((_req, res) => res.json(publicAi(ctx.cfg))));

  const aiSchema = z
    .object({
      provider: z.enum(['none', 'anthropic', 'openai']),
      api_key: z.string().trim().max(400).optional(),
      clear_key: z.boolean().optional(),
      model: z.string().trim().max(120).optional(),
      base_url: z.string().trim().max(300).optional(),
    })
    .strict();
  r.put('/settings/ai', h((req, res) => {
    const b = aiSchema.parse(req.body);
    if (b.base_url && !/^https?:\/\/[^\s]+$/i.test(b.base_url)) throw new HttpError(400, 'Base URL must start with http:// or https://');
    if (b.api_key && /\s/.test(b.api_key)) throw new HttpError(400, 'The API key contains spaces. Paste only the key.');
    const saved = { ...(readSavedAi(ctx.cfg) ?? {}) };
    saved.provider = b.provider;
    if (b.provider === 'anthropic') {
      if (b.api_key) saved.anthropicApiKey = b.api_key;
      if (b.clear_key) saved.anthropicApiKey = '';
      if (b.model) saved.anthropicModel = b.model;
    }
    if (b.provider === 'openai') {
      if (b.api_key) saved.openaiApiKey = b.api_key;
      if (b.clear_key) saved.openaiApiKey = '';
      if (b.model) saved.openaiModel = b.model;
      if (b.base_url) saved.openaiBaseUrl = b.base_url.replace(/\/+$/, '');
    }
    writeSavedAi(ctx.cfg, saved);
    applySavedAi(ctx.cfg, saved);
    logActivity(db, null, 'settings.ai_updated', 'settings', `AI provider set to ${b.provider}${b.api_key ? ' (new key saved)' : ''}${b.clear_key ? ' (key removed)' : ''}`);
    res.json({ settings: publicAi(ctx.cfg), status: aiStatus(ctx) });
  }));

  // Sends a fixed one-line prompt. No engagement data or evidence is included.
  r.post('/settings/ai/test', h(async (_req, res) => {
    const t0 = Date.now();
    try {
      const out = await callProvider({ ...ctx.cfg, ai: { ...ctx.cfg.ai, maxOutputTokens: 256, timeoutMs: 30_000 } }, 'You are a connectivity check. Reply with exactly: OK', 'Connectivity check.');
      res.json({ ok: true, model: out.model, latency_ms: Date.now() - t0, reply: out.text.slice(0, 60) });
    } catch (e: any) {
      // "Thinking" models can spend a short test budget before writing text: the provider still answered.
      if (e instanceof ProviderError && /finish reason: length|stop reason: max_tokens/.test(e.message)) {
        res.json({ ok: true, model: ctx.cfg.ai.provider === 'anthropic' ? ctx.cfg.ai.anthropicModel : ctx.cfg.ai.openaiModel, latency_ms: Date.now() - t0, reply: '' });
        return;
      }
      if (e instanceof ProviderError) throw new HttpError(e.status === 503 ? 400 : 502, e.message);
      throw e;
    }
  }));

  return r;
}
