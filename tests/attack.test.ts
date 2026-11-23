import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { makeTestApp, fixture } from './helpers';
import { parseLogs } from '../server/importers/logs';

// All data in this suite is SYNTHETIC (RFC 5737 documentation addresses, fictional hosts).
const t = makeTestApp();
afterAll(() => t.cleanup());

const hasTshark = (() => {
  try {
    execFileSync('tshark', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('log parsing', () => {
  it('keeps originals, converts explicit offsets, and never invents a missing time', () => {
    const p = parseLogs(fixture('log-auth.csv').toString(), { filename: 'a.csv', sourceTz: 'America/New_York' });
    expect(p.format).toBe('csv');
    expect(p.rows).toHaveLength(9);
    const first = p.rows[0];
    expect(first.original_timestamp).toBe('2026-10-08T10:03:00-04:00');
    expect(first.normalized_ts).toBe('2026-10-08T14:03:00.000Z');
    expect(first.ts_status).toBe('explicit_offset');
    const missing = p.rows.find((r) => r.ts_status === 'missing')!;
    expect(missing.normalized_ts).toBeNull();
    expect(p.warnings.join(' ')).toMatch(/no timestamp/);
  });

  it('labels times without an offset as assumed timezone and refuses year-less syslog times', () => {
    const p = parseLogs(fixture('log-auth.jsonl').toString(), { filename: 'a.jsonl', sourceTz: 'America/New_York' });
    expect(p.format).toBe('jsonl');
    expect(p.errors).toHaveLength(1); // the "not json" line
    expect(p.rows[0].ts_status).toBe('assumed_timezone');
    expect(p.rows[0].normalized_ts).toBe('2026-10-08T14:12:04.000Z');
    expect(p.rows[2].ts_status).toBe('unparseable');
    expect(p.rows[2].normalized_ts).toBeNull();
    expect(p.warnings.join(' ')).toMatch(/weird_field/);
  });

  it('detects Wireshark relative times and does not place them on the clock', () => {
    const p = parseLogs(fixture('log-wireshark-relative.csv').toString(), { filename: 'w.csv' });
    expect(p.format).toBe('wireshark_csv');
    expect(p.rows.every((r) => r.normalized_ts === null && r.ts_status === 'unparseable')).toBe(true);
    expect(p.warnings.join(' ')).toMatch(/relative/i);
  });

  it('reports bad ports and empty rows', () => {
    const p = parseLogs(fixture('log-malformed.csv').toString(), { filename: 'm.csv' });
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].src_port).toBeNull();
    expect(p.rows[0].dst_port).toBeNull();
    expect(p.skipped).toBe(1);
  });
});

describe('Attack Evidence API (Lab 5)', () => {
  let importId = '';
  let eventId = '';

  it('imports a log file, stores it as evidence, and reports partial status', async () => {
    const r = await t.api.upload(`${t.base}/log-imports`, fixture('log-auth.csv'), 'auth.csv', { source_category: 'instructor_supplied', source_timezone: 'America/New_York' });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('LOG-001');
    expect(r.body.rows_imported).toBe(9);
    expect(r.body.evidence_code).toBe('EV-001');
    expect(r.body.analysis_scope).toMatch(/stored verbatim/);
    importId = r.body.id;
  });

  it('blocks accidental duplicate re-import of the same file', async () => {
    const r = await t.api.upload(`${t.base}/log-imports`, fixture('log-auth.csv'), 'auth.csv', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(409);
    expect((await t.api.get(`${t.base}/log-events`)).body.total).toBe(9);
  });

  it('rejects files with no usable records', async () => {
    const r = await t.api.upload(`${t.base}/log-imports`, 'a,b\n,\n', 'empty.csv', { source_category: 'instructor_supplied' });
    expect(r.status).toBe(400);
  });

  it('filters log events and sorts unknown times last', async () => {
    const all = await t.api.get(`${t.base}/log-events`);
    expect(all.body.items.at(-1).ts_status).toBe('missing');
    const f = await t.api.get(`${t.base}/log-events?event_type=auth_failure`);
    expect(f.body.total).toBe(4);
    const host = await t.api.get(`${t.base}/log-events?host=203.0.113.25`);
    expect(host.body.total).toBe(1);
    eventId = f.body.items[0].id;
    const flag = await t.api.patch(`${t.base}/log-events/${eventId}`, { flagged: true });
    expect(flag.body.flagged).toBe(true);
    expect((await t.api.get(`${t.base}/log-events?flagged=1`)).body.total).toBe(1);
  });

  it('promotes a log event to the timeline with evidence and original time', async () => {
    const r = await t.api.post(`${t.base}/timeline/from-log-event/${eventId}`);
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('TL-001');
    expect(r.body.original_timestamp).toBe('2026-10-08T10:12:04-04:00');
    expect(r.body.normalized_ts).toBe('2026-10-08T14:12:04.000Z');
    expect(r.body.verification_status).toBe('requires_more_evidence');
    expect(r.body.student_interpretation).toBe('');
    expect(r.body.evidence[0].code).toBe('EV-001');
    expect((await t.api.post(`${t.base}/timeline/from-log-event/${eventId}`)).status).toBe(409);
  });

  it('keeps manual events without a time unplaced and orders placed events chronologically', async () => {
    const a = await t.api.post(`${t.base}/timeline`, { observation: 'SYNTHETIC: earlier event', original_timestamp: '2026-10-08T10:03:00-04:00', evidence_ids: ['EV-001'] });
    expect(a.body.normalized_ts).toBe('2026-10-08T14:03:00.000Z');
    const b = await t.api.post(`${t.base}/timeline`, { observation: 'SYNTHETIC: unknown time', sequence_hint: 3, order_certainty: 'uncertain' });
    expect(b.body.normalized_ts).toBeNull();
    expect(b.body.time_certainty).toBe('unknown');
    const c = await t.api.post(`${t.base}/timeline`, { observation: 'SYNTHETIC: no-offset time', original_timestamp: '2026-10-08 10:30:00', source_timezone: 'America/New_York' });
    expect(c.body.timezone_note).toMatch(/interpreted as America\/New_York/);
    const tl = (await t.api.get(`${t.base}/timeline`)).body;
    expect(tl.map((x: any) => x.observation.slice(0, 22))).toEqual([
      'SYNTHETIC: earlier eve',
      expect.any(String),
      'SYNTHETIC: no-offset t',
      'SYNTHETIC: unknown tim',
    ]);
    const patched = await t.api.patch(`${t.base}/timeline/${tl[1].id}`, { student_interpretation: 'Possible password guessing; verify context.', verification_status: 'fact' });
    expect(patched.body.student_interpretation).toMatch(/password/);
    const csv = await t.api.get(`${t.base}/exports/timeline.csv`);
    expect(csv.text).toMatch(/TL-001/);
  });

  it('creates Lab 1 and Lab 5 indicators separately with evidence', async () => {
    const one = await t.api.post(`${t.base}/indicators`, {
      lab: 'lab1', title: 'SYNTHETIC unexpected admin account', observation: 'net localgroup output lists svc_x', why_suspicious: 'Unknown privileged account',
      additional_evidence_needed: 'Creation event', assessment: 'requires_more_evidence', evidence_ids: ['EV-001'],
    });
    expect(one.status).toBe(201);
    expect(one.body.code).toBe('IOC-001');
    const five = await t.api.post(`${t.base}/indicators`, { lab: 'lab5', title: 'SYNTHETIC auth failures', observed_at: '2026-10-08T10:12:04-04:00' });
    expect(five.body.observed_at).toBe('2026-10-08T14:12:04.000Z');
    expect((await t.api.get(`${t.base}/indicators?lab=lab1`)).body).toHaveLength(1);
    expect((await t.api.get(`${t.base}/indicators?lab=lab5`)).body).toHaveLength(1);
    expect((await t.api.post(`${t.base}/indicators`, { lab: 'lab9', title: 'x' })).status).toBe(400);
    const labs = (await t.api.get(`${t.base}/tracker`)).body.labs;
    expect(labs.find((l: any) => l.lab === 'lab1').requirements.find((r: any) => r.id === 'lab1_indicators').detail).toBe('1 of 5 complete');
  });

  it('records ATT&CK mappings as proposals and requires rationale to verify', async () => {
    const tl = (await t.api.get(`${t.base}/timeline`)).body[0];
    const bad = await t.api.post(`${t.base}/attack-mappings`, { target_type: 'timeline', target_id: tl.id, technique_id: 'X1110' });
    expect(bad.status).toBe(400);
    const m = await t.api.post(`${t.base}/attack-mappings`, { target_type: 'timeline', target_id: tl.id, technique_id: 't1110.001', technique_name: 'Password Guessing' });
    expect(m.status).toBe(201);
    expect(m.body.technique_id).toBe('T1110.001');
    expect(m.body.status).toBe('proposed');
    expect((await t.api.patch(`${t.base}/attack-mappings/${m.body.id}`, { status: 'verified' })).status).toBe(400);
    const v = await t.api.patch(`${t.base}/attack-mappings/${m.body.id}`, { status: 'verified', rationale: 'Four failed SSH logins from one source in 18s (EV-001).' });
    expect(v.body.status).toBe('verified');
    expect(v.body.reviewed_by).toBeTruthy();
    expect((await t.api.post(`${t.base}/attack-mappings`, { target_type: 'timeline', target_id: tl.id, technique_id: 'T1110.001' })).status).toBe(409);
  });

  it('exports log events and indicators as CSV (all rows)', async () => {
    const csv = await t.api.get(`${t.base}/exports/log-events.csv`);
    expect(csv.text.trim().split('\n').length).toBe(10);
    const ind = await t.api.get(`${t.base}/exports/indicators.csv`);
    expect(ind.text).toMatch(/IOC-001/);
  });

  it.skipIf(!hasTshark)('processes a stored synthetic PCAP with tshark into a separately hashed derived import', async () => {
    const up = await t.api.upload(`${t.base}/evidence`, fixture('pcap-syn-scan.pcap'), 'scan.pcap', { source_category: 'instructor_supplied' });
    expect(up.body.detected_type).toBe('pcap');
    expect(up.body.analysis_status).toBe('metadata_read');
    const r = await t.api.post(`${t.base}/evidence/${up.body.id}/tshark-process`, {});
    expect(r.status).toBe(201);
    expect(r.body.format).toBe('tshark_processed');
    expect(r.body.rows_imported).toBe(10);
    expect(r.body.analysis_scope).toMatch(/Payloads were not analyzed/);
    const derived = (await t.api.get(`${t.base}/evidence/${r.body.derived_evidence.id}`)).body;
    expect(derived.derived_from.code).toBe(up.body.code);
    expect(derived.sha256).not.toBe(up.body.sha256);
    const src = (await t.api.get(`${t.base}/evidence/${up.body.id}`)).body;
    expect(src.analysis_status).toBe('tshark_processed');
    const ev = await t.api.get(`${t.base}/log-events?import=${r.body.id}&port=3306`);
    expect(ev.body.total).toBe(1);
    expect(ev.body.items[0].normalized_ts).toBe('2026-10-08T14:03:01.000Z');
    const list = (await t.api.get(`${t.base}/pcap-evidence`)).body;
    expect(list.captures[0].processed_imports).toHaveLength(1);
  });

  it('refuses tshark processing for non-PCAP evidence', async () => {
    const r = await t.api.post(`${t.base}/evidence/${(await t.api.get(`${t.base}/evidence`)).body.items.at(-1).id}/tshark-process`, {});
    expect(r.status).toBe(400);
  });

  it('import detail shows timestamp summary and warnings', async () => {
    const d = await t.api.get(`${t.base}/log-imports/${importId}`);
    expect(d.body.ts_summary.missing).toBe(1);
    expect(d.body.ts_summary.explicit_offset).toBe(8);
    expect(d.body.warnings.length).toBeGreaterThan(0);
  });
});
