import { describe, it, expect, afterAll } from 'vitest';
import { makeTestApp } from './helpers';

// Loads the SYNTHETIC demo engagement through the real import pipelines and checks isolation.
const t = makeTestApp();
afterAll(() => t.cleanup());

describe('demo engagement isolation', () => {
  let demoId = '';
  it('loads the demo engagement from samples/demo', async () => {
    const r = await t.api.post('/api/demo/load');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    demoId = r.body.engagement_id;
    const list = await t.api.get('/api/engagements');
    expect(list.body.find((e: any) => e.id === demoId).is_demo).toBe(true);
  }, 60000);

  it('demo data is populated and uses DEMO- prefixed IDs', async () => {
    const d = await t.api.get(`/api/engagements/${demoId}/dashboard`);
    expect(d.body.metrics.assets.value).toBeGreaterThan(0);
    expect(d.body.metrics.open_services.value).toBeGreaterThan(0);
    expect(d.body.metrics.findings.value).toBeGreaterThan(0);
    const ev = await t.api.get(`/api/engagements/${demoId}/evidence?limit=500`);
    expect(ev.body.items.every((e: any) => e.code.startsWith('DEMO-EV-') && e.source_category === 'demo')).toBe(true);
    const ai = await t.api.get(`/api/engagements/${demoId}/ai/sessions`);
    const sessions = Array.isArray(ai.body) ? ai.body : ai.body.items;
    expect(sessions).toHaveLength(0); // no fabricated AI output
  });

  it('real engagement stays empty', async () => {
    const d = await t.api.get(`${t.base}/dashboard`);
    expect(d.body.metrics.assets.value).toBe(0);
    expect(d.body.metrics.evidence.value).toBe(0);
    expect(d.body.metrics.findings.value).toBe(0);
  });

  it('loading again is idempotent; removal deletes only the demo', async () => {
    const again = await t.api.post('/api/demo/load');
    expect(again.body.engagement_id).toBe(demoId);
    const del = await t.api.del('/api/demo', { confirm: true });
    expect(del.status).toBe(200);
    const list = await t.api.get('/api/engagements');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].is_demo).toBe(false);
  });
});
