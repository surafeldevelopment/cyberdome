import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeTestApp } from './helpers.js';
import { EXPOSURE_RULES } from '../server/services/exposureRules.js';

let hasNmap = true;
try {
  execFileSync('nmap', ['--version'], { stdio: 'ignore' });
} catch {
  hasNmap = false;
}

async function waitDone(t: ReturnType<typeof makeTestApp>, id: string) {
  let run: any;
  for (let i = 0; i < 300; i++) {
    run = (await t.api.get(`${t.base}/autopilot/${id}`)).body;
    if (run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 200));
  }
  return run;
}

describe('autopilot', () => {
  let t: ReturnType<typeof makeTestApp>;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it('is blocked, with a fix link, until a target is in scope', async () => {
    const r = await t.api.post(`${t.base}/autopilot`, { confirm: true });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe('blocked');
    const pre = r.body.steps.find((s: any) => s.key === 'preflight');
    expect(pre.lines.map((l: any) => l.text).join(' ')).toMatch(/No targets in scope/);
    expect(pre.lines.some((l: any) => l.link === '/engagement?tab=scope')).toBe(true);
    expect((await t.api.get(`${t.base}/scan-runs`)).body).toHaveLength(0);
    const noConfirm = await t.api.post(`${t.base}/autopilot`, {});
    expect(noConfirm.status).toBe(400);
  });

  it('refuses the demo engagement', async () => {
    await t.api.post('/api/demo/load');
    const demo = t.ctx.db.scalar<string>('SELECT id FROM engagements WHERE is_demo = 1');
    const r = await t.api.post(`/api/engagements/${demo}/autopilot`, { confirm: true });
    expect(r.body.status).toBe('blocked');
  });

  it('has a rule for each classic risky service', () => {
    const keys = EXPOSURE_RULES.map((r) => r.key);
    for (const k of ['telnet', 'ftp', 'smb', 'rdp', 'database', 'http_cleartext']) expect(keys).toContain(k);
  });

  it.skipIf(!hasNmap)('scans confirmed scope, raises unverified findings with evidence, and does not duplicate them', async () => {
    const srv = http.createServer((_q, s) => s.end('synthetic test server')).listen(8080, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    try {
      await t.api.patch(t.base, { authorization_ref: 'SYNTHETIC-AUTH-001' });
      await t.api.post(`${t.base}/authorization`, { confirmed: true, confirmed_by: 'Test Analyst' });
      await t.api.post(`${t.base}/scope`, { kind: 'in', target: '127.0.0.1', confirmed: true });
      const start = await t.api.post(`${t.base}/autopilot`, { profile: 'quick', host_snapshot: true, confirm: true });
      expect(start.status).toBe(202);
      const run = await waitDone(t, start.body.id);
      expect(run.status).toBe('completed');
      expect(run.summary.runs.length).toBeGreaterThanOrEqual(1);
      expect(run.summary.hosts_up).toBeGreaterThanOrEqual(1);
      expect(run.summary.snapshot).toMatch(/^EV-/);
      const findings = (await t.api.get(`${t.base}/findings`)).body;
      const list = Array.isArray(findings) ? findings : findings.items;
      const web = list.find((f: any) => /Web service without TLS on 127\.0\.0\.1:8080/.test(f.title));
      expect(web).toBeTruthy();
      expect(web.validation_status).toBe('scanner_reported');
      expect(web.impact).toBe('');
      const detail = (await t.api.get(`${t.base}/findings/${web.id}`)).body;
      expect(detail.evidence.length).toBeGreaterThanOrEqual(1);
      // Second pass: same services, no duplicate findings.
      const again = (await t.api.post(`${t.base}/exposure-rules/apply`)).body;
      expect(again.created).toHaveLength(0);
      expect(again.already).toBeGreaterThanOrEqual(1);
    } finally {
      srv.close();
    }
  }, 60_000);
});

describe('autopilot without date or authorization gates', () => {
  it.skipIf(!hasNmap)('runs with an unconfirmed authorization and a past testing window', async () => {
    const t = makeTestApp();
    try {
      await t.api.patch(t.base, { window_start: '2020-01-01', window_end: '2020-01-02' });
      await t.api.post(`${t.base}/scope`, { kind: 'in', target: '127.0.0.1' });
      const r = await t.api.post(`${t.base}/autopilot`, { profile: 'quick', retry_without_ping: false, analyze: false, confirm: true });
      expect(r.body.status).not.toBe('blocked');
      const run = await waitDone(t, r.body.id);
      expect(run.status).toBe('completed');
    } finally {
      t.cleanup();
    }
  }, 60_000);
});
