import type { Ctx } from '../app.js';
import type { Row } from '../db/index.js';
import { badRequest, HttpError, notFound } from '../lib/http.js';
import { nowIso, uid } from '../lib/codes.js';
import { currentActor, logActivity } from '../lib/activity.js';
import { isScanRunning, planScan, startScan, type NmapProfile } from './nmapRunner.js';

/**
 * Automatic (repeating) scans. A schedule is created only from a plan that is valid at that
 * moment and it always has an end date (at most 30 days away). Before every run the plan is
 * rebuilt from the database, so scope changes or new exclusions stop a schedule from scanning
 * anything outside scope.
 */
export const MAX_SCHEDULE_DAYS = 30;
export const ALLOWED_INTERVALS = [60, 180, 360, 720, 1440, 10080];

export function hydrateSchedule(r: Row) {
  return { ...r, enabled: !!r.enabled, skip_discovery: !!r.skip_discovery };
}

export async function createSchedule(
  ctx: Ctx,
  eng: Row,
  input: { target: string; profile: NmapProfile; skip_discovery?: boolean; interval_minutes: number; ends_at?: string | null; run_now?: boolean },
) {
  const { db } = ctx;
  if (!ALLOWED_INTERVALS.includes(input.interval_minutes)) throw badRequest('Choose one of the offered repeat intervals.');
  const now = Date.now();
  const hardMax = now + MAX_SCHEDULE_DAYS * 86_400_000;
  let ends = input.ends_at ? Date.parse(input.ends_at) : now + 7 * 86_400_000;
  if (Number.isNaN(ends)) throw badRequest('The end date is not a valid date.');
  if (input.ends_at && /^\d{4}-\d{2}-\d{2}$/.test(input.ends_at)) ends += 86_400_000 - 1;
  if (ends > hardMax) ends = hardMax;
  if (ends <= now + 60_000) throw badRequest('The schedule would end before its first repeat. Pick a later end date.');

  const plan = await planScan(ctx, eng, input.target, input.profile, !!input.skip_discovery);
  // A scan already running only delays the first run; every other blocker refuses the schedule.
  const blockers = plan.blockers.filter((b) => !/already running/.test(b));
  if (blockers.length) throw new HttpError(409, blockers[0], { blockers });

  const id = uid();
  const ts = nowIso();
  const runNow = input.run_now !== false;
  db.insert('scan_schedules', {
    id, engagement_id: eng.id, target: plan.target_input, profile: input.profile, skip_discovery: !!input.skip_discovery,
    interval_minutes: input.interval_minutes, ends_at: new Date(ends).toISOString(),
    next_run_at: new Date(runNow ? now : now + input.interval_minutes * 60_000).toISOString(),
    enabled: true, created_by: currentActor(db), created_at: ts, updated_at: ts,
  });
  logActivity(db, eng.id, 'scan_schedule.created', 'scan_schedule',
    `Scheduled automatic ${input.profile} scans of ${plan.target_input} every ${input.interval_minutes / 60} h until ${new Date(ends).toISOString().slice(0, 16).replace('T', ' ')} UTC`, { id });
  if (runNow) await tick(ctx);
  return hydrateSchedule(db.get('SELECT * FROM scan_schedules WHERE id = ?', id)!);
}

export function setScheduleEnabled(ctx: Ctx, eng: Row, id: string, enabled: boolean) {
  const s = ctx.db.get('SELECT * FROM scan_schedules WHERE engagement_id = ? AND id = ?', eng.id, id);
  if (!s) throw notFound('Schedule');
  if (enabled && Date.parse(s.ends_at) <= Date.now()) throw badRequest('This schedule has ended. Create a new one.');
  ctx.db.update('scan_schedules', s.id, {
    enabled, updated_at: nowIso(),
    ...(enabled && Date.parse(s.next_run_at) < Date.now() ? { next_run_at: nowIso() } : {}),
  });
  logActivity(ctx.db, eng.id, enabled ? 'scan_schedule.resumed' : 'scan_schedule.paused', 'scan_schedule', `${enabled ? 'Resumed' : 'Paused'} automatic scans of ${s.target}`, { id: s.id });
  return hydrateSchedule(ctx.db.get('SELECT * FROM scan_schedules WHERE id = ?', s.id)!);
}

export function deleteSchedule(ctx: Ctx, eng: Row, id: string) {
  const s = ctx.db.get('SELECT * FROM scan_schedules WHERE engagement_id = ? AND id = ?', eng.id, id);
  if (!s) throw notFound('Schedule');
  ctx.db.run('DELETE FROM scan_schedules WHERE id = ?', s.id);
  logActivity(ctx.db, eng.id, 'scan_schedule.deleted', 'scan_schedule', `Deleted the automatic scan schedule for ${s.target}`, { id: s.id });
}

let ticking = false;
/** Start any schedule that is due. Safe to call often; does nothing while a scan is running. */
export async function tick(ctx: Ctx) {
  if (ticking) return;
  ticking = true;
  try {
    const { db } = ctx;
    const now = Date.now();
    // Finish schedules whose end date has passed.
    for (const s of db.all("SELECT * FROM scan_schedules WHERE enabled = 1 AND ends_at <= ?", new Date(now).toISOString())) {
      db.update('scan_schedules', s.id, { enabled: false, last_status: 'ended', last_message: 'Reached its end date.', updated_at: nowIso() });
      logActivity(db, s.engagement_id, 'scan_schedule.ended', 'scan_schedule', `Automatic scans of ${s.target} ended (end date reached)`, { id: s.id });
    }
    if (isScanRunning()) return;
    const due = db.get("SELECT * FROM scan_schedules WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at LIMIT 1", new Date(now).toISOString());
    if (!due) return;
    const eng = db.get('SELECT * FROM engagements WHERE id = ?', due.engagement_id);
    const next = new Date(now + due.interval_minutes * 60_000).toISOString();
    if (!eng) return;
    const plan = await planScan(ctx, eng, due.target, due.profile, !!due.skip_discovery);
    if (!plan.ok) {
      // Re-validated at run time and refused: record why and try again next interval.
      const msg = plan.blockers[0] ?? 'The scan plan is no longer valid.';
      db.update('scan_schedules', due.id, { next_run_at: next, last_status: 'skipped', last_message: msg, updated_at: nowIso() });
      logActivity(db, eng.id, 'scan_schedule.skipped', 'scan_schedule', `Skipped an automatic scan of ${due.target}: ${msg}`, { id: due.id });
      return;
    }
    const run = startScan(ctx, eng, plan, due.id);
    db.update('scan_schedules', due.id, { next_run_at: next, last_run_id: run.id, last_status: 'started', last_message: `${run.code} started`, runs_started: due.runs_started + 1, updated_at: nowIso() });
  } catch (e: any) {
    console.error('Scan scheduler error:', e?.message ?? e);
  } finally {
    ticking = false;
  }
}

let timer: NodeJS.Timeout | null = null;
export function startScheduler(ctx: Ctx, everyMs = 30_000) {
  if (timer) return;
  timer = setInterval(() => void tick(ctx), everyMs);
  timer.unref();
  void tick(ctx);
}
export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
