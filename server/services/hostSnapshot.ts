import { execFile } from 'node:child_process';
import os from 'node:os';
import type { Ctx } from '../app.js';
import type { Row } from '../db/index.js';
import { badRequest } from '../lib/http.js';
import { logActivity } from '../lib/activity.js';
import { storeFileEvidence } from './evidence.js';

/**
 * Read-only snapshot of the computer CyberDome runs on (Lab 1 signs-of-compromise review,
 * Lab 5 host context). Fixed commands only, no shell, no user-supplied arguments, nothing
 * sent anywhere. The output is stored as an evidence file marked "not reviewed", so the AI
 * analyst cannot receive it until a person reviews and sanitizes it.
 */
interface Cmd {
  title: string;
  why: string;
  bin: string;
  args: string[];
}

export function snapshotCommands(platform = process.platform): Cmd[] {
  if (platform === 'win32')
    return [
      { title: 'Network connections and listening ports', why: 'Unexpected listeners or outbound connections', bin: 'netstat', args: ['-ano'] },
      { title: 'Running processes and their services', why: 'Unfamiliar processes; map PIDs from netstat', bin: 'tasklist', args: ['/svc', '/fo', 'csv'] },
      { title: 'Local user accounts', why: 'Accounts nobody recognizes', bin: 'net', args: ['user'] },
      { title: 'Local Administrators group', why: 'Unexpected administrators', bin: 'net', args: ['localgroup', 'administrators'] },
      { title: 'Scheduled tasks', why: 'Persistence through scheduled tasks', bin: 'schtasks', args: ['/query', '/fo', 'csv'] },
      { title: 'Network configuration', why: 'DNS servers, gateways, adapters', bin: 'ipconfig', args: ['/all'] },
    ];
  if (platform === 'darwin')
    return [
      { title: 'Listening ports and connections', why: 'Unexpected listeners or outbound connections', bin: 'netstat', args: ['-anv', '-p', 'tcp'] },
      { title: 'Running processes', why: 'Unfamiliar processes', bin: 'ps', args: ['-axo', 'pid,ppid,user,lstart,comm'] },
      { title: 'Logged-in users', why: 'Sessions nobody recognizes', bin: 'who', args: [] },
      { title: 'Network configuration', why: 'Interfaces and addresses', bin: 'ifconfig', args: [] },
    ];
  return [
    { title: 'Listening ports and connections', why: 'Unexpected listeners or outbound connections', bin: 'ss', args: ['-tunap'] },
    { title: 'Running processes', why: 'Unfamiliar processes', bin: 'ps', args: ['-eo', 'pid,ppid,user,lstart,comm'] },
    { title: 'Logged-in users', why: 'Sessions nobody recognizes', bin: 'who', args: [] },
    { title: 'Network configuration', why: 'Interfaces and addresses', bin: 'ip', args: ['addr'] },
  ];
}

function run(c: Cmd): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(c.bin, c.args, { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && !stdout) resolve({ ok: false, out: `Command failed: ${String(stderr || err.message).trim().slice(0, 400)}` });
      else resolve({ ok: true, out: String(stdout).replace(/\r\n/g, '\n').trimEnd() });
    });
  });
}

export async function takeHostSnapshot(ctx: Ctx, eng: Row) {
  if (eng.is_demo) throw badRequest('Host snapshots cannot be added to the demo engagement.');
  const started = new Date();
  const cmds = snapshotCommands();
  const results: { c: Cmd; r: { ok: boolean; out: string } }[] = [];
  for (const c of cmds) results.push({ c, r: await run(c) });

  const nets = Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).map((n) => `  ${name.padEnd(24)} ${n.family.padEnd(5)} ${n.address}${n.cidr ? ` (${n.cidr})` : ''}${n.mac && n.mac !== '00:00:00:00:00:00' ? `  MAC ${n.mac}` : ''}${n.internal ? '  internal' : ''}`))
    .join('\n');
  const header = [
    'CyberDome host snapshot',
    '=======================',
    `Collected:   ${started.toISOString()} (local ${started.toString()})`,
    `Computer:    ${os.hostname()}`,
    `User:        ${os.userInfo().username}`,
    `OS:          ${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    `Uptime:      ${Math.round(os.uptime() / 3600)} hours`,
    `Memory:      ${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    '',
    'Scope note: this is the computer running CyberDome, collected with fixed read-only',
    'commands. Nothing was changed and nothing was sent off this machine.',
    '',
    'Network interfaces',
    '------------------',
    nets,
  ].join('\n');
  const body = results
    .map(({ c, r }) => [`\n\n## ${c.title}`, `Command: ${[c.bin, ...c.args].join(' ')}`, `Look for: ${c.why}`, r.ok ? '' : '(command unavailable on this system)', r.out].join('\n'))
    .join('');
  const text = header + body + '\n';
  const okCount = results.filter((x) => x.r.ok).length;
  const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const ev = storeFileEvidence(ctx.db, ctx.cfg, {
    engagementId: eng.id,
    buffer: Buffer.from(text, 'utf8'),
    originalFilename: `host-snapshot-${os.hostname()}-${stamp}.txt`,
    sourceCategory: 'authorized_lab',
    sourceTool: `CyberDome host snapshot (${os.platform()})`,
    title: `Host snapshot of ${os.hostname()}`,
    collectedAt: started.toISOString(),
    collectedAtNote: 'Recorded by CyberDome when the commands ran.',
    observation: `${okCount} of ${cmds.length} read-only commands returned output: ${results.filter((x) => x.r.ok).map((x) => x.c.title.toLowerCase()).join('; ')}.`,
    tags: ['host-snapshot', 'lab1', 'lab5'],
    sanitizationStatus: 'not_reviewed',
    analysisStatus: 'stored_only',
    analysisNote: 'Raw command output. Review it and record anything suspicious as a sign-of-compromise item or indicator, citing this Evidence ID.',
  });
  logActivity(ctx.db, eng.id, 'host_snapshot.created', 'evidence', `Collected a host snapshot of ${os.hostname()} as ${ev.code}`, { id: ev.id, code: ev.code });
  return { evidence_id: ev.id, evidence_code: ev.code, commands: results.map(({ c, r }) => ({ title: c.title, command: [c.bin, ...c.args].join(' '), ok: r.ok })) };
}
