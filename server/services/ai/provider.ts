import type { AppConfig } from '../../config.js';

export interface ProviderResult {
  text: string;
  model: string;
  usage: Record<string, unknown>;
  stopReason: string | null;
}

export class ProviderError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Provider + model that would be used, or null when nothing usable is configured. */
export function providerInfo(cfg: AppConfig): { provider: 'anthropic' | 'openai'; model: string } | null {
  const a = cfg.ai;
  if (a.provider === 'anthropic' && a.anthropicApiKey) return { provider: 'anthropic', model: a.anthropicModel };
  if (a.provider === 'openai' && (a.openaiApiKey || !a.openaiBaseUrl.includes('api.openai.com'))) return { provider: 'openai', model: a.openaiModel };
  return null;
}

/** Strip anything that looks like a credential from upstream error text before storing/returning it. */
function scrub(s: string, cfg: AppConfig): string {
  let out = String(s ?? '').slice(0, 600);
  for (const k of [cfg.ai.anthropicApiKey, cfg.ai.openaiApiKey]) if (k) out = out.split(k).join('[redacted]');
  return out.replace(/(sk-[A-Za-z0-9_-]{8,}|x-api-key[^,}]*)/gi, '[redacted]');
}

function explainStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return `The AI provider rejected the credentials (HTTP ${status}). Check the API key in Settings → AI provider.`;
  if (status === 404) return `The AI provider endpoint or model was not found (HTTP 404). Check the configured model name and base URL.`;
  if (status === 429) return 'The AI provider rate limit was reached (HTTP 429). Wait and try again.';
  if (status === 529 || status === 503) return `The AI provider is overloaded or unavailable (HTTP ${status}). Try again later.`;
  if (status >= 500) return `The AI provider returned a server error (HTTP ${status}).`;
  return `The AI provider returned HTTP ${status}${body ? `: ${body}` : ''}.`;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, cfg: AppConfig) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new ProviderError(`The AI provider did not respond within ${Math.round(timeoutMs / 1000)} seconds.`, 504);
    throw new ProviderError(`Could not connect to the AI provider (${scrub(e?.cause?.code ?? e?.message ?? 'network error', cfg)}).`, 502);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const upstream = json?.error?.message ?? json?.error ?? '';
    throw new ProviderError(explainStatus(res.status, scrub(typeof upstream === 'string' ? upstream : JSON.stringify(upstream), cfg)), res.status === 429 ? 429 : 502);
  }
  if (!json) throw new ProviderError('The AI provider returned a response that was not valid JSON.', 502);
  return json;
}

export async function callProvider(cfg: AppConfig, system: string, user: string): Promise<ProviderResult> {
  const info = providerInfo(cfg);
  if (!info) throw new ProviderError('No AI provider is configured.', 503);
  const a = cfg.ai;
  if (info.provider === 'anthropic') {
    const json = await post(
      `${a.anthropicBaseUrl.replace(/\/$/, '')}/v1/messages`,
      { 'x-api-key': a.anthropicApiKey!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      { model: a.anthropicModel, max_tokens: a.maxOutputTokens, system, messages: [{ role: 'user', content: user }] },
      a.timeoutMs,
      cfg,
    );
    const text = (Array.isArray(json.content) ? json.content : []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n').trim();
    if (!text) throw new ProviderError(`The AI provider returned no text (stop reason: ${json.stop_reason ?? 'unknown'}).`, 502);
    return { text, model: json.model ?? a.anthropicModel, usage: json.usage ?? {}, stopReason: json.stop_reason ?? null };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (a.openaiApiKey) headers.authorization = `Bearer ${a.openaiApiKey}`;
  const json = await post(
    `${a.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`,
    headers,
    { model: a.openaiModel, max_tokens: a.maxOutputTokens, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
    a.timeoutMs,
    cfg,
  );
  const choice = json.choices?.[0];
  const text = String(choice?.message?.content ?? '').trim();
  if (!text) throw new ProviderError(`The AI provider returned no text (finish reason: ${choice?.finish_reason ?? 'unknown'}).`, 502);
  return { text, model: json.model ?? a.openaiModel, usage: json.usage ?? {}, stopReason: choice?.finish_reason ?? null };
}
