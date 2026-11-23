import { describe, it, expect, afterAll } from 'vitest';
import { makeTestApp } from './helpers';

const t = makeTestApp();
afterAll(() => t.cleanup());

describe('core platform (synthetic test data)', () => {
  it('starts with one real engagement with truthful empty state', async () => {
    const r = await t.api.get('/api/engagements');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].is_demo).toBe(false);
    expect(r.body[0].authorization_status).toBe('unconfirmed');
    const d = await t.api.get(`${t.base}/dashboard`);
    expect(d.body.metrics.assets.value).toBe(0);
    expect(d.body.metrics.open_services.value).toBe(0);
    expect(d.body.metrics.findings.value).toBe(0);
    const eng = await t.api.get(t.base);
    expect(eng.body.scope).toEqual([]);
    expect(eng.body.team).toEqual([]);
  });

  it('rejects mutating requests without the CSRF header', async () => {
    const r = await t.agent.post('/api/engagements').send({ name: 'x' });
    expect(r.status).toBe(403);
  });

  it('rejects non-loopback Host headers', async () => {
    const r = await t.agent.get('/api/health').set('Host', 'evil.example.com');
    expect(r.status).toBe(421);
  });

  it('allocates evidence IDs monotonically and never reuses withdrawn IDs', async () => {
    const a = await t.api.upload(`${t.base}/evidence`, 'synthetic test output one', 'one.txt', { source_category: 'authorized_lab' });
    expect(a.status).toBe(201);
    expect(a.body.code).toBe('EV-001');
    expect(a.body.sha256).toMatch(/^[a-f0-9]{64}$/);
    const w = await t.api.post(`${t.base}/evidence/${a.body.id}/withdraw`, { reason: 'test withdrawal', confirm: true });
    expect(w.body.status).toBe('withdrawn');
    const b = await t.api.upload(`${t.base}/evidence`, 'synthetic test output two', 'two.txt', { source_category: 'authorized_lab' });
    expect(b.body.code).toBe('EV-002');
  });

  it('refuses demo-labeled evidence in the real engagement', async () => {
    const r = await t.api.upload(`${t.base}/evidence`, 'x', 'x.txt', { source_category: 'demo' });
    expect(r.status).toBe(400);
  });

  it('refuses executables', async () => {
    const r = await t.api.upload(`${t.base}/evidence`, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]), 'a.exe', { source_category: 'authorized_lab' });
    expect(r.status).toBe(400);
  });
});
