import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { makeTestApp, fixture } from './helpers';
import { parseFindingsFile } from '../server/importers/findings';

// All data in this file is SYNTHETIC (RFC 5737 addresses, fixture files labeled SYNTHETIC).
const t = makeTestApp();
afterAll(() => t.cleanup());

let web01 = '', db01 = '', ssh30 = '', mysql30 = '';

beforeAll(() => {
  const now = new Date().toISOString();
  const mk = (code: string, ip: string, hostname: string) => {
    const id = crypto.randomUUID();
    t.ctx.db.insert('assets', { id, engagement_id: t.eid, code, ip, hostname, hostnames: [hostname], origin: 'manual', created_at: now, updated_at: now });
    return id;
  };
  const svc = (asset: string, port: number, name: string) => {
    const id = crypto.randomUUID();
    t.ctx.db.insert('services', { id, engagement_id: t.eid, asset_id: asset, port, protocol: 'tcp', state: 'open', service_name: name, created_at: now, updated_at: now });
    return id;
  };
  web01 = mk('AST-001', '192.0.2.10', 'web01.cyberdome.example');
  db01 = mk('AST-002', '192.0.2.30', 'db01.cyberdome.example');
  mk('AST-003', '192.0.2.40', 'ftp01.cyberdome.example');
  ssh30 = svc(db01, 22, 'ssh');
  mysql30 = svc(db01, 3306, 'mysql');
  svc(web01, 80, 'http');
});

describe('finding parsers (synthetic fixtures)', () => {
  it('parses Nessus v2 including CVEs, CVSS v3, and skips informational by default', () => {
    const r = parseFindingsFile(fixture('vuln-sample.nessus').toString(), 'x.nessus');
    expect(r.format).toBe('nessus');
    expect(r.errors).toEqual([]);
    expect(r.total_rows).toBe(5);
    expect(r.skipped_info).toBe(1);
    expect(r.rows).toHaveLength(4);
    const apache = r.rows.find((x) => x.plugin_id === '900101')!;
    expect(apache.cves).toEqual(['CVE-2021-44790', 'CVE-2021-41773']);
    expect(apache.cvss_score).toBe(6.5);
    expect(apache.cvss_version).toBe('3.0');
    expect(apache.severity).toBe('medium');
    expect(apache.host_ip).toBe('192.0.2.10');
    expect(apache.port).toBe(80);
    expect(r.rows.find((x) => x.plugin_id === '900104')!.severity).toBe('critical');
    const withInfo = parseFindingsFile(fixture('vuln-sample.nessus').toString(), 'x.nessus', { includeInfo: true });
    expect(withInfo.rows).toHaveLength(5);
  });

  it('parses Greenbone/OpenVAS XML with refs, threat, and general/tcp ports', () => {
    const r = parseFindingsFile(fixture('vuln-greenbone.xml').toString(), 'r.xml', { includeInfo: true });
    expect(r.format).toBe('greenbone_xml');
    expect(r.rows).toHaveLength(3);
    const ssh = r.rows[0];
    expect(ssh.cves).toEqual(['CVE-2021-41617']);
    expect(ssh.severity).toBe('high');
    expect(ssh.cvss_vector).toMatch(/^CVSS:3\.1/);
    expect(ssh.cvss_version).toBe('3.1');
    expect(ssh.port).toBe(22);
    expect(ssh.hostname).toBe('db01.cyberdome.example');
    expect(ssh.remediation).toMatch(/Update OpenSSH/);
    expect(ssh.impact).toMatch(/local attacker/);
    expect(r.rows[2].severity).toBe('info');
    expect(r.rows[2].port).toBeNull();
  });

  it('reports row errors, unknown columns, malformed CVEs and invalid values for normalized CSV', () => {
    const r = parseFindingsFile(fixture('vuln-normalized.csv').toString(), 'f.csv');
    expect(r.format).toBe('normalized_csv');
    expect(r.unknown_columns).toEqual(['ticket_ref']);
    expect(r.rows).toHaveLength(3);
    expect(r.errors.map((e) => e.row)).toEqual([4, 5]);
    const bad = r.rows.find((x) => x.plugin_id === 'IS-05')!;
    expect(bad.cves).toEqual(['CVE-2020-1234']);
    expect(bad.port).toBeNull();
    expect(bad.cvss_score).toBeNull();
    expect(r.warnings.some((w) => /CVE-2021-XYZ/.test(w.message))).toBe(true);
  });

  it('keeps a hostname given in the IP column as a hostname instead of guessing an IP', () => {
    const r = parseFindingsFile(fixture('vuln-normalized.json').toString(), 'f.json');
    expect(r.rows[1].host_ip).toBeNull();
    expect(r.rows[1].hostname).toBe('ftp01.cyberdome.example');
    expect(r.unknown_columns).toContain('extra_field');
  });

  it('handles malformed and truncated files without crashing', () => {
    expect(parseFindingsFile(fixture('vuln-malformed.csv').toString(), 'm.csv').errors.length).toBeGreaterThan(0);
    const tr = parseFindingsFile(fixture('vuln-truncated.nessus').toString(), 't.nessus');
    expect(tr.rows).toHaveLength(0);
  });
});

