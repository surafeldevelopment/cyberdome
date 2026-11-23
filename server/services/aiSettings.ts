import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';

/**
 * AI provider settings entered in the Settings page. Stored on the server only, in
 * data/ai-settings.json (file mode 0600). API keys are never returned to the browser.
 * When this file exists its values take precedence over the .env values.
 */
export interface SavedAi {
  provider?: 'none' | 'anthropic' | 'openai';
  anthropicApiKey?: string;
  anthropicModel?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  updatedAt?: string;
}

const file = (cfg: AppConfig) => path.join(cfg.dataDir, 'ai-settings.json');

export function readSavedAi(cfg: AppConfig): SavedAi | null {
  try {
    return JSON.parse(fs.readFileSync(file(cfg), 'utf8')) as SavedAi;
  } catch {
    return null;
  }
}

const envBaseline = new WeakMap<AppConfig, AppConfig['ai']>();

/**
 * Apply saved settings onto the live config (called at startup and after each save).
 * The .env values are kept as the baseline; a saved empty key clears that key.
 */
export function applySavedAi(cfg: AppConfig, saved = readSavedAi(cfg)) {
  if (!envBaseline.has(cfg)) envBaseline.set(cfg, { ...cfg.ai });
  const a: AppConfig['ai'] = { ...envBaseline.get(cfg)! };
  if (saved) {
    if (saved.provider) a.provider = saved.provider;
    if (saved.anthropicApiKey !== undefined) a.anthropicApiKey = saved.anthropicApiKey || undefined;
    if (saved.anthropicModel) a.anthropicModel = saved.anthropicModel;
    if (saved.openaiApiKey !== undefined) a.openaiApiKey = saved.openaiApiKey || undefined;
    if (saved.openaiBaseUrl) a.openaiBaseUrl = saved.openaiBaseUrl;
    if (saved.openaiModel) a.openaiModel = saved.openaiModel;
  }
  cfg.ai = a;
}

export function writeSavedAi(cfg: AppConfig, next: SavedAi) {
  const f = file(cfg);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
  try {
    fs.chmodSync(f, 0o600);
  } catch {
    /* best effort on Windows */
  }
}

/** Public view: never includes key material. */
export function publicAi(cfg: AppConfig) {
  const saved = readSavedAi(cfg);
  const a = cfg.ai;
  return {
    provider: a.provider,
    anthropic_model: a.anthropicModel,
    openai_model: a.openaiModel,
    openai_base_url: a.openaiBaseUrl,
    anthropic_key_set: !!a.anthropicApiKey,
    openai_key_set: !!a.openaiApiKey,
    source: saved ? 'settings' : a.provider === 'none' ? 'none' : 'env',
    updated_at: saved?.updatedAt ?? null,
  };
}
