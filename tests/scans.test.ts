import { describe, it, expect, afterAll } from 'vitest';
import { makeTestApp, fixture } from './helpers';

// All fixtures are SYNTHETIC (sandbox self-scan or hand-written demo data on RFC 5737 addresses).
const t = makeTestApp();
afterAll(() => t.cleanup());
const B = t.base;

const dash = async () => (await t.api.get(`${B}/dashboard`)).body.metrics;

describe('scan & enumeration import (synthetic fixtures)', () => {
  it('previews an Nmap XML file without writing anything', async () => {
    const r = await t.api.upload(`${B}/scan-imports/preview`, fixture('scan-nmap-demo.xml'), 'scan-nmap-demo.xml');
    expect(r.status).toBe(200);
    expect(r.body.format).toBe('nmap_xml');
    expect(r.body.counts.hosts).toBe(5);
    expect(r.body.counts.new_services).toBe(11);
    expect(r.body.hosts[0].scope.status).toBe('no_scope_defined');
    expect(r.body.duplicate_of).toBeNull();
    const ev = await t.api.get(`${B}/evidence`);
    expect(ev.body.total).toBe(0);
  });

  it('imports Nmap XML and calculates assets and open services correctly', async () => {
    const r = await t.api.upload(`${B}/scan-imports`, fixture('scan-nmap-demo.xml'), 'scan-nmap-demo.xml', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('SCN-001');
    expect(r.body.evidence_code).toBe('EV-001');
    expect(r.body.status).toBe('complete');
    expect(r.body.new_assets).toBe(5);
    expect(r.body.new_services).toBe(11);
    const m = await dash();
    expect(m.assets.value).toBe(5);
    expect(m.open_services.value).toBe(11);
  });

  it('keeps version provenance: probed versions detected, table guesses unknown', async () => {
    const svcs = (await t.api.get(`${B}/services`)).body;
    const ssh = svcs.find((s: any) => s.ip === '192.0.2.10' && s.port === 22);
    expect(ssh.version_status).toBe('detected');
    expect(ssh.product).toBe('OpenSSH');
    const smb = svcs.find((s: any) => s.ip === '192.0.2.20' && s.port === 445);
    expect(smb.version_status).toBe('unknown');
    expect(smb.version).toBeNull();
    const telnet = svcs.find((s: any) => s.port === 23);
    expect(telnet.product).toBe('Linux telnetd');
    expect(telnet.version_status).toBe('unknown');
    const assets = (await t.api.get(`${B}/assets`)).body;
    const web = assets.find((a: any) => a.ip === '192.0.2.10');
    expect(web.os_source).toBe('detected');
    expect(web.os_name).toContain('Linux');
  });

  it('rejects re-import of the identical file and never inflates totals', async () => {
    const r = await t.api.upload(`${B}/scan-imports`, fixture('scan-nmap-demo.xml'), 'again.xml', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/SCN-001/);
    const forced = await t.api.upload(`${B}/scan-imports`, fixture('scan-nmap-demo.xml'), 'again.xml', { source_category: 'instructor_supplied', allow_duplicate: 'true' });
    expect(forced.status).toBe(201);
    expect(forced.body.new_services).toBe(0);
    const m = await dash();
    expect(m.assets.value).toBe(5);
    expect(m.open_services.value).toBe(11);
    expect(m.open_services.secondary).toBe(22); // historical observations recorded twice
  });

  it('applies a newer rescan to current state and keeps history', async () => {
    const r = await t.api.upload(`${B}/scan-imports`, fixture('scan-nmap-rescan.xml'), 'rescan.xml', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(201);
    expect(r.body.new_services).toBe(0);
    expect(r.body.updated_services).toBe(1);
    const telnet = (await t.api.get(`${B}/services?q=telnet`)).body[0];
    expect(telnet.state).toBe('closed');
    expect(telnet.version_status).toBe('unknown');
    const hist = (await t.api.get(`${B}/services/${telnet.id}/history`)).body;
    expect(hist.length).toBe(3);
    expect(hist.map((h: any) => h.state)).toContain('open');
    const m = await dash();
    expect(m.open_services.value).toBe(10);
  });

  it('adds older scans to history only and skips down hosts', async () => {
    const r = await t.api.upload(`${B}/scan-imports`, fixture('scan-nmap-older.xml'), 'older.xml', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(201);
    expect(r.body.history_only).toBe(1);
    expect(r.body.warnings.join(' ')).toMatch(/192\.0\.2\.60 was reported down/);
    const assets = (await t.api.get(`${B}/assets`)).body;
    expect(assets.find((a: any) => a.ip === '192.0.2.60')).toBeUndefined();
    const http = (await t.api.get(`${B}/services?q=192.0.2.10`)).body.find((s: any) => s.port === 80);
    expect(http.first_seen < http.last_seen).toBe(true);
  });

  it('opens the original evidence for an import', async () => {
    const imports = (await t.api.get(`${B}/scan-imports`)).body;
    const first = imports.find((i: any) => i.code === 'SCN-001');
    const raw = await t.api.get(`${B}/evidence/${first.evidence_id}/raw`);
    expect(raw.status).toBe(200);
    expect(raw.headers['content-disposition']).toMatch(/attachment/);
    expect(Buffer.from(raw.body).toString('utf8')).toContain('<nmaprun');
    const detail = (await t.api.get(`${B}/scan-imports/${first.id}`)).body;
    expect(detail.observations.length).toBe(11);
  });

  it('imports a real-format nmap self-scan of the sandbox', async () => {
    const t2 = makeTestApp();
    try {
      const r = await t2.api.upload(`${t2.base}/scan-imports`, fixture('scan-nmap-localhost-sV.xml'), 'lo.xml', { source_category: 'authorized_lab' });
      expect(r.status).toBe(201);
      const svcs = (await t2.api.get(`${t2.base}/services`)).body;
      expect(svcs.find((s: any) => s.port === 18022).version_status).toBe('detected');
      expect(svcs.find((s: any) => s.port === 18099).state).toBe('closed');
      const r2 = await t2.api.upload(`${t2.base}/scan-imports`, fixture('scan-nmap-localhost-table.xml'), 'lo2.xml', { source_category: 'authorized_lab' });
      expect(r2.status).toBe(201);
      const s2 = (await t2.api.get(`${t2.base}/services`)).body.find((s: any) => s.port === 18081);
      expect(s2.version_status).toBe('unknown');
    } finally {
      t2.cleanup();
    }
  });

  it('handles malformed XML gracefully and can keep it as raw evidence', async () => {
    const t2 = makeTestApp();
    try {
      const p = await t2.api.upload(`${t2.base}/scan-imports/preview`, fixture('scan-nmap-malformed.xml'), 'bad.xml');
      expect(p.status).toBe(200);
      expect(p.body.parseable).toBe(false);
      expect(p.body.errors[0].message).toMatch(/not well-formed/);
      const r = await t2.api.upload(`${t2.base}/scan-imports`, fixture('scan-nmap-malformed.xml'), 'bad.xml', { source_category: 'authorized_lab' });
      expect(r.status).toBe(400);
      expect((await t2.api.get(`${t2.base}/evidence`)).body.total).toBe(0);
      const raw = await t2.api.upload(`${t2.base}/scan-imports`, fixture('scan-nmap-malformed.xml'), 'bad.xml', { source_category: 'authorized_lab', store_raw: 'true' });
      expect(raw.status).toBe(201);
      expect(raw.body.status).toBe('stored_only');
      expect((await t2.api.get(`${t2.base}/assets`)).body.length).toBe(0);
      const txt = await t2.api.upload(`${t2.base}/scan-imports`, 'Nmap scan report for 192.0.2.10\nPORT STATE SERVICE\n22/tcp open ssh\n', 'out.txt', { source_category: 'authorized_lab', store_raw: 'true' });
      expect(txt.status).toBe(201);
      expect(txt.body.status).toBe('stored_only');
    } finally {
      t2.cleanup();
    }
  });

  it('imports CSV with row errors as a partial import and flags unknown columns', async () => {
    const t2 = makeTestApp();
    try {
      const csv = [
        'host_ip,hostname,port,protocol,state,service,product,version,version_status,observed_at,colour',
        '192.0.2.10,web01,22,tcp,open,ssh,OpenSSH,8.2p1,detected,2026-10-12T14:07:00Z,blue',
        '192.0.2.10,web01,80,tcp,open,http,Apache httpd,2.4.41,,2026-10-12T14:07:00Z,red',
        'not-an-ip,x,22,tcp,open,ssh,,,,,',
        '192.0.2.30,db01,99999,tcp,open,,,,,,',
        '192.0.2.30,db01,3306,tcp,open,mysql,MySQL,,detected,,',
      ].join('\n');
      const p = await t2.api.upload(`${t2.base}/scan-imports/preview`, csv, 'scan.csv');
      expect(p.body.format).toBe('csv');
      expect(p.body.status).toBe('partial');
      expect(p.body.errors.map((e: any) => e.row)).toEqual([4, 5]);
      expect(p.body.warnings.join(' ')).toMatch(/Unknown column\(s\) ignored: colour/);
      expect(p.body.warnings.join(' ')).toMatch(/recorded as inferred/);
      const r = await t2.api.upload(`${t2.base}/scan-imports`, csv, 'scan.csv', { source_category: 'authorized_lab' });
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('partial');
      const svcs = (await t2.api.get(`${t2.base}/services`)).body;
      expect(svcs).toHaveLength(3);
      expect(svcs.find((s: any) => s.port === 80).version_status).toBe('inferred');
      expect(svcs.find((s: any) => s.port === 3306).version_status).toBe('unknown');
      const missing = await t2.api.upload(`${t2.base}/scan-imports/preview`, 'hostname,port\nx,1\n', 'x.csv');
      expect(missing.body.errors[0].message).toMatch(/Missing required column/);
    } finally {
      t2.cleanup();
    }
  });

  it('imports structured JSON and the JSON template', async () => {
    const t2 = makeTestApp();
    try {
      const tpl = (await t2.api.get(`${t2.base}/scan-template.json`)).body;
      const r = await t2.api.upload(`${t2.base}/scan-imports`, JSON.stringify(tpl), 'tpl.json', { source_category: 'authorized_lab' });
      expect(r.status).toBe(201);
      expect(r.body.new_services).toBe(2);
      const bad = await t2.api.upload(`${t2.base}/scan-imports/preview`, '{"hosts": 3}', 'x.json');
      expect(bad.body.parseable).toBe(false);
      const csvTpl = await t2.api.get(`${t2.base}/scan-template.csv`);
      expect(csvTpl.text).toMatch(/^host_ip,hostname,port/);
    } finally {
      t2.cleanup();
    }
  });

  it('warns about excluded and out-of-scope hosts', async () => {
    await t.api.post(`${B}/scope`, { kind: 'in', target: '192.0.2.0/28' });
    await t.api.post(`${B}/scope`, { kind: 'out', target: '192.0.2.10' });
    const p = await t.api.upload(`${B}/scan-imports/preview`, fixture('scan-nmap-demo.xml'), 'x.xml');
    const st = Object.fromEntries(p.body.hosts.map((h: any) => [h.ip, h.scope.status]));
    expect(st['192.0.2.10']).toBe('excluded');
    expect(st['192.0.2.20']).toBe('not_in_scope');
    expect(p.body.duplicate_of.code).toBe('SCN-001');
    expect(p.body.warnings.join(' ')).toMatch(/EXCLUDED/);
  });

  it('edits services and assets with validation, and exports all rows', async () => {
    const svcs = (await t.api.get(`${B}/services?state=open`)).body;
    const s = svcs[0];
    const bad = await t.api.patch(`${B}/services/${s.id}`, { needs_investigation: true });
    expect(bad.status).toBe(400);
    const ok = await t.api.patch(`${B}/services/${s.id}`, { needs_investigation: true, investigation_reason: 'Outdated version', normal_purpose: 'Remote administration' });
    expect(ok.status).toBe(200);
    expect(ok.body.needs_investigation).toBe(1);
    const assets = (await t.api.get(`${B}/assets`)).body;
    const a = await t.api.patch(`${B}/assets/${assets[0].id}`, { criticality: 'high', os_name: 'Ubuntu 20.04 (per instructor)' });
    expect(a.body.os_source).toBe('analyst');
    const det = (await t.api.get(`${B}/assets/${assets[0].id}`)).body;
    expect(det.observations.length).toBeGreaterThan(0);
    expect(det.evidence.length).toBeGreaterThan(0);
    const csv = await t.api.get(`${B}/exports/services.csv`);
    expect(csv.text.trim().split('\n').length).toBe(1 + 11);
    const acsv = await t.api.get(`${B}/exports/assets.csv`);
    expect(acsv.text.trim().split('\n').length).toBe(1 + 5);
    const manual = await t.api.post(`${B}/assets`, { ip: '192.0.2.99', hostname: 'manual01' });
    expect(manual.status).toBe(201);
    expect(manual.body.origin).toBe('manual');
    const dupe = await t.api.post(`${B}/assets`, { ip: '192.0.2.99' });
    expect(dupe.status).toBe(400);
  });

  it('labels demo engagement scan evidence as demo data', async () => {
    const t2 = makeTestApp();
    try {
      const id = t2.ctx.db.scalar<string>('SELECT id FROM engagements LIMIT 1');
      t2.ctx.db.run('UPDATE engagements SET is_demo = 1 WHERE id = ?', id);
      t2.ctx.db.run("INSERT INTO engagements (id,name,client_name,created_at,updated_at) VALUES ('real','Real','C','x','x')");
      const r = await t2.api.upload(`/api/engagements/${id}/scan-imports`, fixture('scan-nmap-demo.xml'), 'd.xml', { source_category: 'authorized_lab' });
      expect(r.status).toBe(201);
      expect(r.body.evidence_code).toBe('DEMO-EV-001');
      const ev = (await t2.api.get(`/api/engagements/${id}/evidence/${r.body.evidence_id}`)).body;
      expect(ev.source_category).toBe('demo');
    } finally {
      t2.cleanup();
    }
  });
});