describe('finding imports', () => {
  it('previews without writing', async () => {
    const r = await t.api.upload(`${t.base}/finding-imports/preview`, fixture('vuln-sample.nessus'), 'scan.nessus');
    expect(r.status).toBe(200);
    expect(r.body.valid_rows).toBe(4);
    expect(r.body.to_create).toBe(4);
    expect(r.body.initial_validation_status).toBe('scanner_reported');
    expect(r.body.warnings.some((w: any) => /192\.0\.2\.99/.test(w.message))).toBe(true);
    const list = await t.api.get(`${t.base}/findings`);
    expect(list.body.total).toBe(0);
  });

  it('imports Nessus as scanner-reported findings linked to assets, services, and evidence', async () => {
    const r = await t.api.upload(`${t.base}/finding-imports`, fixture('vuln-sample.nessus'), 'scan.nessus', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('VIM-001');
    expect(r.body.created).toBe(4);
    expect(r.body.evidence_code).toBe('EV-001');
    const list = await t.api.get(`${t.base}/findings`);
    expect(list.body.total).toBe(4);
    for (const f of list.body.items) {
      expect(f.validation_status).toBe('scanner_reported');
      expect(f.evidence.map((e: any) => e.code)).toEqual(['EV-001']);
    }
    const mysql = list.body.items.find((f: any) => f.scanner_plugin_id === '900103');
    expect(mysql.assets[0].code).toBe('AST-002');
    const d = await t.api.get(`${t.base}/findings/${mysql.id}`);
    expect(d.body.services.map((s: any) => s.id)).toEqual([mysql30]);
    const telnet = list.body.items.find((f: any) => f.scanner_plugin_id === '900104');
    expect(telnet.assets).toEqual([]);
    expect(telnet.description).toMatch(/192\.0\.2\.99/);
  });

  it('re-importing the same file updates instead of duplicating, and reuses the stored artifact', async () => {
    const r = await t.api.upload(`${t.base}/finding-imports`, fixture('vuln-sample.nessus'), 'scan.nessus', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(0);
    expect(r.body.unchanged).toBe(4);
    expect(r.body.evidence_code).toBe('EV-001');
    const list = await t.api.get(`${t.base}/findings`);
    expect(list.body.total).toBe(4);
    const ev = await t.api.get(`${t.base}/evidence`);
    expect(ev.body.total).toBe(1);
  });

  it('imports Greenbone; partial normalized CSV import records errors', async () => {
    const g = await t.api.upload(`${t.base}/finding-imports`, fixture('vuln-greenbone.xml'), 'gb.xml', { source_category: 'instructor_supplied' });
    expect(g.body.created).toBe(2);
    expect(g.body.skipped_info).toBe(1);
    const c = await t.api.upload(`${t.base}/finding-imports`, fixture('vuln-normalized.csv'), 'sheet.csv', { source_category: 'instructor_supplied' });
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('partial');
    expect(c.body.errors.length).toBe(2);
    const imports = await t.api.get(`${t.base}/finding-imports`);
    expect(imports.body.map((i: any) => i.code)).toEqual(['VIM-004', 'VIM-003', 'VIM-002', 'VIM-001']);
    const potentials = await t.api.get(`${t.base}/findings?validation_status=potential`);
    expect(potentials.body.total).toBe(3);
  });

  it('rejects files with no usable rows', async () => {
    const r = await t.api.upload(`${t.base}/finding-imports`, fixture('vuln-malformed.csv'), 'bad.csv');
    expect(r.status).toBe(400);
  });
});

describe('finding workflow', () => {
  let fid = '';
  it('creates a manual finding linked to asset, service, and evidence', async () => {
    const ev = await t.api.upload(`${t.base}/evidence`, 'SYNTHETIC banner: SSH-2.0-OpenSSH_7.6p1', 'banner.txt', { source_category: 'authorized_lab' });
    const r = await t.api.post(`${t.base}/findings`, {
      title: 'SYNTHETIC - Outdated OpenSSH on db01', severity: 'medium', cves: ['cve-2021-41617'],
      service_ids: [ssh30], evidence_ids: [ev.body.code], description: 'Banner shows 7.6p1', impact: 'x', remediation: 'Upgrade',
    });
    expect(r.status).toBe(201);
    fid = r.body.id;
    expect(r.body.cves).toEqual(['CVE-2021-41617']);
    expect(r.body.validation_status).toBe('potential');
    expect(r.body.assets.map((a: any) => a.id)).toEqual([db01]);
    expect(r.body.evidence[0].code).toBe(ev.body.code);
  });

  it('rejects invalid CVE identifiers and unknown evidence', async () => {
    expect((await t.api.post(`${t.base}/findings`, { title: 'x', severity: 'low', cves: ['CVE-XX'] })).status).toBe(400);
    expect((await t.api.post(`${t.base}/findings`, { title: 'x', severity: 'low', evidence_ids: ['EV-999'] })).status).toBe(400);
  });

  it('requires evidence and notes before marking analyst-validated', async () => {
    const noEv = await t.api.post(`${t.base}/findings`, { title: 'SYNTHETIC no evidence', severity: 'low' });
    const r1 = await t.api.patch(`${t.base}/findings/${noEv.body.id}`, { validation_status: 'validated', validation_notes: 'Confirmed manually by banner grab' });
    expect(r1.status).toBe(400);
    const r2 = await t.api.patch(`${t.base}/findings/${fid}`, { validation_status: 'validated' });
    expect(r2.status).toBe(400);
    const r3 = await t.api.patch(`${t.base}/findings/${fid}`, { validation_status: 'validated', validation_notes: 'Re-ran ssh -V banner grab; output stored as evidence.' });
    expect(r3.status).toBe(200);
    expect(r3.body.validation_status).toBe('validated');
    expect(r3.body.validated_by).toBeTruthy();
    expect(r3.body.reviews[0].decision).toBe('validation:validated');
    const fp = await t.api.patch(`${t.base}/findings/${noEv.body.id}`, { validation_status: 'false_positive' });
    expect(fp.status).toBe(400);
  });

  it('sets top-three priorities with unique ranks and rationale', async () => {
    const list = (await t.api.get(`${t.base}/findings?exclude_fp=1`)).body.items;
    const [a, b, c] = list;
    expect((await t.api.put(`${t.base}/priorities`, { items: [{ finding_id: a.id, rank: 1, rationale: 'short' }] })).status).toBe(400);
    expect((await t.api.put(`${t.base}/priorities`, { items: [{ finding_id: a.id, rank: 1, rationale: 'Exposed and validated with evidence.' }, { finding_id: b.id, rank: 1, rationale: 'Duplicate rank should fail.' }] })).status).toBe(400);
    const ok = await t.api.put(`${t.base}/priorities`, {
      items: [
        { finding_id: c.id, rank: 3, rationale: 'Lower exposure but easy fix.' },
        { finding_id: a.id, rank: 1, rationale: 'Highest exposure on a critical asset.' },
        { finding_id: b.id, rank: 2, rationale: 'Validated with evidence; remote reach.' },
      ],
    });
    expect(ok.status).toBe(200);
    const p = await t.api.get(`${t.base}/priorities`);
    expect(p.body.ranked.map((f: any) => f.id)).toEqual([a.id, b.id, c.id]);
  });

  it('manages remediation tasks', async () => {
    const r = await t.api.post(`${t.base}/findings/${fid}/tasks`, { title: 'Upgrade OpenSSH', owner: 'Ops', due_date: '2026-11-01' });
    expect(r.status).toBe(201);
    const u = await t.api.patch(`${t.base}/remediation-tasks/${r.body.id}`, { status: 'done' });
    expect(u.body.status).toBe('done');
    const all = await t.api.get(`${t.base}/remediation-tasks`);
    expect(all.body[0].finding_code).toBeTruthy();
    expect((await t.api.post(`${t.base}/findings/${fid}/tasks`, { title: 'x', due_date: 'tomorrow' })).status).toBe(400);
  });

  it('exports all findings as CSV and JSON', async () => {
    const total = (await t.api.get(`${t.base}/findings`)).body.total;
    const csv = await t.api.get(`${t.base}/exports/findings.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split('\n').length).toBeGreaterThanOrEqual(total + 1);
    const json = await t.api.get(`${t.base}/exports/findings.json`);
    expect(json.body.count).toBe(total);
  });

  it('deletes a finding only with the confirmation code, keeping evidence', async () => {
    const d = (await t.api.get(`${t.base}/findings/${fid}`)).body;
    expect((await t.api.del(`${t.base}/findings/${fid}`, { confirm: 'nope' })).status).toBe(400);
    expect((await t.api.del(`${t.base}/findings/${fid}`, { confirm: d.code })).status).toBe(200);
    expect((await t.api.get(`${t.base}/evidence/${d.evidence[0].id}`)).status).toBe(200);
  });

  it('serves the template', async () => {
    const r = await t.api.get(`${t.base}/findings-template.csv`);
    expect(r.text).toMatch(/^title,severity,host_ip/);
  });
});
