import type { Ctx } from '../app.js';
import type { Row } from '../db/index.js';
import { parseJson } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { nowIso, uid } from '../lib/codes.js';
import { currentActor, logActivity } from '../lib/activity.js';
import { isScanRunning, nmapInfo, planScan, startScan, cancelScan, type NmapProfile } from './nmapRunner.js';
import { applyExposureRules } from './exposureRules.js';
import { takeHostSnapshot } from './hostSnapshot.js';

/**
 * Autopilot: one guided pass over the authorized scope.
 *   1. Preflight   – in-scope targets and Nmap present.
 *   2. Scan        – a service scan of every in-scope target (fixed profile, exclusions enforced).
 *   3. Retry       – targets where no host answered are rescanned treating hosts as up (-Pn).
 *   4. Analyze     – exposure rules raise "Scanner-reported" findings that need analyst verification.
 *   5. Snapshot    – optional read-only snapshot of this computer.
 * Every scan goes through the same planScan/startScan path as a manual run, so all scope and
 * window checks apply. Nothing is validated, sanitized, or sent to an AI provider automatically.
 */
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'blocked';
export interface Step {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
  lines: { text: string; link?: string; tone?: 'ok' | 'warn' | 'bad' }[];
}
export interface AutopilotOptions {
  profile: Extract<NmapProfile, 'quick' | 'standard'>;
  retry_without_ping: boolean;
  analyze: boolean;
  host_snapshot: boolean;
}

const active = new Map<string, { cancelled: boolean; currentRunId: string | null }>();

const SCANNABLE = new Set(['ip', 'cidr', 'range', 'hostname', 'domain']);

function baseSteps(o: AutopilotOptions): Step[] {
  return [
    { key: 'preflight', label: 'Check readiness', status: 'pending', detail: '', lines: [] },
    { key: 'scan', label: o.profile === 'standard' ? 'Scan targets (top 1,000 ports)' : 'Scan targets (top 100 ports)', status: 'pending', detail: '', lines: [] },
    { key: 'retry', label: 'Retry silent targets without ping', status: o.retry_without_ping ? 'pending' : 'skipped', detail: o.retry_without_ping ? '' : 'Turned off', lines: [] },
    { key: 'analyze', label: 'Flag risky exposed services', status: o.analyze ? 'pending' : 'skipped', detail: o.analyze ? '' : 'Turned off', lines: [] },
    { key: 'snapshot', label: 'Snapshot this computer', status: o.host_snapshot ? 'pending' : 'skipped', detail: o.host_snapshot ? '' : 'Turned off', lines: [] },
  ];
}

export function readiness(ctx: Ctx, eng: Row) {
  const targets = ctx.db.all("SELECT id, target, target_type, confirmed FROM scope_entries WHERE engagement_id = ? AND kind = 'in' ORDER BY created_at", eng.id);
  const confirmed = targets.filter((t) => SCANNABLE.has(t.target_type));
  const nm = nmapInfo(ctx);
  const checks = [
    { key: 'real', ok: !eng.is_demo, label: eng.is_demo ? 'The demo engagement cannot be scanned' : 'Real engagement selected', fix: null },
    { key: 'scope', ok: confirmed.length > 0, label: confirmed.length ? `${confirmed.length} target${confirmed.length === 1 ? '' : 's'} in scope` : 'No targets in scope yet', fix: '/engagement?tab=scope' },
    { key: 'nmap', ok: !!nm.path, label: nm.path ? (nm.version ?? 'Nmap found') : 'Nmap not installed', fix: null },
  ];
  return { ready: checks.every((c) => c.ok), checks, targets: confirmed.map((t) => ({ id: t.id, target: t.target })) };
}

export const hydrateAutopilot = (r: Row) => ({ ...r, options: parseJson(r.options, {}), steps: parseJson<Step[]>(r.steps, []), summary: parseJson(r.summary, {}) });

