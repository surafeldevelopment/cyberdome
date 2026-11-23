import crypto from 'node:crypto';
import type { Db } from '../db/index.js';

/** Prefixes for human-readable record codes. */
export const CODE_PREFIX = {
  evidence: 'EV',
  asset: 'AST',
  finding: 'FND',
  recon: 'REC',
  indicator: 'IOC',
  timeline: 'TL',
  scan_import: 'SCN',
  finding_import: 'VIM',
  log_import: 'LOG',
  ai_session: 'AI',
  scan_run: 'RUN',
} as const;
export type CodeKind = keyof typeof CODE_PREFIX;

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

/**
 * Allocate the next code for an engagement. Counters only increase, so a code is
 * never reused even after its record is withdrawn or deleted. Demo engagements
 * use a DEMO- prefix so demo IDs can never be confused with real evidence IDs.
 */
export function nextCode(db: Db, engagementId: string, kind: CodeKind): string {
  return db.tx(() => {
    const row = db.get<{ next_value: number }>('SELECT next_value FROM counters WHERE engagement_id = ? AND kind = ?', engagementId, kind);
    const n = row?.next_value ?? 1;
    if (row) db.run('UPDATE counters SET next_value = ? WHERE engagement_id = ? AND kind = ?', n + 1, engagementId, kind);
    else db.run('INSERT INTO counters (engagement_id, kind, next_value) VALUES (?,?,?)', engagementId, kind, n + 1);
    const isDemo = db.scalar<number>('SELECT is_demo FROM engagements WHERE id = ?', engagementId) === 1;
    return `${isDemo ? 'DEMO-' : ''}${CODE_PREFIX[kind]}-${String(n).padStart(3, '0')}`;
  });
}

/** Matches real and demo evidence IDs, e.g. EV-001, EV-1024, DEMO-EV-003. */
export const EVIDENCE_CODE_RE = /\b(?:DEMO-)?EV-\d{3,}\b/g;
