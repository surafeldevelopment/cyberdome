import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Db, Row } from '../db/index.js';
import { parseJson } from '../db/index.js';
import type { AppConfig } from '../config.js';
import { nextCode, nowIso, uid } from '../lib/codes.js';
import { detectType, MIME_FOR, type DetectedType } from '../lib/filetype.js';
import { readPcapMeta } from '../lib/pcap.js';
import { badRequest, notFound } from '../lib/http.js';
import { logActivity, currentActor } from '../lib/activity.js';

export type SourceCategory = 'authorized_lab' | 'instructor_supplied' | 'external_reference' | 'demo' | 'project_artifact';

export interface NewFileEvidence {
  engagementId: string;
  buffer: Buffer;
  originalFilename: string;
  sourceCategory: SourceCategory;
  sourceTool?: string;
  title?: string;
  collectedAt?: string | null;
  collectedAtNote?: string;
  observation?: string;
  interpretation?: string;
  confidence?: string;
  tags?: string[];
  sanitizationStatus?: string;
  derivedFromId?: string | null;
  derivationNote?: string;
  assetIds?: string[];
  analysisStatus?: string;
  analysisNote?: string;
}

export function sha256(buf: Buffer) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const safeName = (n: string) => path.basename(n || 'upload').replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 200) || 'upload';

/** Ensure an engagement exists; demo engagements only accept demo evidence and vice versa. */
export function assertSourceAllowed(db: Db, engagementId: string, category: SourceCategory) {
  const eng = db.get('SELECT id, is_demo FROM engagements WHERE id = ?', engagementId);
  if (!eng) throw notFound('Engagement');
  if (eng.is_demo && category !== 'demo' && category !== 'external_reference' && category !== 'project_artifact')
    throw badRequest('The demo engagement only accepts records labeled as demo data.');
  if (!eng.is_demo && category === 'demo')
    throw badRequest('Demo data cannot be added to a real engagement. Switch to the demo engagement instead.');
}

export function storeFileEvidence(db: Db, cfg: AppConfig, input: NewFileEvidence) {
  assertSourceAllowed(db, input.engagementId, input.sourceCategory);
  if (!input.buffer?.length) throw badRequest('The uploaded file is empty.');
  if (input.buffer.length > cfg.maxUploadBytes) throw badRequest('File exceeds the configured upload size limit.');
  const detected: DetectedType = detectType(input.buffer, input.originalFilename);
  if (detected === 'executable')
    throw badRequest('Executable binaries are not accepted in the Evidence Locker. Record the SHA-256 as a hash reference instead.');

  const hash = sha256(input.buffer);
  const id = uid();
  const rel = path.join(input.engagementId, hash.slice(0, 2), `${id}.bin`);
  const abs = path.join(cfg.evidenceDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, input.buffer, { flag: 'wx', mode: 0o600 });

  let analysisStatus = input.analysisStatus ?? 'stored_only';
  let analysisNote = input.analysisNote ?? '';
  if ((detected === 'pcap' || detected === 'pcapng') && !input.analysisStatus) {
    const meta = readPcapMeta(input.buffer);
    analysisStatus = 'metadata_read';
    analysisNote = meta
      ? `Capture metadata read from file headers: ${meta.packetCount} packets, link type ${meta.linkTypeName}, first ${meta.firstPacketAt ?? 'n/a'}, last ${meta.lastPacketAt ?? 'n/a'}${meta.truncated ? ' (file appears truncated)' : ''}. No packet contents were decoded.`
      : 'Could not read capture headers. The file is stored unchanged; no packet analysis was performed.';
  }

  const duplicateOf = db.get<{ code: string }>(
    "SELECT code FROM evidence WHERE engagement_id = ? AND sha256 = ? AND status = 'active' ORDER BY created_at LIMIT 1",
    input.engagementId,
    hash,
  );

  const now = nowIso();
  let code = '';
  try {
    db.tx(() => {
      code = nextCode(db, input.engagementId, 'evidence');
      db.insert('evidence', {
        id,
        engagement_id: input.engagementId,
        code,
        title: input.title?.trim() || safeName(input.originalFilename),
        kind: 'file',
        original_filename: safeName(input.originalFilename),
        mime_type: MIME_FOR[detected] ?? 'application/octet-stream',
        detected_type: detected,
        size_bytes: input.buffer.length,
        sha256: hash,
        storage_path: rel,
        source_category: input.sourceCategory,
        source_tool: input.sourceTool ?? '',
        collected_at: input.collectedAt || null,
        collected_at_note: input.collectedAtNote ?? (input.collectedAt ? '' : 'Collection time not supplied.'),
        imported_at: now,
        observation: input.observation ?? '',
        interpretation: input.interpretation ?? '',
        confidence: input.confidence ?? 'unrated',
        tags: input.tags ?? [],
        sanitization_status: input.sanitizationStatus ?? 'not_reviewed',
        derived_from_id: input.derivedFromId ?? null,
        derivation_note: input.derivationNote ?? '',
        analysis_status: analysisStatus,
        analysis_note: analysisNote,
        status: 'active',
        created_by: currentActor(db),
        created_at: now,
        updated_at: now,
      });
      for (const a of input.assetIds ?? []) db.run('INSERT OR IGNORE INTO evidence_assets (evidence_id, asset_id) VALUES (?,?)', id, a);
      db.insert('evidence_reviews', {
        id: uid(), evidence_id: id, reviewer: currentActor(db), action: 'imported',
        notes: `Stored ${input.buffer.length} bytes; SHA-256 calculated from file bytes.${input.derivedFromId ? ' Sanitized derivative of another artifact.' : ''}`,
        created_at: now,
      });
      logActivity(db, input.engagementId, 'evidence.created', 'evidence', `Added ${code} (${safeName(input.originalFilename)})`, { id, code });
    });
  } catch (e) {
    fs.rmSync(abs, { force: true });
    throw e;
  }
  return { id, code, sha256: hash, detectedType: detected, duplicateOf: duplicateOf?.code ?? null };
}

