import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  dbFile: string;
  evidenceDir: string;
  maxUploadBytes: number;
  production: boolean;
  /** Allow outbound requests to NVD / CISA KEV / MITRE ATT&CK. */
  referencesOnline: boolean;
  nvdApiKey?: string;
  ai: {
    provider: 'none' | 'anthropic' | 'openai';
    anthropicApiKey?: string;
    anthropicModel: string;
    anthropicBaseUrl: string;
    openaiApiKey?: string;
    openaiModel: string;
    openaiBaseUrl: string;
    maxOutputTokens: number;
    timeoutMs: number;
  };
  tsharkPath?: string;
  nmapPath?: string;
  /** Base URLs for reference sources (overridable for testing). */
  refs: { nvdBase: string; kevUrl: string; attackUrl: string };
}

let loaded = false;

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  if (!loaded) {
    dotenv.config({ quiet: true } as any);
    loaded = true;
  }
  const env = process.env;
  const dataDir = path.resolve(overrides.dataDir ?? env.CYBERDOME_DATA_DIR ?? path.join(process.cwd(), 'data'));
  fs.mkdirSync(dataDir, { recursive: true });

  const explicitProvider = (env.AI_PROVIDER ?? '').toLowerCase();
  let provider: AppConfig['ai']['provider'] = 'none';
  if (explicitProvider === 'anthropic' || explicitProvider === 'openai') provider = explicitProvider;
  else if (!explicitProvider) {
    if (env.CYBERDOME_ANTHROPIC_API_KEY) provider = 'anthropic';
    else if (env.CYBERDOME_OPENAI_API_KEY || env.CYBERDOME_OPENAI_BASE_URL) provider = 'openai';
  }

  const cfg: AppConfig = {
    host: env.CYBERDOME_HOST ?? '127.0.0.1',
    port: Number(env.CYBERDOME_PORT ?? 4646),
    dataDir,
    dbFile: path.join(dataDir, 'cyberdome.db'),
    evidenceDir: path.join(dataDir, 'evidence'),
    maxUploadBytes: Number(env.CYBERDOME_MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
    production: env.NODE_ENV === 'production',
    referencesOnline: (env.CYBERDOME_REFERENCES_ONLINE ?? 'true') !== 'false',
    nvdApiKey: env.NVD_API_KEY || undefined,
    ai: {
      provider,
      // App-specific variable names avoid accidentally inheriting unrelated shell credentials.
      anthropicApiKey: env.CYBERDOME_ANTHROPIC_API_KEY || undefined,
      anthropicModel: env.CYBERDOME_ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      anthropicBaseUrl: env.CYBERDOME_ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      openaiApiKey: env.CYBERDOME_OPENAI_API_KEY || undefined,
      openaiModel: env.CYBERDOME_OPENAI_MODEL || 'gpt-4o-mini',
      openaiBaseUrl: env.CYBERDOME_OPENAI_BASE_URL || 'https://api.openai.com/v1',
      maxOutputTokens: Number(env.CYBERDOME_AI_MAX_TOKENS ?? 8192),
      timeoutMs: Number(env.CYBERDOME_AI_TIMEOUT_MS ?? 90000),
    },
    tsharkPath: env.CYBERDOME_TSHARK_PATH || undefined,
    nmapPath: env.CYBERDOME_NMAP_PATH || undefined,
    refs: {
      nvdBase: env.CYBERDOME_NVD_BASE || 'https://services.nvd.nist.gov/rest/json/cves/2.0',
      kevUrl: env.CYBERDOME_KEV_URL || 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      attackUrl:
        env.CYBERDOME_ATTACK_URL ||
        'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json',
    },
  } as AppConfig;
  const { ai: aiO, refs: refsO, ...rest } = overrides;
  Object.assign(cfg, rest);
  if (overrides.dataDir) {
    cfg.dbFile = overrides.dbFile ?? path.join(cfg.dataDir, 'cyberdome.db');
    cfg.evidenceDir = overrides.evidenceDir ?? path.join(cfg.dataDir, 'evidence');
  }
  if (aiO) cfg.ai = { ...cfg.ai, ...aiO };
  if (refsO) cfg.refs = { ...cfg.refs, ...refsO };
  return cfg;
}
