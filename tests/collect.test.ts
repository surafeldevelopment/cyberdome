import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { makeTestApp } from './helpers.js';
import { expandIPv4 } from '../server/services/nmapRunner.js';
import { tick } from '../server/services/scanScheduler.js';

let hasNmap = true;
try {
  execFileSync('nmap', ['--version'], { stdio: 'ignore' });
} catch {
  hasNmap = false;
}

async function authorize(t: ReturnType<typeof makeTestApp>) {
  await t.api.patch(t.base, { authorization_ref: 'SYNTHETIC-AUTH-001' });
  await t.api.post(`${t.base}/authorization`, { confirmed: true, confirmed_by: 'Test Analyst' });
}

describe('scope-restricted Nmap runs', () => {
  let t: ReturnType<typeof makeTestApp>;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it('expands targets with limits', () => {
    expect(expandIPv4('192.0.2.5')).toEqual(['192.0.2.5']);
    expect(expandIPv4('192.0.2.0/30')).toEqual(['192.0.2.1', '192.0.2.2']);
    expect(expandIPv4('192.0.2.10-12')).toEqual(['192.0.2.10', '192.0.2.11', '192.0.2.12']);
    expect(() => expandIPv4('10.0.0.0/16')).toThrow(/limited/);
    expect(expandIPv4('example.test')).toBeNull();
  });

  it('refuses to plan when no scope is defined', async () => {
    const p = await t.api.post(`${t.base}/scan-runs/plan`, { target: '192.0.2.10', profile: 'quick' });
    expect(p.status).toBe(200);
    expect(p.body.ok).toBe(false);
    expect(p.body.blockers.join(' ')).toMatch(/not in the authorized scope/i);
    expect(p.body.refused[0].reason).toMatch(/no authorized targets/);
    const run = await t.api.post(`${t.base}/scan-runs`, { target: '192.0.2.10', profile: 'quick', confirm: true });
    expect(run.status).toBe(409);
  });

  it('never assumes a private address is authorized and drops exclusions', async () => {
    await authorize(t);
    await t.api.post(`${t.base}/scope`, { kind: 'in', target: '192.0.2.0/29', confirmed: true });
    await t.api.post(`${t.base}/scope`, { kind: 'out', target: '192.0.2.3' });
    const priv = await t.api.post(`${t.base}/scan-runs/plan`, { target: '10.0.0.5', profile: 'quick' });
    expect(priv.body.ok).toBe(false);
    expect(priv.body.refused[0].reason).toMatch(/not covered/);
    const net = await t.api.post(`${t.base}/scan-runs/plan`, { target: '192.0.2.0/29', profile: 'standard', skip_discovery: true });
    expect(net.body.excluded.map((x: any) => x.ip)).toEqual(['192.0.2.3']);
    expect(net.body.addresses.map((x: any) => x.ip)).not.toContain('192.0.2.3');
    expect(net.body.args).not.toContain('192.0.2.3');
    expect(net.body.args).toContain('-Pn');
    expect(net.body.args.slice(0, 4)).toEqual(['-sT', '-sV', '--top-ports', '1000']);
    // Partly outside scope: refused as a whole.
    const wide = await t.api.post(`${t.base}/scan-runs/plan`, { target: '192.0.2.0/28', profile: 'quick' });
    expect(wide.body.ok).toBe(false);
  });

  it('accepts any in-scope entry, and rejects injection attempts and unknown profiles', async () => {
    await t.api.post(`${t.base}/scope`, { kind: 'in', target: '192.0.2.10' });
    const listed = await t.api.post(`${t.base}/scan-runs/plan`, { target: '192.0.2.10', profile: 'quick' });
    expect(listed.body.refused).toEqual([]);
    expect(listed.body.addresses.map((a: any) => a.ip)).toEqual(['192.0.2.10']);
    const inj = await t.api.post(`${t.base}/scan-runs/plan`, { target: '192.0.2.10 --script=evil', profile: 'quick' });
    expect(inj.body.ok).toBe(false);
    expect(inj.body.addresses).toEqual([]);
    const semi = await t.api.post(`${t.base}/scan-runs/plan`, { target: '192.0.2.10;id', profile: 'quick' });
    expect(semi.body.ok).toBe(false);
    const prof = await t.api.post(`${t.base}/scan-runs/plan`, { target: '192.0.2.10', profile: 'aggressive' });
    expect(prof.status).toBe(400);
    const extra = await t.api.post(`${t.base}/scan-runs/plan`, { target: '192.0.2.10', profile: 'quick', args: ['-A'] });
    expect(extra.status).toBe(400);
  });

  it('refuses the demo engagement but does not gate on the documented testing window', async () => {
    await t.api.post(`${t.base}/scope`, { kind: 'in', target: '127.0.0.1' });
    await t.api.patch(t.base, { window_start: '2020-01-01', window_end: '2020-01-02' });
    const old = await t.api.post(`${t.base}/scan-runs/plan`, { target: '127.0.0.1', profile: 'discovery' });
    expect(old.body.blockers.join(' ')).not.toMatch(/window/);
    await t.api.post('/api/demo/load');
    const demo = t.ctx.db.scalar<string>('SELECT id FROM engagements WHERE is_demo = 1');
    if (demo) {
      const d = await t.api.post(`/api/engagements/${demo}/scan-runs/plan`, { target: '192.0.2.10', profile: 'quick' });
      expect(d.body.blockers.join(' ')).toMatch(/demo/i);
    }
  });

  it.skipIf(!hasNmap)('runs a real host discovery against confirmed loopback scope and imports it', async () => {
    await authorize(t);
    await t.api.post(`${t.base}/scope`, { kind: 'in', target: '127.0.0.1', confirmed: true });
    const plan = await t.api.post(`${t.base}/scan-runs/plan`, { target: '127.0.0.1', profile: 'discovery' });
    expect(plan.body.ok).toBe(true);
    const noConfirm = await t.api.post(`${t.base}/scan-runs`, { target: '127.0.0.1', profile: 'discovery' });
    expect(noConfirm.status).toBe(400);
    const start = await t.api.post(`${t.base}/scan-runs`, { target: '127.0.0.1', profile: 'discovery', confirm: true });
    expect(start.status).toBe(202);
    expect(start.body.code).toBe('RUN-001');
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await t.api.get(`${t.base}/scan-runs/${start.body.id}`)).body;
      if (run.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(run.status).toBe('completed');
    expect(run.scan_import_code).toBe('SCN-001');
    expect(run.evidence_code).toBe('EV-001');
    const ev = (await t.api.get(`${t.base}/evidence/${run.evidence_id}`)).body;
    expect(ev.source_category).toBe('authorized_lab');
    expect(ev.sha256).toMatch(/^[a-f0-9]{64}$/);
    const assets = (await t.api.get(`${t.base}/assets`)).body;
    expect(assets.map((a: any) => a.ip)).toContain('127.0.0.1');
  }, 30_000);
});

