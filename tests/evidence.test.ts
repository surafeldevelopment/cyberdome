import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeTestApp } from './helpers';

// All evidence in this file is SYNTHETIC test data created inline.
const t = makeTestApp();
afterAll(() => t.cleanup());

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

/** Tiny synthetic classic-pcap buffer: 2 packets, Ethernet link type. */
function syntheticPcap(): Buffer {
  const gh = Buffer.alloc(24);
  gh.writeUInt32LE(0xa1b2c3d4, 0);
  gh.writeUInt16LE(2, 4);
  gh.writeUInt16LE(4, 6);
  gh.writeUInt32LE(65535, 16);
  gh.writeUInt32LE(1, 20);
  const rec = (sec: number, len: number) => {
    const h = Buffer.alloc(16);
    h.writeUInt32LE(sec, 0);
    h.writeUInt32LE(0, 4);
    h.writeUInt32LE(len, 8);
    h.writeUInt32LE(len, 12);
    return Buffer.concat([h, Buffer.alloc(len, 0xab)]);
  };
  return Buffer.concat([gh, rec(1792400000, 60), rec(1792400005, 42)]);
}

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 1)]);

let fileEv: any;
let textEv: any;

describe('Evidence Locker (synthetic test data)', () => {
  beforeAll(async () => {
    const content = 'SYNTHETIC: Nmap scan report for lab host\n22/tcp open ssh\n';
    const r = await t.api.upload(`${t.base}/evidence`, content, 'synthetic-scan.txt', {
      source_category: 'authorized_lab',
      title: 'Alpha synthetic scan output',
      source_tool: 'nmap',
      tags: 'scan, Lab3',
      observation: 'Shows port 22 open',
      sanitization_status: 'sanitized',
    });
    expect(r.status).toBe(201);
    fileEv = r.body;
  });

  it('calculates SHA-256 from the uploaded bytes', () => {
    const content = 'SYNTHETIC: Nmap scan report for lab host\n22/tcp open ssh\n';
    expect(fileEv.sha256).toBe(sha(content));
    expect(fileEv.code).toBe('EV-001');
    expect(fileEv.kind).toBe('file');
    expect(fileEv.tags).toEqual(['scan', 'lab3']);
    expect(fileEv.reviews.some((x: any) => x.action === 'imported')).toBe(true);
  });

  it('flags duplicate uploads by hash', async () => {
    const r = await t.api.upload(`${t.base}/evidence`, 'SYNTHETIC: Nmap scan report for lab host\n22/tcp open ssh\n', 'dup.txt', { source_category: 'authorized_lab' });
    expect(r.status).toBe(201);
    expect(r.body.duplicate_of).toBe('EV-001');
  });

  it('stores pasted text output as a hashed file', async () => {
    const text = 'C:\\> net user\nSYNTHETIC admin2 account listed';
    const r = await t.api.post(`${t.base}/evidence/text`, { text, title: 'Beta pasted output', source_category: 'instructor_supplied', filename: 'net-user.txt' });
    expect(r.status).toBe(201);
    textEv = r.body;
    expect(r.body.sha256).toBe(sha(text));
    expect(r.body.original_filename).toBe('net-user.txt');
    expect(r.body.source_category).toBe('instructor_supplied');
  });

  it('records references and validates analyst-supplied hashes', async () => {
    const bad = await t.api.post(`${t.base}/evidence/reference`, { reference_uri: 'lab-share/capture.pcapng', reference_sha256: 'nothex', source_category: 'instructor_supplied' });
    expect(bad.status).toBe(400);
    const good = await t.api.post(`${t.base}/evidence/reference`, {
      reference_uri: 'lab-share/capture.pcapng',
      reference_sha256: 'A'.repeat(64),
      source_category: 'instructor_supplied',
      title: 'Gamma capture reference',
    });
    expect(good.status).toBe(201);
    expect(good.body.kind).toBe('reference');
    expect(good.body.sha256).toBe('a'.repeat(64));
    expect(good.body.analysis_note).toMatch(/supplied by the analyst/);
    const prev = await t.api.get(`${t.base}/evidence/${good.body.id}/preview`);
    expect(prev.body.type).toBe('reference');
    const vh = await t.api.post(`${t.base}/evidence/${good.body.id}/verify-hash`);
    expect(vh.status).toBe(400);
  });

  it('filters, searches, and sorts the list', async () => {
    const byCat = await t.api.get(`${t.base}/evidence?source_category=instructor_supplied`);
    expect(byCat.body.items.every((e: any) => e.source_category === 'instructor_supplied')).toBe(true);
    expect(byCat.body.total).toBe(2);
    const q = await t.api.get(`${t.base}/evidence?q=Beta`);
    expect(q.body.total).toBe(1);
    expect(q.body.items[0].code).toBe(textEv.code);
    const tag = await t.api.get(`${t.base}/evidence?tag=lab3`);
    expect(tag.body.total).toBe(1);
    const sorted = await t.api.get(`${t.base}/evidence?sort=title&dir=asc`);
    const titles = sorted.body.items.map((e: any) => e.title);
    // Title sort is case-insensitive (COLLATE NOCASE).
    expect(titles).toEqual([...titles].sort((a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0)));
    const desc = await t.api.get(`${t.base}/evidence?sort=title&dir=desc`);
    expect(desc.body.items.map((e: any) => e.title)).toEqual([...titles].reverse());
    const san = await t.api.get(`${t.base}/evidence?sanitization_status=sanitized`);
    expect(san.body.items.map((e: any) => e.code)).toContain('EV-001');
  });

  it('paginates the list, while the index export returns ALL records', async () => {
    const page = await t.api.get(`${t.base}/evidence?limit=2&offset=0`);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBe(4);
    const json = await t.api.get(`${t.base}/evidence-index.json`);
    expect(json.status).toBe(200);
    expect(json.body.count).toBe(4);
    expect(json.body.evidence).toHaveLength(4);
    expect(json.body.note).toMatch(/do not by themselves establish authenticity/);
    const csv = await t.api.get(`${t.base}/evidence-index.csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.trim().split('\n')).toHaveLength(5);
  });

  it('shows cross-module links on the detail record', async () => {
    const now = new Date().toISOString();
    const db = t.ctx.db;
    db.insert('assets', { id: 'asset-syn-1', engagement_id: t.eid, code: 'AST-001', ip: '10.99.0.5', hostname: 'syn-host', created_at: now, updated_at: now });
    db.insert('findings', { id: 'finding-syn-1', engagement_id: t.eid, code: 'FND-001', title: 'Synthetic finding', severity: 'medium', created_at: now, updated_at: now });
    db.run('INSERT INTO finding_evidence (finding_id, evidence_id) VALUES (?,?)', 'finding-syn-1', fileEv.id);
    const p = await t.api.patch(`${t.base}/evidence/${fileEv.id}`, { asset_ids: ['AST-001'] });
    expect(p.status).toBe(200);
    expect(p.body.assets.map((a: any) => a.code)).toEqual(['AST-001']);
    const d = await t.api.get(`${t.base}/evidence/${fileEv.id}`);
    expect(d.body.findings.map((f: any) => f.code)).toEqual(['FND-001']);
    const byCode = await t.api.get(`${t.base}/evidence/EV-001`);
    expect(byCode.body.id).toBe(fileEv.id);
    const unlinked = await t.api.get(`${t.base}/evidence?unlinked=1`);
    expect(unlinked.body.items.map((e: any) => e.code)).not.toContain('EV-001');
    const bad = await t.api.patch(`${t.base}/evidence/${fileEv.id}`, { asset_ids: ['AST-999'] });
    expect(bad.status).toBe(400);
  });

  it('records review history for metadata edits and sanitization changes', async () => {
    const r = await t.api.patch(`${t.base}/evidence/${textEv.id}`, { interpretation: 'Possible unauthorized admin account', confidence: 'low', sanitization_status: 'contains_sensitive' });
    expect(r.status).toBe(200);
    const actions = r.body.reviews.map((x: any) => x.action);
    expect(actions).toContain('metadata_edited');
    expect(actions).toContain('sanitization:contains_sensitive');
    const rv = await t.api.post(`${t.base}/evidence/${textEv.id}/reviews`, { action: 'verified_against_source', notes: 'Compared with original terminal output' });
    expect(rv.status).toBe(201);
    expect(rv.body.reviews[0].action).toBe('verified_against_source');
    const badField = await t.api.patch(`${t.base}/evidence/${textEv.id}`, { sha256: 'x' });
    expect(badField.status).toBe(400);
  });

  it('creates a sanitized derivative that keeps the original and has its own hash', async () => {
    const text = 'C:\\> net user\nSYNTHETIC [REDACTED] account listed';
    const r = await t.agent.post(`${t.base}/evidence/${textEv.id}/derivative`).set('X-CyberDome', '1').field('text', text).field('derivation_note', 'Redacted account name');
    expect(r.status).toBe(201);
    expect(r.body.sha256).toBe(sha(text));
    expect(r.body.sha256).not.toBe(textEv.sha256);
    expect(r.body.derived_from.id).toBe(textEv.id);
    expect(r.body.sanitization_status).toBe('sanitized');
    const orig = await t.api.get(`${t.base}/evidence/${textEv.id}`);
    expect(orig.body.derivatives.map((d: any) => d.id)).toContain(r.body.id);
    expect(orig.body.sha256).toBe(textEv.sha256);
  });

  it('withdraws (retiring the ID) and restores evidence', async () => {
    const noReason = await t.api.post(`${t.base}/evidence/${textEv.id}/withdraw`, { confirm: true });
    expect(noReason.status).toBe(400);
    const w = await t.api.post(`${t.base}/evidence/${textEv.id}/withdraw`, { reason: 'Uploaded to wrong engagement', confirm: true });
    expect(w.body.status).toBe('withdrawn');
    const active = await t.api.get(`${t.base}/evidence`);
    expect(active.body.items.map((e: any) => e.id)).not.toContain(textEv.id);
    const all = await t.api.get(`${t.base}/evidence?status=all`);
    expect(all.body.items.map((e: any) => e.id)).toContain(textEv.id);
    const res = await t.api.post(`${t.base}/evidence/${textEv.id}/restore`);
    expect(res.body.status).toBe('active');
    expect(res.body.code).toBe(textEv.code);
  });

  it('re-verifies the hash and detects tampering of stored bytes', async () => {
    const ok = await t.api.post(`${t.base}/evidence/${fileEv.id}/verify-hash`);
    expect(ok.body.match).toBe(true);
    const row = t.ctx.db.get('SELECT storage_path FROM evidence WHERE id = ?', fileEv.id)!;
    fs.appendFileSync(path.join(t.ctx.cfg.evidenceDir, row.storage_path), 'tampered');
    const bad = await t.api.post(`${t.base}/evidence/${fileEv.id}/verify-hash`);
    expect(bad.body.match).toBe(false);
    expect(bad.body.computed).not.toBe(bad.body.stored);
    const d = await t.api.get(`${t.base}/evidence/${fileEv.id}`);
    expect(d.body.reviews.map((x: any) => x.action)).toContain('hash_mismatch');
  });

  it('returns safe previews by detected type', async () => {
    const txt = await t.api.get(`${t.base}/evidence/${textEv.id}/preview`);
    expect(txt.body.type).toBe('text');
    expect(txt.body.text).toMatch(/net user/);

    const img = await t.api.upload(`${t.base}/evidence`, PNG, 'shot.png', { source_category: 'authorized_lab' });
    expect(img.body.detected_type).toBe('png');
    const ip = await t.api.get(`${t.base}/evidence/${img.body.id}/preview`);
    expect(ip.body.type).toBe('image');

    const pcap = syntheticPcap();
    const pc = await t.api.upload(`${t.base}/evidence`, pcap, 'synthetic.png', { source_category: 'instructor_supplied' });
    expect(pc.body.detected_type).toBe('pcap');
    expect(pc.body.analysis_status).toBe('metadata_read');
    expect(pc.body.analysis_note).toMatch(/No packet contents were decoded/);
    const pp = await t.api.get(`${t.base}/evidence/${pc.body.id}/preview`);
    expect(pp.body.type).toBe('pcap');
    expect(pp.body.meta.packetCount).toBe(2);
    expect(pp.body.meta.linkTypeName).toBe('Ethernet');

    const html = await t.api.upload(`${t.base}/evidence`, '<!doctype html><html><script>alert(1)</script></html>', 'page.html', { source_category: 'authorized_lab' });
    expect(html.body.detected_type).toBe('html');
    const hp = await t.api.get(`${t.base}/evidence/${html.body.id}/preview`);
    expect(hp.body.type).toBe('text');
    expect(hp.body.untrusted_markup).toBe(true);

    const inlineHtml = await t.api.get(`${t.base}/evidence/${html.body.id}/raw?inline=1`);
    expect(inlineHtml.headers['content-type']).toMatch(/application\/octet-stream/);
    expect(inlineHtml.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('serves downloads as sandboxed attachments', async () => {
    const r = await t.api.get(`${t.base}/evidence/${fileEv.id}/raw`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="EV-001_/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toMatch(/sandbox/);
    expect(r.headers['content-type']).toMatch(/application\/octet-stream/);
  });

  it('refuses executables and demo data in a real engagement', async () => {
    const exe = await t.api.upload(`${t.base}/evidence`, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), 'tool', { source_category: 'authorized_lab' });
    expect(exe.status).toBe(400);
    expect(exe.body.error).toMatch(/Executable/);
    const demo = await t.api.post(`${t.base}/evidence/text`, { text: 'x', source_category: 'demo' });
    expect(demo.status).toBe(400);
    const missingCat = await t.api.upload(`${t.base}/evidence`, 'x', 'x.txt', {});
    expect(missingCat.status).toBe(400);
    const nofile = await t.agent.post(`${t.base}/evidence`).set('X-CyberDome', '1').field('source_category', 'authorized_lab');
    expect(nofile.status).toBe(400);
    const missing = await t.api.get(`${t.base}/evidence/EV-999`);
    expect(missing.status).toBe(404);
  });
});

describe('Evidence upload size limit', () => {
  const small = makeTestApp({ maxUploadBytes: 1024 });
  afterAll(() => small.cleanup());
  it('rejects oversized uploads with 413', async () => {
    const r = await small.api.upload(`${small.base}/evidence`, Buffer.alloc(4096, 0x41), 'big.txt', { source_category: 'authorized_lab' });
    expect(r.status).toBe(413);
  });
});