export function markInterruptedAutopilot(ctx: Ctx) {
  ctx.db.run("UPDATE autopilot_runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'", nowIso());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForRun(ctx: Ctx, runId: string, onTick: () => void) {
  for (;;) {
    const r = ctx.db.get('SELECT status FROM scan_runs WHERE id = ?', runId);
    if (!r || r.status !== 'running') return;
    onTick();
    await sleep(1000);
  }
}

export function startAutopilot(ctx: Ctx, eng: Row, options: AutopilotOptions) {
  const { db } = ctx;
  if ([...active.keys()].length) throw new HttpError(409, 'Autopilot is already running.');
  const ready = readiness(ctx, eng);
  const id = uid();
  const steps = baseSteps(options);
  const started = nowIso();
  db.insert('autopilot_runs', { id, engagement_id: eng.id, status: 'running', options, steps, summary: {}, requested_by: currentActor(db), started_at: started });

  const save = (status?: string, summary?: Record<string, unknown>) =>
    db.update('autopilot_runs', id, { steps, ...(status ? { status, finished_at: status === 'running' ? null : nowIso() } : {}), ...(summary ? { summary } : {}) });
  const step = (k: string) => steps.find((s) => s.key === k)!;

  if (!ready.ready) {
    const pf = step('preflight');
    pf.status = 'blocked';
    pf.detail = 'Fix these first, then run again.';
    pf.lines = ready.checks.filter((c) => !c.ok).map((c) => ({ text: c.label, link: c.fix ?? undefined, tone: 'bad' as const }));
    for (const s of steps) if (s.status === 'pending') s.status = 'skipped';
    save('blocked', { blocked: true });
    return hydrateAutopilot(db.get('SELECT * FROM autopilot_runs WHERE id = ?', id)!);
  }

  const state = { cancelled: false, currentRunId: null as string | null };
  active.set(id, state);
  logActivity(db, eng.id, 'autopilot.started', 'autopilot', `Autopilot started (${options.profile} scan of ${ready.targets.length} target(s))`, { id });

  void (async () => {
    const summary: Record<string, any> = { runs: [], hosts_up: 0, open_services: 0, findings_created: 0, snapshot: null };
    try {
      const pf = step('preflight');
      pf.status = 'done';
      pf.detail = 'Scope and Nmap checked.';
      pf.lines = [];
      save();

      const runTarget = async (target: string, skipPing: boolean, s: Step) => {
        let plan = await planScan(ctx, eng, target, options.profile, skipPing);
        // Another scan (for example a schedule) may be running: wait our turn.
        for (let i = 0; !plan.ok && plan.blockers.some((b) => /already running/.test(b)) && i < 3600 && !state.cancelled; i++) {
          await sleep(1000);
          plan = await planScan(ctx, eng, target, options.profile, skipPing);
        }
        if (state.cancelled) return null;
        if (!plan.ok) {
          s.lines.push({ text: `${target}: skipped. ${plan.blockers[0]}`, tone: 'warn' });
          save();
          return null;
        }
        const run = startScan(ctx, db.get('SELECT * FROM engagements WHERE id = ?', eng.id)!, plan);
        state.currentRunId = run.id;
        s.lines.push({ text: `${run.code} ${target}: scanning ${plan.addresses.length} address(es)${skipPing ? ' with -Pn' : ''}…` });
        const lineIdx = s.lines.length - 1;
        save();
        await waitForRun(ctx, run.id, () => {
          const r = db.get('SELECT progress FROM scan_runs WHERE id = ?', run.id);
          s.detail = `${run.code}: ${Math.round(r?.progress ?? 0)}%`;
          save();
        });
        state.currentRunId = null;
        const done = db.get(
          `SELECT r.*, si.code AS si_code, si.hosts_up, si.hosts_total, (SELECT COUNT(*) FROM service_observations o WHERE o.scan_import_id = r.scan_import_id AND o.state = 'open') AS open_ports
           FROM scan_runs r LEFT JOIN scan_imports si ON si.id = r.scan_import_id WHERE r.id = ?`,
          run.id,
        )!;
        const up = Number(done.hosts_up ?? done.hosts_total ?? 0);
        if (done.status === 'completed') {
          s.lines[lineIdx] = { text: `${run.code} ${target}: ${up} host(s) up, ${done.open_ports ?? 0} open port(s). Imported as ${done.si_code}.`, link: done.scan_import_id ? `/scan/imports/${done.scan_import_id}` : undefined, tone: up ? 'ok' : 'warn' };
          summary.runs.push(run.code);
          summary.hosts_up += up;
          summary.open_services += Number(done.open_ports ?? 0);
        } else s.lines[lineIdx] = { text: `${run.code} ${target}: ${done.status}. ${done.error ?? ''}`, tone: 'bad' };
        save();
        return { up, status: done.status };
      };

      // 2. Scan every in-scope target.
      const sc = step('scan');
      sc.status = 'running';
      save();
      const silent: string[] = [];
      for (const t of ready.targets) {
        if (state.cancelled) break;
        const r = await runTarget(t.target, false, sc);
        if (r && r.status === 'completed' && r.up === 0) silent.push(t.target);
      }
      sc.status = state.cancelled || !summary.runs.length ? 'failed' : 'done';
      sc.detail = state.cancelled ? 'Cancelled' : summary.runs.length ? `${summary.runs.length} scan(s) completed` : 'No target could be scanned. See the reasons below.';
      save();

      // 3. Retry targets that did not answer ping (common for Windows hosts).
      const rt = step('retry');
      if (!state.cancelled && options.retry_without_ping) {
        if (!silent.length) {
          rt.status = 'skipped';
          rt.detail = summary.runs.length ? 'Every target answered' : 'Nothing was scanned';
        } else {
          rt.status = 'running';
          save();
          for (const t of silent) {
            if (state.cancelled) break;
            await runTarget(t, true, rt);
          }
          rt.status = state.cancelled ? 'failed' : 'done';
          rt.detail = `${silent.length} target(s) retried`;
        }
        save();
      }

      // 4. Exposure rules.
      const an = step('analyze');
      if (!state.cancelled && options.analyze && !summary.runs.length) {
        an.status = 'skipped';
        an.detail = 'Nothing was scanned';
        save();
      } else if (!state.cancelled && options.analyze) {
        an.status = 'running';
        save();
        const res = applyExposureRules(ctx, db.get('SELECT * FROM engagements WHERE id = ?', eng.id)!);
        summary.findings_created = res.created.length;
        an.status = 'done';
        an.detail = res.created.length
          ? `${res.created.length} new finding(s) to verify`
          : `No new risky services among ${res.services_checked} open service(s)${res.already ? ` (${res.already} already recorded)` : ''}`;
        an.lines = res.created.map((f) => ({ text: `${f.code} · ${f.severity} · ${f.title}`, link: `/vulnerabilities/${f.id}`, tone: 'warn' as const }));
        save();
      }

      // 5. Host snapshot.
      const sn = step('snapshot');
      if (!state.cancelled && options.host_snapshot) {
        sn.status = 'running';
        save();
        try {
          const r = await takeHostSnapshot(ctx, eng);
          summary.snapshot = r.evidence_code;
          sn.status = 'done';
          sn.detail = `Saved as ${r.evidence_code}`;
          sn.lines = [{ text: `${r.evidence_code}: ${r.commands.filter((c) => c.ok).length} of ${r.commands.length} commands returned output`, link: `/evidence/${r.evidence_id}`, tone: 'ok' }];
        } catch (e: any) {
          sn.status = 'failed';
          sn.detail = String(e?.message ?? e).slice(0, 200);
        }
        save();
      }
      for (const s of steps) if (s.status === 'pending') s.status = 'skipped';
      save(state.cancelled ? 'cancelled' : 'completed', summary);
      logActivity(db, eng.id, state.cancelled ? 'autopilot.cancelled' : 'autopilot.completed', 'autopilot',
        `Autopilot ${state.cancelled ? 'cancelled' : 'finished'}: ${summary.runs.length} scan(s), ${summary.hosts_up} host(s) up, ${summary.findings_created} finding(s) to verify`, { id });
    } catch (e: any) {
      for (const s of steps) if (s.status === 'running') { s.status = 'failed'; s.detail = String(e?.message ?? e).slice(0, 200); }
      save('failed', summary);
    } finally {
      active.delete(id);
    }
  })();

  return hydrateAutopilot(db.get('SELECT * FROM autopilot_runs WHERE id = ?', id)!);
}

export function cancelAutopilot(ctx: Ctx, eng: Row, id: string) {
  const st = active.get(id);
  if (!st) throw new HttpError(400, 'This autopilot run is not running.');
  st.cancelled = true;
  if (st.currentRunId) {
    try {
      cancelScan(ctx, eng, st.currentRunId);
    } catch {
      /* already finished */
    }
  }
}

export const autopilotBusy = () => active.size > 0 || isScanRunning();
