import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { Ctx } from '../app.js';
import { createEngagement } from './bootstrap.js';
import { logActivity } from '../lib/activity.js';
import { tsharkInfo } from '../routes/system.js';

export const DEMO_NAME = 'CyberDome Synthetic Lab (Demo)';

/**
 * Builds the isolated demo engagement from the clearly labeled synthetic files in
 * samples/demo/. It drives the app's own HTTP API on an ephemeral loopback port, so the demo
 * goes through exactly the same import, validation, hashing, and linking code as real data.
 * No AI output is fabricated: the demo contains no AI sessions.
 */
export async function seedDemo(ctx: Ctx, app: Express): Promise<{ engagement_id: string; steps: string[] }> {
  const { db } = ctx;
  const existing = db.get('SELECT id FROM engagements WHERE is_demo = 1');
  if (existing) return { engagement_id: existing.id, steps: ['Demo engagement already exists.'] };

  const samples = path.resolve(process.env.CYBERDOME_SAMPLES_DIR || path.join(process.cwd(), 'samples'), 'demo');
  if (!fs.existsSync(samples)) throw new Error('samples/demo folder is missing; the demo dataset cannot be loaded.');
  const file = (n: string) => fs.readFileSync(path.join(samples, n));

  const eid = createEngagement(db, { name: DEMO_NAME, client_name: 'CyberDome Corporation (demo)', is_demo: true });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api/engagements/${eid}`;
  const steps: string[] = [];

  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(url.startsWith('http') ? url : base + url, {
      method,
      headers: body instanceof FormData ? { 'X-CyberDome': '1' } : { 'Content-Type': 'application/json', 'X-CyberDome': '1' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${json?.error ?? 'error'}`);
    return json;
  };
  const upload = (url: string, name: string, fields: Record<string, string> = {}) => {
    const f = new FormData();
    f.append('file', new Blob([file(name)]), name);
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return call('POST', url, f);
  };

  try {
    // 1. Engagement scope (synthetic, clearly labeled)
    await call('PATCH', '', {
      purpose: 'DEMO ONLY: shows how CyberDome organizes an assessment. All hosts use RFC 5737 documentation addresses and the reserved cyberdome.example domain.',
      authorization_ref: 'DEMO-AUTH-0000 (synthetic placeholder, not a real authorization)',
      window_start: '2026-10-05T13:00:00.000Z',
      window_end: '2026-10-16T21:00:00.000Z',
      timezone: 'America/New_York',
      rules_of_engagement: 'Demo: synthetic data only. Mirrors the NWIT 246 packet rules.',
      prohibited_actions: 'Denial-of-service testing\nDestructive testing\nPersistence\nCredential theft\nData exfiltration',
      approved_evidence_sources: 'Synthetic sample files in samples/demo/',
      status: 'active',
    });
    await call('POST', '/scope', { kind: 'in', target: '192.0.2.0/24', notes: 'Demo lab network (RFC 5737 documentation range)', confirmed: true });
    await call('POST', '/scope', { kind: 'in', target: 'cyberdome.example', notes: 'Demo domain (reserved example domain)', confirmed: true });
    await call('POST', '/scope', { kind: 'out', target: '192.0.2.1', notes: 'Demo gateway (excluded)', confirmed: true });
    await call('POST', '/authorization', { confirmed: true, confirmed_by: 'Demo instructor (synthetic)' });
    for (const [name, role, resp] of [
      ['Demo Analyst A', 'Recon Lead', 'Recon and OSINT records'],
      ['Demo Analyst B', 'Network Assessment Lead', 'Scanning and enumeration'],
      ['Demo Analyst C', 'Vulnerability Lead', 'Findings and prioritization'],
      ['Demo Analyst D', 'AI/Reporting Lead', 'AI review and report'],
    ])
      await call('POST', '/team', { name, role, responsibilities: resp });
    steps.push('Scope, authorization placeholder and demo team created');

    const meta = { source_category: 'demo', sanitization_status: 'no_sensitive_data' };

    // 2. Lab 1 host evidence + indicators
    const lab1Files: Record<string, string> = {
      'Unexpected local administrator account': 'lab1-net-localgroup-ws01.txt',
      'Listening port 4444 on ws01': 'lab1-netstat-ws01.txt',
      'Scheduled task running from a temp folder': 'lab1-schtasks-ws01.txt',
      'Cleared Security event log': 'lab1-eventlog-cleared-ws01.txt',
      'Hosts file entry for update domain': 'lab1-hosts-file-ws01.txt',
    };
    const lab1Ev: Record<string, string> = {};
    for (const [title, fname] of Object.entries(lab1Files)) {
      const ev = await upload('/evidence', fname, {
        ...meta, title: `ws01 command output: ${title}`, source_tool: 'Windows CMD (synthetic)', collected_at: '2026-10-08T13:30:00.000Z',
        observation: `Synthetic command output used for the “${title}” indicator.`, confidence: 'medium', tags: 'lab1,host',
      });
      lab1Ev[title] = ev.id;
    }

    // 3. Recon
    const recon = await upload('/recon-imports', 'recon-demo.json', { source_category: 'demo' });
    steps.push(`Recon import: ${recon.created ?? recon.created_count ?? 'ok'}`);

    // 4. Scans (initial + later rescan to show history without inflating totals)
    await upload('/scan-imports', 'scan-nmap-demo.xml', { source_category: 'demo', collected_at: '2026-10-07T14:00:00.000Z' });
    await upload('/scan-imports', 'scan-nmap-demo-rescan.xml', { source_category: 'demo' });
    steps.push('Two Nmap XML scans imported');

    // 5. Vulnerability reports
    await upload('/finding-imports', 'findings-demo.nessus', { source_category: 'demo' });
    await upload('/finding-imports', 'findings-demo-greenbone.xml', { source_category: 'demo' });
    steps.push('Nessus and Greenbone demo reports imported');

    // 6. Logs + PCAP
    const logImp = await upload('/log-imports', 'log-auth-demo.csv', { source_category: 'demo', source_timezone: 'America/New_York' });
    const pcap = await upload('/evidence', 'pcap-demo.pcap', {
      ...meta, title: 'Synthetic SYN scan capture', source_tool: 'Synthetic PCAP generator', collected_at: '2026-10-08T14:03:00.000Z', tags: 'lab5,pcap',
      observation: 'Synthetic capture of SYN packets from 198.51.100.77 to web01.',
    });
    if (tsharkInfo(ctx).path) {
      try {
        await call('POST', `/evidence/${pcap.id}/tshark-process`, {});
        steps.push('PCAP processed locally with tshark');
      } catch (e: any) {
        steps.push(`tshark processing skipped: ${e.message}`);
      }
    } else steps.push('tshark not installed: PCAP stored with header metadata only');

    // 7. Indicators (lab1 linked to host outputs; lab5 linked to the log import evidence)
    const logEvidenceId = logImp.evidence_id ?? logImp.import?.evidence_id ?? db.scalar<string>('SELECT evidence_id FROM log_imports WHERE engagement_id = ? ORDER BY created_at LIMIT 1', eid);
    const ind = JSON.parse(file('indicators-demo.json').toString('utf8')).indicators as any[];
    for (const i of ind) {
      const evidence_ids = i.lab === 'lab1' ? [lab1Ev[i.title]].filter(Boolean) : [logEvidenceId, pcap.id].filter(Boolean);
      await call('POST', '/indicators', { ...i, evidence_ids });
    }
    const extra = [
      { lab: 'lab5', title: 'SYN packets to six ports within one second', indicator_type: 'network', value: '198.51.100.77', source_host: '198.51.100.77', dest_host: '192.0.2.10', observed_at: '2026-10-08T10:03:00-04:00', observation: 'SYNTHETIC: capture shows SYNs to 21, 22, 23, 80, 443 and 3306 from one source.', why_suspicious: 'Pattern consistent with port scanning.', benign_explanations: 'An authorized vulnerability scan by the lab team.', additional_evidence_needed: 'Confirm no authorized scan was scheduled at this time.', confidence: 'medium', assessment: 'requires_more_evidence', analyst_assessment: 'Possible reconnaissance (demo).' },
      { lab: 'lab5', title: 'Successful SSH login after repeated failures', indicator_type: 'log', value: 'deploy', source_host: '198.51.100.77', dest_host: '192.0.2.10', observed_at: '2026-10-08T10:14:40-04:00', observation: 'SYNTHETIC: success for user deploy follows the failed attempts from the same source.', why_suspicious: 'Success after guessing may indicate a compromised credential.', benign_explanations: 'The legitimate owner may have mistyped the password several times.', additional_evidence_needed: 'Confirm with the account owner and review session activity.', confidence: 'medium', assessment: 'suspicious', analyst_assessment: 'Possible account compromise (demo).' },
      { lab: 'lab5', title: 'Outbound connection from web01 to 203.0.113.25', indicator_type: 'network', value: '203.0.113.25:443', source_host: '192.0.2.10', dest_host: '203.0.113.25', observed_at: '2026-10-08T10:25:00-04:00', observation: 'SYNTHETIC: web01 opened an outbound TLS connection shortly after the login.', why_suspicious: 'Unexpected outbound traffic after a suspicious login.', benign_explanations: 'Package update check or monitoring agent.', additional_evidence_needed: 'Process/log correlation on web01 for the connection.', confidence: 'low', assessment: 'requires_more_evidence', analyst_assessment: 'Requires process correlation (demo).' },
    ];
    for (const i of extra) await call('POST', '/indicators', { ...i, evidence_ids: [logEvidenceId].filter(Boolean) });
    steps.push(`${ind.length + extra.length} indicators created`);

    // 8. Timeline from imported log rows (keeps original timestamps), plus the manual unplaced example
    const events = await call('GET', `/log-events?limit=50&import=${logImp.id}`);
    for (const ev of (events.items ?? []).filter((e: any) => e.normalized_ts).slice(0, 8)) {
      const tl = await call('POST', `/timeline/from-log-event/${ev.id}`, {});
      const id = tl.id ?? tl.event?.id;
      const interp: Record<string, string> = {
        connection_attempt: 'Possible reconnaissance / port scanning (demo interpretation).',
        auth_failure: 'Possible password guessing; verify context (demo interpretation).',
        auth_success: 'Possible account compromise following guessing; requires correlation (demo interpretation).',
        outbound_connection: 'Unexpected outbound connection; requires process/log correlation (demo interpretation).',
      };
      if (id) await call('PATCH', `/timeline/${id}`, { student_interpretation: interp[ev.event_type] ?? 'Requires additional evidence (demo interpretation).', confidence: 'medium' });
    }
    const tlManual = JSON.parse(file('timeline-demo.json').toString('utf8')).events as any[];
    for (const t of tlManual.filter((e) => e.time_certainty === 'unknown')) await call('POST', '/timeline', { ...t, evidence_ids: [logEvidenceId].filter(Boolean) });
    steps.push('Timeline built from imported log rows');

    // 9. Service analysis notes
    const services = await call('GET', '/services?state=open');
    const purposes: Record<string, string> = {
      ssh: 'Encrypted remote administration (demo note).',
      http: 'Web content delivery (demo note).',
      https: 'TLS-protected web content (demo note).',
      mysql: 'Database service for applications (demo note).',
      'microsoft-ds': 'Windows file sharing / SMB (demo note).',
      'ms-wbt-server': 'Remote Desktop administration (demo note).',
      ftp: 'File transfer (demo note).',
    };
    for (const s of services) {
      const p = purposes[s.service_name];
      if (p) await call('PATCH', `/services/${s.id}`, { normal_purpose: p });
      if (s.service_name === 'mysql')
        await call('PATCH', `/services/${s.id}`, { needs_investigation: true, investigation_reason: 'Database port reachable from the lab network; confirm whether app-only access is intended (demo).' });
    }

    // 10. Priorities + one validated finding (validated against linked synthetic scan evidence)
    const findings = (await call('GET', '/findings')).items as any[];
    const pick = (re: RegExp) => findings.find((f) => re.test(f.title));
    const chosen = [pick(/MySQL/i), pick(/Telnet|FTP/i), pick(/Apache/i)].filter(Boolean);
    if (chosen.length) {
      await call('PUT', '/priorities', {
        items: chosen.slice(0, 3).map((f, i) => ({
          finding_id: f.id, rank: i + 1,
          rationale: [
            'Demo rationale: database directly reachable on the lab network, high impact if credentials are weak; remediation is a simple firewall rule.',
            'Demo rationale: cleartext login protocol exposes credentials to anyone on the segment; disabling it is low effort.',
            'Demo rationale: outdated web server version reported by scanner; needs version confirmation before patch planning.',
          ][i],
        })),
      });
      const v = chosen[0];
      const detail = await call('GET', `/findings/${v.id}`);
      const scanEv = db.get("SELECT e.id FROM evidence e JOIN scan_imports s ON s.evidence_id = e.id WHERE e.engagement_id = ? ORDER BY s.created_at LIMIT 1", eid)?.id;
      const evIds = [...new Set([...(detail.evidence ?? []).map((e: any) => e.id), scanEv].filter(Boolean))];
      await call('PATCH', `/findings/${v.id}`, {
        evidence_ids: evIds,
        validation_status: 'validated',
        validation_notes: 'Demo validation: the Nmap scan evidence independently shows tcp/3306 open with MySQL 5.7.33 on db01, matching the scanner report.',
        owner: 'Demo Analyst C',
        impact: detail.impact || 'Demo: unauthorized database access could expose application data.',
        remediation: detail.remediation || 'Demo: restrict 3306 to the application server with a host firewall rule.',
      });
    }
    steps.push('Top-three priorities set; one finding validated with scan evidence');

    // 11. Report narrative (manual demo text, labeled; no AI text is fabricated)
    await call('PUT', '/report', {
      narrative: {
        methodology: 'DEMO TEXT: Imported synthetic Nmap XML scans, synthetic Nessus/Greenbone reports, synthetic authentication logs and a synthetic packet capture; correlated records by host and Evidence ID.',
        limitations: 'DEMO TEXT: All data is synthetic. No real systems were assessed. No AI analysis is included in the demo.',
      },
    }).catch(() => undefined);

    // All demo artifacts are synthetic, so mark any not-yet-reviewed ones as containing no sensitive data.
    const pending = db.all("SELECT id FROM evidence WHERE engagement_id = ? AND sanitization_status = 'not_reviewed'", eid);
    for (const p of pending) await call('PATCH', `/evidence/${p.id}`, { sanitization_status: 'no_sensitive_data' });

    logActivity(db, eid, 'demo.loaded', 'engagement', 'Loaded the synthetic demo engagement from samples/demo');
    return { engagement_id: eid, steps };
  } catch (e) {
    // Do not leave a half-built demo behind.
    db.run('DELETE FROM engagements WHERE id = ?', eid);
    throw e;
  } finally {
    server.close();
  }
}
