import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.js';

// Acceptance criterion 13: records survive an application restart (SYNTHETIC data).
describe('persistence across restarts', () => {
  it('keeps evidence, scan inventory and files after the app is recreated on the same data dir', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberdome-persist-'));
    const H = { 'X-CyberDome': '1' };
    const first = createApp({ dataDir, referencesOnline: false });
    const eid = first.ctx.db.scalar<string>('SELECT id FROM engagements WHERE is_demo = 0');
    const base = `/api/engagements/${eid}`;
    const xml = fs.readFileSync(path.join(__dirname, '..', 'samples', 'demo', 'scan-nmap-demo.xml'));
    // The demo sample is synthetic; import into a scratch engagement as instructor-supplied for this test only.
    const imp = await request(first.app).post(`${base}/scan-imports`).set(H).attach('file', xml, 'scan.xml').field('source_category', 'instructor_supplied');
    expect(imp.status).toBe(201);
    const before = (await request(first.app).get(`${base}/dashboard`)).body.metrics;
    first.ctx.db.close();

    const second = createApp({ dataDir, referencesOnline: false });
    const after = (await request(second.app).get(`${base}/dashboard`)).body.metrics;
    expect(after.assets.value).toBe(before.assets.value);
    expect(after.open_services.value).toBe(before.open_services.value);
    expect(after.evidence.value).toBe(before.evidence.value);
    const ev = (await request(second.app).get(`${base}/evidence`)).body.items[0];
    const check = await request(second.app).post(`${base}/evidence/${ev.id}/verify-hash`).set(H);
    expect(check.body.match).toBe(true);
    second.ctx.db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