describe('automatic scan schedules', () => {
  let t: ReturnType<typeof makeTestApp>;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it('only schedules in-scope targets, caps the end date, and re-checks scope before each run', async () => {
    const refused = await t.api.post(`${t.base}/scan-schedules`, { target: '127.0.0.1', profile: 'discovery', interval_minutes: 360, confirm: true, run_now: false });
    expect(refused.status).toBe(409);
    await authorize(t);
    const scope = await t.api.post(`${t.base}/scope`, { kind: 'in', target: '127.0.0.1', confirmed: true });
    const sid = scope.body.scope.find((x: any) => x.kind === 'in').id;
    const noConfirm = await t.api.post(`${t.base}/scan-schedules`, { target: '127.0.0.1', profile: 'discovery', interval_minutes: 360, run_now: false });
    expect(noConfirm.status).toBe(400);
    const badInterval = await t.api.post(`${t.base}/scan-schedules`, { target: '127.0.0.1', profile: 'discovery', interval_minutes: 5, confirm: true, run_now: false });
    expect(badInterval.status).toBe(400);
    const created = await t.api.post(`${t.base}/scan-schedules`, { target: '127.0.0.1', profile: 'discovery', interval_minutes: 360, ends_at: '2099-01-01', confirm: true, run_now: false });
    expect(created.status).toBe(201);
    expect(Date.parse(created.body.ends_at)).toBeLessThanOrEqual(Date.now() + 30 * 86_400_000 + 1000);
    expect(created.body.enabled).toBe(true);

    // Make it due, then remove the target from scope: the scheduler must skip, not scan.
    t.ctx.db.run('UPDATE scan_schedules SET next_run_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), created.body.id);
    await t.api.del(`${t.base}/scope/${sid}`);
    await tick(t.ctx);
    const list = (await t.api.get(`${t.base}/scan-schedules`)).body.schedules;
    expect(list[0].last_status).toBe('skipped');
    expect(list[0].last_message).toMatch(/scope/);
    expect((await t.api.get(`${t.base}/scan-runs`)).body).toHaveLength(0);

    const paused = await t.api.patch(`${t.base}/scan-schedules/${created.body.id}`, { enabled: false });
    expect(paused.body.enabled).toBe(false);
    const del = await t.api.del(`${t.base}/scan-schedules/${created.body.id}`);
    expect(del.status).toBe(200);
  });

  it('ends schedules whose end date has passed', async () => {
    await authorize(t);
    await t.api.post(`${t.base}/scope`, { kind: 'in', target: '127.0.0.1', confirmed: true });
    const c = await t.api.post(`${t.base}/scan-schedules`, { target: '127.0.0.1', profile: 'discovery', interval_minutes: 60, confirm: true, run_now: false });
    t.ctx.db.run('UPDATE scan_schedules SET ends_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), c.body.id);
    await tick(t.ctx);
    const s = (await t.api.get(`${t.base}/scan-schedules`)).body.schedules[0];
    expect(s.enabled).toBe(false);
    expect(s.last_status).toBe('ended');
  });

  it.skipIf(!hasNmap)('starts a due schedule as a tagged run', async () => {
    await authorize(t);
    await t.api.post(`${t.base}/scope`, { kind: 'in', target: '127.0.0.1', confirmed: true });
    const c = await t.api.post(`${t.base}/scan-schedules`, { target: '127.0.0.1', profile: 'discovery', interval_minutes: 60, confirm: true });
    expect(c.body.runs_started).toBe(1);
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await t.api.get(`${t.base}/scan-runs`)).body[0];
      if (run.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(run.schedule_id).toBe(c.body.id);
    expect(run.status).toBe('completed');
    expect(run.requested_by).toMatch(/automatic schedule/);
  }, 30_000);
});

describe('host snapshot and AI settings', () => {
  let t: ReturnType<typeof makeTestApp>;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => t.cleanup());

  it('stores a host snapshot as unreviewed evidence only after confirmation', async () => {
    const no = await t.api.post(`${t.base}/host-snapshot`, {});
    expect(no.status).toBe(400);
    const r = await t.api.post(`${t.base}/host-snapshot`, { confirm: true });
    expect(r.status).toBe(201);
    const ev = (await t.api.get(`${t.base}/evidence/${r.body.evidence_id}`)).body;
    expect(ev.sanitization_status).toBe('not_reviewed');
    expect(ev.tags).toContain('host-snapshot');
  });

  it('saves AI keys on the server and never returns them', async () => {
    const put = await t.api.put('/api/settings/ai', { provider: 'anthropic', api_key: 'sk-ant-SYNTHETIC-not-a-real-key', model: 'claude-sonnet-5-5' });
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain('SYNTHETIC-not-a-real-key');
    expect(put.body.settings.anthropic_key_set).toBe(true);
    expect(put.body.status.state).toBe('configured');
    const get = await t.api.get('/api/settings/ai');
    expect(JSON.stringify(get.body)).not.toContain('SYNTHETIC');
    const status = await t.api.get('/api/status');
    expect(JSON.stringify(status.body)).not.toContain('SYNTHETIC');
    const clear = await t.api.put('/api/settings/ai', { provider: 'anthropic', clear_key: true });
    expect(clear.body.settings.anthropic_key_set).toBe(false);
    const bad = await t.api.put('/api/settings/ai', { provider: 'openai', base_url: 'file:///etc/passwd' });
    expect(bad.status).toBe(400);
    const off = await t.api.put('/api/settings/ai', { provider: 'none' });
    expect(off.body.status.state).toBe('not_configured');
  });
});
