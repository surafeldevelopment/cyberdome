/**
 * Backup / restore core shared by the GET /api/backup endpoint and the CLI scripts.
 *
 * Backup format (a standard .zip, readable by Windows Explorer, macOS Archive Utility, unzip):
 *   manifest.json        - format version, schema version, creation time, SHA-256 + size of every file
 *   cyberdome.db         - consistent SQLite snapshot made with `VACUUM INTO` (safe while the server runs)
 *   evidence/...         - every stored evidence file, byte-for-byte
 *   README.txt           - how to restore
 *
 * Restore uses a small built-in ZIP reader (stored + deflate entries, no ZIP64), so it needs no
 * external unzip tool on Windows, macOS, or Linux.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import net from 'node:net';
import archiverModule from 'archiver';
import type { Db } from '../db/index.js';
import type { AppConfig } from '../config.js';

// Imported statically so bundlers (the desktop build) include it; typed loosely on purpose.
const archiver = archiverModule as unknown as (format: 'zip', opts?: Record<string, unknown>) => any;

export const BACKUP_FORMAT_VERSION = 1;

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}
export interface Manifest {
  app: 'cyberdome-command-center';
  format_version: number;
  schema_version: number;
  created_at: string;
  db_file: string;
  files: ManifestFile[];
  note: string;
}

const sha256File = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function walk(dir: string, base = dir, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, base, out);
    else if (ent.isFile()) out.push(path.relative(base, p));
  }
  return out;
}

const README = `CyberDome Command Center backup

Restore (stop the server first):
  npm run restore -- path/to/this-backup.zip

The restore script verifies every SHA-256 in manifest.json, moves the current data
directory aside to data.before-restore-<timestamp>, and then writes this snapshot.
SHA-256 values confirm the files were not altered since the backup; they do not by
themselves establish authenticity or a complete forensic chain of custody.
`;

/** Create a backup zip at `outFile`. Returns the manifest. */
export async function createBackup(db: Db, cfg: AppConfig, outFile: string): Promise<Manifest> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberdome-backup-'));
  try {
    const snap = path.join(work, 'cyberdome.db');
    db.raw.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);

    const evFiles = walk(cfg.evidenceDir).sort();
    const files: ManifestFile[] = [
      { path: 'cyberdome.db', size: fs.statSync(snap).size, sha256: sha256File(snap) },
      ...evFiles.map((rel) => {
        const abs = path.join(cfg.evidenceDir, rel);
        return { path: 'evidence/' + rel.split(path.sep).join('/'), size: fs.statSync(abs).size, sha256: sha256File(abs) };
      }),
    ];
    const manifest: Manifest = {
      app: 'cyberdome-command-center',
      format_version: BACKUP_FORMAT_VERSION,
      schema_version: db.schemaVersion(),
      created_at: new Date().toISOString(),
      db_file: 'cyberdome.db',
      files,
      note: 'SHA-256 values detect changes since backup; they do not by themselves prove authenticity or chain of custody.',
    };

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(outFile);
      const zip = archiver('zip', { zlib: { level: 6 } });
      out.on('close', () => resolve());
      out.on('error', reject);
      zip.on('error', reject);
      zip.pipe(out);
      zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      zip.append(README, { name: 'README.txt' });
      zip.file(snap, { name: 'cyberdome.db' });
      for (const rel of evFiles) zip.file(path.join(cfg.evidenceDir, rel), { name: 'evidence/' + rel.split(path.sep).join('/') });
      zip.finalize();
    });
    return manifest;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/* ---------------- Minimal ZIP reader (central directory based) ---------------- */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP file (end of central directory not found).');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === 0xffffffff || count === 0xffff) throw new Error('ZIP64 archives are not supported.');
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`Corrupt local header for ${name}.`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`Unsupported compression method ${method} for ${name}.`);
    if (data.length !== size) throw new Error(`Size mismatch for ${name}.`);
    out.push({ name, data });
  }
  return out;
}

/** Reject absolute paths and traversal. */
export function safeRel(name: string): string {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').some((p) => p === '..')) throw new Error(`Unsafe path in backup: ${name}`);
  return n;
}

/** Load a backup (zip file or extracted directory) into memory as {path -> bytes}. */
export function loadBackup(source: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const st = fs.statSync(source);
  if (st.isDirectory()) {
    for (const rel of walk(source)) files.set(safeRel(rel.split(path.sep).join('/')), fs.readFileSync(path.join(source, rel)));
  } else {
    for (const e of readZip(fs.readFileSync(source))) files.set(safeRel(e.name), e.data);
  }
  return files;
}

export interface VerifyResult {
  manifest: Manifest;
  problems: string[];
}

export function verifyBackup(files: Map<string, Buffer>): VerifyResult {
  const mf = files.get('manifest.json');
  if (!mf) throw new Error('manifest.json is missing; this is not a CyberDome backup.');
  const manifest = JSON.parse(mf.toString('utf8')) as Manifest;
  if (manifest.app !== 'cyberdome-command-center') throw new Error('manifest.json does not describe a CyberDome backup.');
  if (manifest.format_version > BACKUP_FORMAT_VERSION) throw new Error(`Backup format v${manifest.format_version} is newer than this app supports.`);
  const problems: string[] = [];
  for (const f of manifest.files) {
    const data = files.get(f.path);
    if (!data) { problems.push(`Missing file: ${f.path}`); continue; }
    const h = crypto.createHash('sha256').update(data).digest('hex');
    if (h !== f.sha256) problems.push(`Hash mismatch: ${f.path}`);
    if (data.length !== f.size) problems.push(`Size mismatch: ${f.path}`);
  }
  if (!files.get(manifest.db_file)) problems.push('Database snapshot missing.');
  return { manifest, problems };
}

/** Write a verified backup into `dataDir`, moving any existing directory aside first. */
export function writeRestore(files: Map<string, Buffer>, manifest: Manifest, dataDir: string): { movedTo: string | null } {
  let movedTo: string | null = null;
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    movedTo = `${dataDir.replace(/[\\/]+$/, '')}.before-restore-${stamp}`;
    fs.renameSync(dataDir, movedTo);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  for (const f of manifest.files) {
    const target = path.join(dataDir, f.path === manifest.db_file ? 'cyberdome.db' : f.path);
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(dataDir) + path.sep)) throw new Error(`Unsafe path: ${f.path}`);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, files.get(f.path)!, { mode: 0o600 });
  }
  return { movedTo };
}

export function isPortOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}
