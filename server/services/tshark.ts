import { execFile } from 'node:child_process';
import fs from 'node:fs';

/**
 * Isolated, local tshark processing of a stored capture.
 * - execFile (no shell), fixed argument list; only the stored file path varies and it is
 *   produced by the evidence store (never user input).
 * - Resource limits: file size cap, packet-count cap (-c), timeout, stdout buffer cap.
 * - Output: packet summary fields only (no payload extraction).
 */
export const TSHARK_FIELDS = [
  'frame.number', 'frame.time_epoch', 'ip.src', 'ip.dst', 'tcp.srcport', 'tcp.dstport', 'udp.srcport', 'udp.dstport', '_ws.col.Protocol', '_ws.col.Info',
];
export const TSHARK_LIMITS = { maxFileBytes: 100 * 1024 * 1024, maxPackets: 50_000, timeoutMs: 60_000, maxBufferBytes: 64 * 1024 * 1024 };

export function tsharkArgs(file: string, maxPackets = TSHARK_LIMITS.maxPackets): string[] {
  const args = ['-n', '-r', file, '-c', String(Math.max(1, Math.min(maxPackets, TSHARK_LIMITS.maxPackets))), '-T', 'fields', '-E', 'header=y', '-E', 'separator=,', '-E', 'quote=d', '-E', 'occurrence=f'];
  for (const f of TSHARK_FIELDS) args.push('-e', f);
  return args;
}

export function runTshark(bin: string, file: string, maxPackets?: number): Promise<{ csv: string; stderr: string; args: string[] }> {
  return new Promise((resolve, reject) => {
    const st = fs.statSync(file);
    if (st.size > TSHARK_LIMITS.maxFileBytes) return reject(new Error(`Capture is larger than the ${TSHARK_LIMITS.maxFileBytes / 1024 / 1024} MB processing limit.`));
    const args = tsharkArgs(file, maxPackets);
    execFile(
      bin,
      args,
      { timeout: TSHARK_LIMITS.timeoutMs, maxBuffer: TSHARK_LIMITS.maxBufferBytes, windowsHide: true, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (err as any).killed ? 'tshark exceeded the 60-second time limit and was stopped.' : (String(stderr || '').split('\n').find((l) => l.trim() && !/running as user/i.test(l)) ?? err.message);
          return reject(new Error(`tshark failed: ${msg.slice(0, 400)}`));
        }
        resolve({ csv: String(stdout), stderr: String(stderr ?? ''), args });
      },
    );
  });
}
