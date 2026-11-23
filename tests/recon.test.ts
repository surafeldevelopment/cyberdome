import { describe, it, expect, afterAll } from 'vitest';
import { makeTestApp, fixture } from './helpers';

// All data in this suite is SYNTHETIC (cyberdome.example / RFC 5737 documentation addresses).
const t = makeTestApp();
afterAll(() => t.cleanup());

describe('Recon module (Lab 2)', () => {
  let id = '';
  it('creates a manual observation with evidence link and code', async () => {
    const ev = await t.api.upload(`${t.base}/evidence`, 'SYNTHETIC recon note', 'note.txt', { source_category: 'instructor_supplied' });
    const r = await t.api.post(`${t.base}/recon`, {
      category: 'domain', classification: 'asset_discovery', value: 'cyberdome.example', source: 'Instructor brief (synthetic)',
      analyst_notes: 'Root domain', next_step: 'Confirm scope', evidence_ids: [ev.body.code],
    });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('REC-001');
    expect(r.body.evidence[0].code).toBe(ev.body.code);
    expect(r.body.verification_status).toBe('unverified');
    id = r.body.id;
  });

  it('validates enums and unknown evidence', async () => {
    expect((await t.api.post(`${t.base}/recon`, { category: 'nope', classification: 'asset_discovery', value: 'x' })).status).toBe(400);
    expect((await t.api.post(`${t.base}/recon`, { category: 'domain', classification: 'asset_discovery', value: 'x', evidence_ids: ['EV-999'] })).status).toBe(400);
  });

  it('verifies an observation and records who verified it', async () => {
    const r = await t.api.patch(`${t.base}/recon/${id}`, { verification_status: 'verified' });
    expect(r.body.verification_status).toBe('verified');
    expect(r.body.verified_by).toBeTruthy();
  });

  it('previews a CSV import with errors and unknown-field warnings without writing', async () => {
    const r = await t.agent.post(`${t.base}/recon-imports/preview`).set('X-CyberDome', '1').attach('file', fixture('recon-observations.csv'), 'recon.csv');
    expect(r.status).toBe(200);
    expect(r.body.row_count).toBe(5);
    expect(r.body.errors.length).toBe(2);
    expect(r.body.warnings.join(' ')).toMatch(/extra_column/);
    expect((await t.api.get(`${t.base}/recon`)).body).toHaveLength(1);
  });

  it('imports CSV partially, stores the file as evidence, and links every row', async () => {
    const r = await t.api.upload(`${t.base}/recon-imports`, fixture('recon-observations.csv'), 'recon.csv', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('partial');
    expect(r.body.created).toBe(5);
    expect(r.body.rejected).toBe(2);
    const list = (await t.api.get(`${t.base}/recon`)).body;
    expect(list).toHaveLength(6);
    expect(list.filter((x: any) => x.evidence.some((e: any) => e.code === r.body.evidence.code))).toHaveLength(5);
  });

  it('imports JSON with an observations array', async () => {
    const r = await t.api.upload(`${t.base}/recon-imports`, fixture('recon-observations.json'), 'recon.json', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('complete');
    expect(r.body.created).toBe(5);
  });

  it('rejects malformed JSON without creating records', async () => {
    const before = (await t.api.get(`${t.base}/recon`)).body.length;
    const r = await t.api.upload(`${t.base}/recon-imports`, '{ not valid', 'bad.json', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(400);
    expect((await t.api.get(`${t.base}/recon`)).body.length).toBe(before);
  });

  it('refuses demo-labeled records in the real engagement', async () => {
    const r = await t.api.post(`${t.base}/recon`, { category: 'domain', classification: 'asset_discovery', value: 'x', source_category: 'demo' });
    expect(r.status).toBe(400);
  });

  it('exports all recon rows as CSV and deletes with retired code', async () => {
    const csv = await t.api.get(`${t.base}/exports/recon.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text.split('\n').filter((l: string) => l.startsWith('REC-')).length).toBe(11);
    expect((await t.api.del(`${t.base}/recon/${id}`)).status).toBe(200);
    const again = await t.api.post(`${t.base}/recon`, { category: 'other', classification: 'attack_surface', value: 'y' });
    expect(again.body.code).toBe('REC-012');
  });
});
