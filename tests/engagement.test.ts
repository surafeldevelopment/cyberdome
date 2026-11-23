import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTestApp } from './helpers';
import { readZip, loadBackup, verifyBackup, writeRestore } from '../server/scripts/backup-core';

// All data below is SYNTHETIC test data (RFC 5737 documentation addresses).
const t = makeTestApp();
afterAll(() => t.cleanup());

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

describe('engagement, scope, team, authorization', () => {
  it('edits engagement fields and validates timezone and window', async () => {
    const ok = await t.api.patch(t.base, { purpose: 'Synthetic test purpose', timezone: 'America/Chicago', window_start: '2026-10-20T13:00:00.000Z', window_end: '2026-10-21T21:00:00.000Z' });
    expect(ok.status).toBe(200);
    expect(ok.body.timezone).toBe('America/Chicago');
    const badTz = await t.api.patch(t.base, { timezone: 'Mars/Olympus' });
    expect(badTz.status).toBe(400);
    const badWin = await t.api.patch(t.base, { window_start: '2026-10-22T00:00:00Z', window_end: '2026-10-21T00:00:00Z' });
    expect(badWin.status).toBe(400);
    const unknown = await t.api.patch(t.base, { not_a_field: 1 });
    expect(unknown.status).toBe(400);
  });

  it('requires an authorization reference before confirming, and revokes on reference change', async () => {
    const r1 = await t.api.post(`${t.base}/authorization`, { confirmed: true });
    expect(r1.status).toBe(400);
    await t.api.patch(t.base, { authorization_ref: 'SYNTHETIC-AUTH-001' });
    const r2 = await t.api.post(`${t.base}/authorization`, { confirmed: true, confirmed_by: 'Test Analyst' });
    expect(r2.body.authorization_status).toBe('confirmed');
    expect(r2.body.authorization_confirmed_by).toBe('Test Analyst');
    const r3 = await t.api.patch(t.base, { authorization_ref: 'SYNTHETIC-AUTH-002' });
    expect(r3.body.authorization_status).toBe('unconfirmed');
  });

  it('manages scope entries and enforces exclusions in scope checks', async () => {
    const a = await t.api.post(`${t.base}/scope`, { kind: 'in', target: '192.0.2.0/24', confirmed: true });
    expect(a.status).toBe(201);
    expect(a.body.scope[0].target_type).toBe('cidr');
    await t.api.post(`${t.base}/scope`, { kind: 'out', target: '192.0.2.1', notes: 'Gateway excluded' });
    const inScope = await t.api.get(`${t.base}/scope/check?ip=192.0.2.10`);
    expect(inScope.body.status).toBe('in_scope');
    const excluded = await t.api.get(`${t.base}/scope/check?ip=192.0.2.1`);
    expect(excluded.body.status).toBe('excluded');
    const outside = await t.api.get(`${t.base}/scope/check?ip=10.0.0.5`);
    expect(outside.body.status).toBe('not_in_scope');
    const sid = a.body.scope.find((s: any) => s.kind === 'in').id;
    const upd = await t.api.patch(`${t.base}/scope/${sid}`, { confirmed: false });
    expect(upd.body.scope.find((s: any) => s.id === sid).confirmed).toBe(false);
    const del = await t.api.del(`${t.base}/scope/${sid}`);
    expect(del.body.scope.some((s: any) => s.id === sid)).toBe(false);
    const empty = await t.api.post(`${t.base}/scope`, { kind: 'in', target: '' });
    expect(empty.status).toBe(400);
  });

  it('manages team members', async () => {
    const r = await t.api.post(`${t.base}/team`, { name: 'Test Member', role: 'Recon Lead' });
    expect(r.status).toBe(201);
    const id = r.body.team[0].id;
    const u = await t.api.patch(`${t.base}/team/${id}`, { contributions: 'Synthetic contribution' });
    expect(u.body.team[0].contributions).toBe('Synthetic contribution');
    const d = await t.api.del(`${t.base}/team/${id}`);
    expect(d.body.team).toHaveLength(0);
  });

  it('refuses to delete the last real engagement and requires typed name', async () => {
    const eng = await t.api.get(t.base);
    const wrong = await t.api.del(t.base, { confirm: 'nope' });
    expect(wrong.status).toBe(400);
    const last = await t.api.del(t.base, { confirm: eng.body.name });
    expect(last.status).toBe(400);
    const created = await t.api.post('/api/engagements', { name: 'Second synthetic engagement' });
    expect(created.status).toBe(201);
    const ok = await t.api.del(`/api/engagements/${created.body.id}`, { confirm: 'Second synthetic engagement' });
    expect(ok.status).toBe(200);
  });
});

