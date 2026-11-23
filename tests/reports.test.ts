/** Reports & exports tests. All data is SYNTHETIC test data in a temporary directory. */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { makeTestApp } from './helpers';
import { readZip } from './zip-reader';
import { uid, nowIso } from '../server/lib/codes';

const t = makeTestApp();
afterAll(() => t.cleanup());

const binary = (res: any, cb: any) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

let evA: any, evSens: any, evRef: any;
beforeAll(async () => {
  evA = (await t.api.post(`${t.base}/evidence/text`, { text: 'SYNTHETIC nmap output 192.0.2.10 22/tcp open ssh', title: 'Synthetic scan output', source_category: 'authorized_lab', sanitization_status: 'sanitized' })).body;
  evSens = (await t.api.post(`${t.base}/evidence/text`, { text: 'SYNTHETIC sensitive', title: 'Sensitive raw log', source_category: 'authorized_lab', sanitization_status: 'contains_sensitive' })).body;
  evRef = (await t.api.post(`${t.base}/evidence/reference`, { reference_uri: 'lab-share://pcaps/synthetic.pcapng', title: 'PCAP reference', source_category: 'instructor_supplied' })).body;
  // Seed a finding directly (findings routes are owned by another module).
  const db = t.ctx.db;
  const fid = uid();
  db.insert('findings', {
    id: fid, engagement_id: t.eid, code: 'FND-001', title: 'Synthetic <script>alert(1)</script> outdated SSH', severity: 'high', description: 'SYNTHETIC test finding',
    impact: 'Test impact', remediation: 'Upgrade OpenSSH', validation_status: 'scanner_reported', created_at: nowIso(), updated_at: nowIso(),
  });
  db.run('INSERT INTO finding_evidence (finding_id, evidence_id) VALUES (?,?)', fid, evA.id);
});

describe('report assembly and readiness (synthetic)', () => {
  it('assembles a report from records with readiness blockers', async () => {
    const r = await t.api.get(`${t.base}/report`);
    expect(r.status).toBe(200);
    expect(r.body.findings).toHaveLength(1);
    expect(r.body.findings[0].unverified).toBe(true);
    expect(r.body.findings[0].evidence.map((e: any) => e.code)).toEqual(['EV-001']);
    expect(r.body.readiness.ready).toBe(false);
    expect(r.body.readiness.issues.some((i: any) => /Executive summary is empty/.test(i.message))).toBe(true);
    expect(r.body.evidence).toHaveLength(3);
  });

  it('saves manual narrative with provenance and blocks finalize while blockers remain', async () => {
    const r = await t.api.put(`${t.base}/report`, { narrative: { executive_summary: 'Manual synthetic summary.', methodology: 'Imported scans.' } });
    expect(r.status).toBe(200);
    expect(r.body.narrative_sources.executive_summary.type).toBe('manual');
    const f = await t.api.post(`${t.base}/report/finalize`);
    expect(f.status).toBe(400);
    expect(f.body.details.issues.length).toBeGreaterThan(0);
  });

  it('rejects unknown narrative keys', async () => {
    const r = await t.api.put(`${t.base}/report`, { narrative: { bogus: 'x' } });
    expect(r.status).toBe(400);
  });
});

describe('exports (synthetic)', () => {
  it('exports the HTML report escaped, with DRAFT label', async () => {
    const r = await t.api.get(`${t.base}/exports/report.html`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment/);
    expect(r.text).toContain('DRAFT');
    expect(r.text).not.toContain('<script>alert(1)</script>');
    expect(r.text).toContain('&lt;script&gt;');
    expect(r.text).toContain('Scanner-reported');
    for (const s of ['Executive summary', 'Scope and authorization', 'Methodology', 'Limitations', 'Reconnaissance summary', 'Asset and service inventory', 'Findings', 'Top-three priorities', 'Attack timeline', 'Remediation recommendations', 'Evidence references', 'AI use and human verification statement', 'Team contributions'])
      expect(r.text).toContain(s);
  });

  it('exports Markdown, executive summary and the complete engagement JSON', async () => {
    const md = await t.api.get(`${t.base}/exports/report.md`);
    expect(md.text).toContain('## Findings');
    const ex = await t.api.get(`${t.base}/exports/executive-summary.html`);
    expect(ex.text).toContain('Executive summary');
    const js = await t.api.get(`${t.base}/exports/engagement.json`);
    const body = JSON.parse(js.text);
    expect(body.evidence).toHaveLength(3);
    expect(body.findings[0].evidence_codes).toEqual(['EV-001']);
    expect(body.data_labels.is_demo).toBe(false);
  });

  it('builds an evidence package whose manifest hashes match the files', async () => {
    const r = await t.agent.get(`${t.base}/exports/package.zip`).buffer(true).parse(binary);
    expect(r.status).toBe(200);
    const files = readZip(r.body as Buffer);
    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
    expect(manifest.files.length).toBeGreaterThan(5);
    for (const f of manifest.files) {
      const data = files.get(f.path);
      expect(data, f.path).toBeDefined();
      expect(crypto.createHash('sha256').update(data!).digest('hex')).toBe(f.sha256);
      expect(data!.length).toBe(f.size_bytes);
    }
    const paths = manifest.files.map((f: any) => f.path);
    expect(paths).toContain('evidence-index.csv');
    expect(paths).toContain('report.html');
    expect(paths.some((p: string) => p.startsWith('evidence/EV-001__'))).toBe(true);
    expect(paths.some((p: string) => p.startsWith('evidence/EV-002__'))).toBe(false);
    expect(manifest.excluded_evidence.map((x: any) => x.evidence_id).sort()).toEqual(['EV-002', 'EV-003']);
    const stored = files.get(paths.find((p: string) => p.startsWith('evidence/EV-001__')))!;
    expect(crypto.createHash('sha256').update(stored).digest('hex')).toBe(evA.sha256);
    expect(files.get('evidence-index.csv')!.toString('utf8')).toContain('EV-003');
    expect(files.get('README.txt')!.toString('utf8')).toMatch(/chain of custody/);
  });

  it('sanitized-only package excludes unreviewed evidence', async () => {
    await t.api.post(`${t.base}/evidence/text`, { text: 'SYNTHETIC unreviewed', title: 'Unreviewed', source_category: 'authorized_lab' });
    const r = await t.agent.get(`${t.base}/exports/package.zip?sanitized_only=1`).buffer(true).parse(binary);
    const manifest = JSON.parse(readZip(r.body as Buffer).get('manifest.json')!.toString('utf8'));
    expect(manifest.evidence_policy).toBe('sanitized_only');
    expect(manifest.excluded_evidence.map((x: any) => x.evidence_id)).toContain('EV-004');
  });
});

describe('demo labeling (synthetic)', () => {
  it('labels demo engagement exports', async () => {
    const id = uid();
    t.ctx.db.insert('engagements', { id, name: 'Demo test', client_name: 'CyberDome Corporation', is_demo: 1, created_at: nowIso(), updated_at: nowIso() });
    const r = await t.api.get(`/api/engagements/${id}/exports/report.html`);
    expect(r.text).toContain('DEMO DATA');
  });
});
