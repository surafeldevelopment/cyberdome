import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeTestApp, fixture } from './helpers';
import { lookupTechnique, getAttackTechniques } from '../server/services/refs';

// Local stand-in for NVD / KEV / ATT&CK endpoints. Tests never touch the network.
// Every payload served here is a SYNTHETIC fixture.
let server: http.Server;
let base = '';
let mode: 'ok' | 'ratelimit' | 'down' = 'ok';
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    if (mode === 'ratelimit') {
      res.writeHead(429, { 'Retry-After': '30' });
      return res.end('slow down');
    }
    if (mode === 'down') {
      res.writeHead(503);
      return res.end();
    }
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/nvd') {
      const id = u.searchParams.get('cveId');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (id === 'CVE-2021-41617') return res.end(fixture('ref-nvd-cve.json'));
      return res.end(JSON.stringify({ resultsPerPage: 0, startIndex: 0, totalResults: 0, vulnerabilities: [] }));
    }
    if (u.pathname === '/kev') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(fixture('ref-kev.json'));
    }
    if (u.pathname === '/attack') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(fixture('ref-attack-mini.json'));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  t?.cleanup();
  off?.cleanup();
  dead?.cleanup();
});

let t: ReturnType<typeof makeTestApp>;
let off: ReturnType<typeof makeTestApp>;
let dead: ReturnType<typeof makeTestApp>;

describe('NVD CVE lookups', () => {
  it('fetches, parses and caches a CVE; second call is served from cache', async () => {
    t = makeTestApp({ referencesOnline: true, nvdApiKey: 'test-key', refs: { nvdBase: `${base}/nvd`, kevUrl: `${base}/kev`, attackUrl: `${base}/attack` } } as any);
    const r = await t.api.get('/api/references/cve/CVE-2021-41617');
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('ok');
    expect(r.body.cached).toBe(false);
    expect(r.body.origin).toBe('fetched');
    expect(r.body.url).toBe('https://nvd.nist.gov/vuln/detail/CVE-2021-41617');
    expect(r.body.data.metrics[0]).toMatchObject({ version: '3.1', base_score: 7.0, type: 'Primary' });
    expect(r.body.data.cwes).toEqual(['CWE-273']);
    expect(r.body.disclaimer).toMatch(/does not prove/);
    const n = hits.length;
    const again = await t.api.get('/api/references/cve/CVE-2021-41617');
    expect(again.body.cached).toBe(true);
    expect(hits.length).toBe(n);
  });

  it('records not-found results', async () => {
    const r = await t.api.get('/api/references/cve/CVE-2099-0001');
    expect(r.body.state).toBe('not_found');
  });

  it('reports rate limiting truthfully and keeps cached data on refresh failure', async () => {
    mode = 'ratelimit';
    const fresh = await t.api.get('/api/references/cve/CVE-2020-0002');
    expect(fresh.status).toBe(200);
    expect(fresh.body.state).toBe('rate_limited');
    expect(fresh.body.message).toMatch(/rate limit/);
    const refresh = await t.api.get('/api/references/cve/CVE-2021-41617?refresh=1');
    expect(refresh.body.state).toBe('ok');
    expect(refresh.body.cached).toBe(true);
    expect(refresh.body.refresh_error).toMatch(/429/);
    mode = 'down';
    const down = await t.api.get('/api/references/cve/CVE-2020-0003');
    expect(down.body.state).toBe('unavailable');
    mode = 'ok';
  });

  it('validates CVE identifiers and supports cached-only queries', async () => {
    expect((await t.api.get('/api/references/cve/not-a-cve')).status).toBe(400);
    const c = await t.api.get('/api/references/cve/CVE-2022-1111?cached_only=1');
    expect(c.body.state).toBe('not_loaded');
  });
});