describe('tracker', () => {
  it('lists six labs, packet screenshots and deliverables; nothing is complete on an empty engagement', async () => {
    const r = await t.api.get(`${t.base}/tracker`);
    expect(r.status).toBe(200);
    expect(r.body.labs).toHaveLength(6);
    expect(r.body.labs.every((l: any) => l.status !== 'requirements_met' && l.status !== 'signed_off')).toBe(true);
    expect(r.body.screenshots.length).toBe(18);
    expect(r.body.deliverables.map((d: any) => d.key)).toContain('team_contribution');
    expect(r.body.final_due).toBe('2026-11-23');
  });

  it('only attaches images to screenshot requirements, and refuses app captures for tool activity', async () => {
    const tr = await t.api.get(`${t.base}/tracker`);
    const appView = tr.body.screenshots.find((s: any) => s.key === 'lab1_engagement');
    const tool = tr.body.screenshots.find((s: any) => s.key === 'lab3_scan_command');
    const txt = await t.api.upload(`${t.base}/evidence`, 'not an image', 'a.txt', { source_category: 'authorized_lab' });
    const r1 = await t.api.put(`${t.base}/tracker/screenshots/${appView.id}`, { evidence_id: txt.body.id });
    expect(r1.status).toBe(400);
    const cap = await t.api.upload(`${t.base}/evidence`, PNG, 'cap.png', { source_category: 'project_artifact' });
    const r2 = await t.api.put(`${t.base}/tracker/screenshots/${appView.id}`, { evidence_id: cap.body.code });
    expect(r2.status).toBe(200);
    const r3 = await t.api.put(`${t.base}/tracker/screenshots/${tool.id}`, { evidence_id: cap.body.id });
    expect(r3.status).toBe(400);
    const lab = await t.api.upload(`${t.base}/evidence`, Buffer.concat([PNG, Buffer.from([0])]), 'terminal.png', { source_category: 'authorized_lab' });
    const r4 = await t.api.put(`${t.base}/tracker/screenshots/${tool.id}`, { evidence_id: lab.body.id });
    expect(r4.status).toBe(200);
    const after = await t.api.get(`${t.base}/tracker`);
    expect(after.body.screenshots.find((s: any) => s.key === 'lab1_engagement').evidence_code).toBe(cap.body.code);
  });

  it('refuses lab sign-off while requirements are unmet', async () => {
    const r = await t.api.post(`${t.base}/tracker/labs/lab1/signoff`, { signed: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/unmet requirement/);
  });

  it('updates deliverables', async () => {
    const tr = await t.api.get(`${t.base}/tracker`);
    const d = tr.body.deliverables[0];
    const r = await t.api.put(`${t.base}/tracker/deliverables/${d.id}`, { status: 'in_progress', notes: 'synthetic' });
    expect(r.status).toBe(200);
    const bad = await t.api.put(`${t.base}/tracker/deliverables/${d.id}`, { status: 'finished' });
    expect(bad.status).toBe(400);
  });
});

describe('backup and restore', () => {
  it('downloads a zip whose manifest hashes verify and restores into a fresh directory', async () => {
    const r = await t.agent.get('/api/backup').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    const buf = r.body as Buffer;
    const entries = readZip(buf);
    const names = entries.map((e) => e.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('cyberdome.db');
    expect(names.some((n) => n.startsWith('evidence/'))).toBe(true);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberdome-restore-test-'));
    const zipPath = path.join(tmp, 'b.zip');
    fs.writeFileSync(zipPath, buf);
    const files = loadBackup(zipPath);
    const { manifest, problems } = verifyBackup(files);
    expect(problems).toEqual([]);
    const target = path.join(tmp, 'data');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'old.txt'), 'previous');
    const { movedTo } = writeRestore(files, manifest, target);
    expect(movedTo).toBeTruthy();
    expect(fs.existsSync(path.join(movedTo!, 'old.txt'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'cyberdome.db'))).toBe(true);

    // Tampering is detected
    const tampered = new Map(files);
    const evKey = [...tampered.keys()].find((k) => k.startsWith('evidence/'))!;
    tampered.set(evKey, Buffer.from('tampered'));
    expect(verifyBackup(tampered).problems.length).toBeGreaterThan(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