export function storeReferenceEvidence(
  db: Db,
  input: Omit<NewFileEvidence, 'buffer' | 'originalFilename'> & { referenceUri: string; referenceSha256?: string; sizeBytes?: number },
) {
  assertSourceAllowed(db, input.engagementId, input.sourceCategory);
  if (!input.referenceUri?.trim()) throw badRequest('A reference location is required.');
  if (input.referenceSha256 && !/^[a-f0-9]{64}$/i.test(input.referenceSha256)) throw badRequest('SHA-256 must be 64 hexadecimal characters.');
  const id = uid();
  const now = nowIso();
  let code = '';
  db.tx(() => {
    code = nextCode(db, input.engagementId, 'evidence');
    db.insert('evidence', {
      id, engagement_id: input.engagementId, code,
      title: input.title?.trim() || input.referenceUri.slice(0, 120),
      kind: 'reference', reference_uri: input.referenceUri.trim(),
      sha256: input.referenceSha256?.toLowerCase() ?? null, size_bytes: input.sizeBytes ?? null,
      source_category: input.sourceCategory, source_tool: input.sourceTool ?? '',
      collected_at: input.collectedAt || null, collected_at_note: input.collectedAtNote ?? '',
      imported_at: now, observation: input.observation ?? '', interpretation: input.interpretation ?? '',
      confidence: input.confidence ?? 'unrated', tags: input.tags ?? [],
      sanitization_status: input.sanitizationStatus ?? 'not_reviewed',
      analysis_status: 'reference_only',
      analysis_note: input.referenceSha256
        ? 'Reference only. The hash was supplied by the analyst, not calculated by this application.'
        : 'Reference only. The artifact itself is not stored in this application.',
      status: 'active', created_by: currentActor(db), created_at: now, updated_at: now,
    });
    for (const a of input.assetIds ?? []) db.run('INSERT OR IGNORE INTO evidence_assets (evidence_id, asset_id) VALUES (?,?)', id, a);
    db.insert('evidence_reviews', { id: uid(), evidence_id: id, reviewer: currentActor(db), action: 'reference_recorded', notes: '', created_at: now });
    logActivity(db, input.engagementId, 'evidence.created', 'evidence', `Recorded reference ${code}`, { id, code });
  });
  return { id, code };
}

export function evidenceAbsPath(cfg: AppConfig, row: Row) {
  if (!row.storage_path) return null;
  const abs = path.resolve(cfg.evidenceDir, row.storage_path);
  if (!abs.startsWith(path.resolve(cfg.evidenceDir) + path.sep)) return null; // path traversal guard
  return abs;
}

export function readEvidenceBytes(cfg: AppConfig, row: Row): Buffer | null {
  const p = evidenceAbsPath(cfg, row);
  if (!p || !fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

/** Resolve evidence codes (EV-001) or ids to active evidence rows in one engagement. */
export function resolveEvidence(db: Db, engagementId: string, refs: string[] | undefined): Row[] {
  const out: Row[] = [];
  const missing: string[] = [];
  for (const r of [...new Set((refs ?? []).filter(Boolean))]) {
    const row = db.get('SELECT * FROM evidence WHERE engagement_id = ? AND (id = ? OR code = ?)', engagementId, r, r.toUpperCase());
    if (!row) missing.push(r);
    else out.push(row);
  }
  if (missing.length) throw badRequest(`Unknown evidence ID(s) for this engagement: ${missing.join(', ')}`);
  return out;
}

/** Replace link-table rows for a record. */
export function setLinks(db: Db, table: string, ownerCol: string, ownerId: string, otherCol: string, ids: string[]) {
  db.run(`DELETE FROM ${table} WHERE ${ownerCol} = ?`, ownerId);
  for (const id of [...new Set(ids)]) db.run(`INSERT OR IGNORE INTO ${table} (${ownerCol}, ${otherCol}) VALUES (?,?)`, ownerId, id);
}

export function evidenceBrief(db: Db, table: string, ownerCol: string, ownerId: string) {
  return db.all(
    `SELECT e.id, e.code, e.title, e.status, e.source_category, e.sanitization_status FROM ${table} l JOIN evidence e ON e.id = l.evidence_id WHERE l.${ownerCol} = ? ORDER BY e.code`,
    ownerId,
  );
}

export function hydrateEvidence(row: Row) {
  return { ...row, tags: parseJson<string[]>(row.tags, []) };
}
