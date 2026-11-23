import type { Db } from '../db/index.js';
import { nowIso } from './codes.js';

export function currentActor(db: Db): string {
  return (db.scalar<string>("SELECT value FROM settings WHERE key = 'analyst_name'") || '').trim() || 'Local analyst';
}

export function logActivity(
  db: Db,
  engagementId: string | null,
  action: string,
  entityType: string,
  summary: string,
  entity?: { id?: string | null; code?: string | null },
  actor?: string,
) {
  db.run(
    'INSERT INTO activity (engagement_id, ts, actor, action, entity_type, entity_id, entity_code, summary) VALUES (?,?,?,?,?,?,?,?)',
    engagementId,
    nowIso(),
    actor ?? currentActor(db),
    action,
    entityType,
    entity?.id ?? null,
    entity?.code ?? null,
    summary,
  );
}
