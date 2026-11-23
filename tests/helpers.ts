import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';

/**
 * Creates an isolated app instance with a temporary data directory.
 * All test data is SYNTHETIC and lives only in that temp directory.
 */
export function makeTestApp(overrides: Partial<AppConfig> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberdome-test-'));
  const { app, ctx } = createApp({ dataDir, referencesOnline: false, ...overrides, ai: { provider: 'none', ...(overrides.ai ?? {}) } as any });
  const agent = request(app);
  const H = { 'X-CyberDome': '1' };
  const api = {
    get: (u: string) => agent.get(u),
    post: (u: string, body?: any) => agent.post(u).set(H).send(body ?? {}),
    put: (u: string, body?: any) => agent.put(u).set(H).send(body ?? {}),
    patch: (u: string, body?: any) => agent.patch(u).set(H).send(body ?? {}),
    del: (u: string, body?: any) => agent.delete(u).set(H).send(body ?? {}),
    upload: (u: string, file: Buffer | string, filename: string, fields: Record<string, string> = {}) => {
      let r = agent.post(u).set(H).attach('file', Buffer.isBuffer(file) ? file : Buffer.from(file), filename);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r;
    },
  };
  const realEngagementId = ctx.db.scalar<string>('SELECT id FROM engagements WHERE is_demo = 0 ORDER BY created_at LIMIT 1');
  const cleanup = () => {
    try { ctx.db.close(); } catch { /* already closed */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, ctx, api, agent, dataDir, eid: realEngagementId, base: `/api/engagements/${realEngagementId}`, cleanup };
}

export const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'synthetic', name));