describe('KEV and ATT&CK', () => {
  it('reports KEV as not loaded, then refreshes and looks up entries', async () => {
    expect((await t.api.get('/api/references/kev/CVE-2021-41773')).body.state).toBe('not_loaded');
    const r = await t.api.post('/api/references/kev/refresh');
    expect(r.body.state).toBe('ok');
    expect(r.body.catalogVersion).toBe('2026.10.01-synthetic');
    const hit = await t.api.get('/api/references/kev/CVE-2021-41773');
    expect(hit.body.in_kev).toBe(true);
    const miss = await t.api.get('/api/references/kev/CVE-2021-41617');
    expect(miss.body.in_kev).toBe(false);
    expect(miss.body.message).toMatch(/Not in KEV catalog version 2026\.10\.01-synthetic/);
    const cve = await t.api.get('/api/references/cve/CVE-2021-41617');
    expect(cve.body.kev.in_kev).toBe(false);
  });

  it('loads ATT&CK techniques, excludes deprecated ones, and exposes lookup helpers', async () => {
    const r = await t.api.post('/api/references/attack/refresh');
    expect(r.body.state).toBe('ok');
    expect(r.body.count).toBe(3);
    expect(lookupTechnique(t.ctx.db, 't1110.001')?.name).toBe('Password Guessing');
    expect(lookupTechnique(t.ctx.db, 'T9999')).toBeNull();
    expect(getAttackTechniques(t.ctx.db)?.version).toBe('test-1.0');
    const s = await t.api.get('/api/references/attack/techniques?q=brute');
    expect(s.body.techniques.map((x: any) => x.id)).toEqual(['T1110']);
    const one = await t.api.get('/api/references/attack/technique/T1046');
    expect(one.body.technique.tactics).toEqual(['discovery']);
    expect(one.body.technique.description).not.toMatch(/Citation/);
    expect((await t.api.get('/api/references/attack/technique/T9999')).body.state).toBe('not_found');
  });

  it('summarizes status', async () => {
    const s = await t.api.get('/api/references/status');
    expect(s.body.kev.state).toBe('ok');
    expect(s.body.attack.count).toBe(3);
    expect(s.body.nvd.cached_records).toBe(1);
    expect(s.body.virustotal.state).toBe('not_implemented');
  });
});

describe('offline and disconnected modes', () => {
  it('returns a disabled state when online lookups are off, and supports labeled imports', async () => {
    off = makeTestApp({ referencesOnline: false } as any);
    const r = await off.api.get('/api/references/cve/CVE-2021-41617');
    expect(r.body.state).toBe('disabled');
    expect((await off.api.post('/api/references/kev/refresh')).body.state).toBe('disabled');
    const imp = await off.api.upload('/api/references/import', fixture('ref-nvd-cve.json'), 'nvd.json');
    expect(imp.status).toBe(201);
    expect(imp.body.kind).toBe('nvd');
    const after = await off.api.get('/api/references/cve/CVE-2021-41617');
    expect(after.body.state).toBe('ok');
    expect(after.body.origin).toBe('imported');
    expect((await off.api.upload('/api/references/import', fixture('ref-kev.json'), 'kev.json')).body.kind).toBe('kev');
    expect((await off.api.upload('/api/references/import', fixture('ref-attack-mini.json'), 'attack.json')).body.kind).toBe('attack');
    expect((await off.api.upload('/api/references/import', Buffer.from('{"hello":1}'), 'x.json')).status).toBe(400);
    expect((await off.api.upload('/api/references/import', Buffer.from('not json'), 'x.json')).status).toBe(400);
  });

  it('reports an unreachable service (connection refused) without a 500', async () => {
    dead = makeTestApp({ referencesOnline: true, refs: { nvdBase: 'http://127.0.0.1:9/nvd', kevUrl: 'http://127.0.0.1:9/kev', attackUrl: 'http://127.0.0.1:9/attack' } } as any);
    const r = await dead.api.get('/api/references/cve/CVE-2021-41617');
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('unavailable');
    const k = await dead.api.post('/api/references/kev/refresh');
    expect(k.body.state).toBe('unavailable');
    expect(k.body.attempts).toHaveLength(1);
    const a = await dead.api.post('/api/references/attack/refresh');
    expect(a.body.state).toBe('unavailable');
  });
});
