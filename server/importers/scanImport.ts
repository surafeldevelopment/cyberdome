import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../app.js';
import type { Row } from '../db/index.js';
import { parseJson } from '../db/index.js';
import { detectType } from '../lib/filetype.js';
import { nextCode, nowIso, uid } from '../lib/codes.js';
import { logActivity, currentActor } from '../lib/activity.js';
import { checkScope } from '../lib/scope.js';
import { badRequest, conflict } from '../lib/http.js';
import { sha256, storeFileEvidence, type SourceCategory } from '../services/evidence.js';
import { parseNmapXml } from './nmap.js';
import { parseScanCsv, parseScanJson } from './scanTabular.js';
import { emptyScan, observationCount, type ParsedScan } from './scanTypes.js';

export type ScanFormat = 'nmap_xml' | 'csv' | 'json' | 'raw_text';

/** Detect the format from file bytes (not the extension) and parse it. */
export function parseScanFile(buf: Buffer, filename: string, tz: string, forced?: ScanFormat): ParsedScan {
  const detected = detectType(buf, filename);
  const text = buf.toString('utf8');
  let fmt: ScanFormat | null = forced ?? null;
  if (!fmt) {
    if (detected === 'nmap_xml') fmt = 'nmap_xml';
    else if (detected === 'json') fmt = 'json';
    else if (detected === 'csv') fmt = 'csv';
    else if (detected === 'text' && /^﻿?\s*host_ip\s*,/i.test(text.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#')) ?? '')) fmt = 'csv';
    else if (detected === 'xml') {
      const s = emptyScan('nmap_xml');
      s.errors.push({ message: 'This XML file is not Nmap output (no <nmaprun> element). Vulnerability scanner XML belongs in the Vulnerabilities module.' });
      return s;
    } else fmt = 'raw_text';
  }
  if (['png', 'jpeg', 'gif', 'webp', 'pdf', 'pcap', 'pcapng', 'zip', 'gzip', 'executable', 'binary'].includes(detected)) {
    const s = emptyScan('raw_text');
    s.errors.push({ message: `This is a ${detected} file, not scan output. Add it through the Evidence Locker instead.` });
    return s;
  }
  if (fmt === 'nmap_xml') return parseNmapXml(text);
  if (fmt === 'csv') return parseScanCsv(text, tz);
  if (fmt === 'json') return parseScanJson(text, tz);
  const s = emptyScan('raw_text');
  s.tool = 'Unparsed text';
  if (/Nmap scan report for/i.test(text)) s.tool = 'Nmap (normal output)';
  s.errors.push({
    message:
      'This file is not in a supported structured format (Nmap XML, scan CSV template, or scan JSON). It can still be stored as raw evidence; no hosts or services will be extracted from it.',
  });
  if (s.tool.startsWith('Nmap')) s.warnings.push('Nmap normal (-oN) output detected. Re-run with -oX to produce importable XML, or store this file as raw evidence.');
  return s;
}

export function findDuplicateImport(ctx: Ctx, eid: string, hash: string) {
  return ctx.db.get<{ id: string; code: string; created_at: string }>(
    `SELECT si.id, si.code, si.created_at FROM scan_imports si JOIN evidence e ON e.id = si.evidence_id
     WHERE si.engagement_id = ? AND e.sha256 = ? AND si.status <> 'failed' ORDER BY si.created_at LIMIT 1`,
    eid, hash,
  );
}

/** Build the preview object (nothing is written). */
export function previewScan(ctx: Ctx, eng: Row, buf: Buffer, filename: string, forced?: ScanFormat) {
  const parsed = parseScanFile(buf, filename, eng.timezone || 'UTC', forced);
  const hash = sha256(buf);
  const dup = findDuplicateImport(ctx, eng.id, hash);
  const { db } = ctx;
  let newServices = 0, existingServices = 0, newAssets = 0;
  const hosts = parsed.hosts.map((h) => {
    const asset = h.ip ? db.get('SELECT id, code FROM assets WHERE engagement_id = ? AND ip = ?', eng.id, h.ip) : undefined;
    if (!asset) newAssets++;
    for (const p of h.ports) {
      const ex = asset ? db.get('SELECT id FROM services WHERE asset_id = ? AND port = ? AND protocol = ?', asset.id, p.port, p.protocol) : undefined;
      ex ? existingServices++ : newServices++;
    }
    return {
      ip: h.ip, hostname: h.hostname, hostnames: h.hostnames, state: h.state, os: h.os_text, observed_at: h.observed_at,
      port_count: h.ports.length, open_count: h.ports.filter((p) => p.state === 'open').length,
      existing_asset: asset ? asset.code : null,
      scope: checkScope(db, eng.id, h.ip, h.hostname),
    };
  });
  const observations = parsed.hosts.flatMap((h) => h.ports.map((p) => ({ ip: h.ip, hostname: h.hostname, ...p }))).slice(0, 500);
  const scopeWarnings = scopeWarningsFor(hosts, eng);
  return {
    filename,
    sha256: hash,
    size_bytes: buf.length,
    format: parsed.format,
    tool: parsed.tool,
    tool_version: parsed.tool_version,
    command: parsed.command,
    started_at: parsed.started_at,
    finished_at: parsed.finished_at,
    parseable: parsed.parseable,
    hosts,
    observations,
    observations_total: observationCount(parsed),
    counts: { hosts: parsed.hosts.length, new_assets: newAssets, new_services: newServices, existing_services: existingServices },
    warnings: [...parsed.warnings, ...scopeWarnings],
    errors: parsed.errors,
    status: !parsed.parseable ? 'failed' : parsed.errors.length ? 'partial' : 'complete',
    duplicate_of: dup ? { id: dup.id, code: dup.code, created_at: dup.created_at } : null,
  };
}

function scopeWarningsFor(hosts: { ip: string | null; scope: { status: string } }[], eng: Row): string[] {
  const w: string[] = [];
  const excluded = hosts.filter((h) => h.scope.status === 'excluded').map((h) => h.ip);
  const outside = hosts.filter((h) => h.scope.status === 'not_in_scope').map((h) => h.ip);
  if (excluded.length) w.push(`SCOPE: ${excluded.join(', ')} match an explicitly EXCLUDED target. Confirm with your instructor before using these results.`);
  if (outside.length) w.push(`SCOPE: ${outside.join(', ')} are not covered by any authorized target in this engagement.`);
  if (hosts.length && hosts.every((h) => h.scope.status === 'no_scope_defined')) w.push('SCOPE: No authorized targets are defined yet, so these hosts cannot be checked against scope.');
  return w;
}

export interface CommitOptions {
  sourceCategory: SourceCategory;
  collectedAt?: string | null;
  allowDuplicate?: boolean;
  storeRaw?: boolean;
  forced?: ScanFormat;
  title?: string;
}

/**
 * Commit a scan import. Writes evidence (original bytes + SHA-256), the scan_imports row, assets,
 * append-only service_observations, and upserts the current services inventory.
 */
export function commitScan(ctx: Ctx, eng: Row, buf: Buffer, filename: string, opts: CommitOptions) {
  const { db, cfg } = ctx;
  const parsed = parseScanFile(buf, filename, eng.timezone || 'UTC', opts.forced);
  const hash = sha256(buf);
  const dup = findDuplicateImport(ctx, eng.id, hash);
  if (dup && !opts.allowDuplicate)
    throw conflict(`This exact file (same SHA-256) was already imported as ${dup.code}. Re-importing it would not add new information.`, { duplicate_of: dup.code, duplicate_import_id: dup.id });
  if (!parsed.parseable && !opts.storeRaw)
    throw badRequest('No hosts or services could be read from this file. Nothing was imported. Enable “store as raw evidence” to keep the file anyway.', { errors: parsed.errors, warnings: parsed.warnings });

  const isDemo = !!eng.is_demo;
  const sourceCategory: SourceCategory = isDemo ? 'demo' : opts.sourceCategory;
  const toolLabel = parsed.format === 'nmap_xml' ? `Nmap${parsed.tool_version ? ' ' + parsed.tool_version : ''}` : parsed.tool;
  const collectedAt = opts.collectedAt || parsed.finished_at || parsed.started_at || null;
  const now = nowIso();
  let evidenceInfo: { id: string; code: string } | null = null;

  try {
    return db.tx(() => {
      const ev = storeFileEvidence(db, cfg, {
        engagementId: eng.id,
        buffer: buf,
        originalFilename: filename,
        sourceCategory,
        sourceTool: toolLabel,
        title: opts.title || `${parsed.parseable ? 'Scan output' : 'Raw scan output (not parsed)'}: ${filename}`,
        collectedAt,
        collectedAtNote: opts.collectedAt ? 'Entered by analyst at import.' : collectedAt ? 'Taken from the scan file timestamps.' : 'The file has no timestamps and none was entered.',
        observation: parsed.parseable
          ? `${parsed.hosts.length} host(s) and ${observationCount(parsed)} port observation(s) parsed from ${parsed.format === 'nmap_xml' ? 'Nmap XML' : parsed.format.toUpperCase()}.${parsed.command ? ` Command recorded in file: ${parsed.command}` : ''}`
          : 'Stored as raw evidence. The file could not be parsed into hosts or services.',
        tags: ['scan', parsed.format],
        analysisStatus: parsed.parseable ? 'parsed' : 'not_parsed',
        analysisNote: parsed.parseable ? 'Parsed by the CyberDome scan importer.' : 'Unparsed. Retained unchanged as raw evidence.',
      });
      evidenceInfo = ev;
      const code = nextCode(db, eng.id, 'scan_import');
      const importId = uid();
      const status = !parsed.parseable ? 'stored_only' : parsed.errors.length ? 'partial' : 'complete';
      const warnings = [...parsed.warnings];
      let newAssets = 0, newServices = 0, updatedServices = 0, unchangedServices = 0, historyOnly = 0, versionLost = 0;
      const assetIds = new Set<string>();
      let hostsUp = 0;

      db.insert('scan_imports', {
        id: importId, engagement_id: eng.id, code, evidence_id: ev.id,
        format: parsed.parseable ? parsed.format : 'raw_text',
        tool: toolLabel, tool_version: parsed.tool_version, command_line: parsed.command,
        scan_started_at: parsed.started_at, scan_finished_at: parsed.finished_at, status,
        hosts_total: parsed.hosts.length, duplicate_of_import_id: dup?.id ?? null,
        warnings: [], errors: parsed.errors, created_by: currentActor(db), created_at: now,
      });

      for (const h of parsed.hosts) {
        if (!h.ip) continue;
        if (h.state === 'up') hostsUp++;
        const seen = h.observed_at ?? collectedAt ?? null;
        let asset = db.get('SELECT * FROM assets WHERE engagement_id = ? AND ip = ?', eng.id, h.ip);
        if (!asset) {
          const aid = uid();
          db.insert('assets', {
            id: aid, engagement_id: eng.id, code: nextCode(db, eng.id, 'asset'), ip: h.ip, hostname: h.hostname ?? '',
            hostnames: h.hostnames, mac: h.mac, os_name: h.os_text ? (h.os_matches[0]?.name ?? h.os_text) : null,
            os_accuracy: h.os_matches[0]?.accuracy ?? null, os_source: h.os_text ? 'detected' : 'unknown',
            host_state: h.state, origin: 'import', first_seen: seen, last_seen: seen, created_at: now, updated_at: now,
          });
          asset = db.get('SELECT * FROM assets WHERE id = ?', aid)!;
          newAssets++;
        } else {
          const names = new Set<string>(parseJson<string[]>(asset.hostnames, []));
          h.hostnames.forEach((n) => names.add(n));
          const newer = !asset.last_seen || (seen && seen >= asset.last_seen);
          db.update('assets', asset.id, {
            hostnames: [...names],
            hostname: asset.hostname || h.hostname || '',
            mac: asset.mac || h.mac,
            ...(asset.os_source !== 'analyst' && h.os_text && newer
              ? { os_name: h.os_matches[0]?.name ?? h.os_text, os_accuracy: h.os_matches[0]?.accuracy ?? null, os_source: 'detected' }
              : {}),
            host_state: newer ? h.state : asset.host_state,
            first_seen: asset.first_seen && seen && seen > asset.first_seen ? asset.first_seen : (seen ?? asset.first_seen),
            last_seen: newer ? (seen ?? asset.last_seen) : asset.last_seen,
            updated_at: now,
          });
        }
        assetIds.add(asset.id);

        for (const p of h.ports) {
          const obsId = uid();
          db.insert('service_observations', {
            id: obsId, engagement_id: eng.id, scan_import_id: importId, asset_id: asset.id, evidence_id: ev.id,
            ip_observed: h.ip, hostname_observed: h.hostname, port: p.port, protocol: p.protocol, state: p.state, reason: p.reason,
            service_name: p.service_name, product: p.product, version: p.version, extra_info: p.extra_info,
            version_status: p.version_status, service_method: p.service_method, service_conf: p.service_conf,
            os_observation: h.os_text, observed_at: p.observed_at ?? seen, created_at: now,
          });
          // Ordering key: observation time when known; otherwise the import time.
          const t = p.observed_at ?? seen ?? now;
          const cur = db.get('SELECT * FROM services WHERE asset_id = ? AND port = ? AND protocol = ?', asset.id, p.port, p.protocol);
          if (!cur) {
            db.insert('services', {
              id: uid(), engagement_id: eng.id, asset_id: asset.id, port: p.port, protocol: p.protocol, state: p.state,
              service_name: p.service_name, product: p.product, version: p.version, extra_info: p.extra_info, version_status: p.version_status,
              first_seen: t, last_seen: t, last_observation_id: obsId, last_scan_import_id: importId, observation_count: 1,
              analyst_notes: p.notes && p.service_method === 'analyst_supplied' ? p.notes : '',
              created_at: now, updated_at: now,
            });
            newServices++;
          } else if (!cur.last_seen || t >= cur.last_seen) {
            const changed = ['state', 'service_name', 'product', 'version', 'version_status'].some((k) => (cur[k] ?? null) !== ((p as any)[k] ?? null));
            if (cur.version_status === 'detected' && p.version_status === 'unknown' && p.state === cur.state) versionLost++;
            db.update('services', cur.id, {
              state: p.state, service_name: p.service_name, product: p.product, version: p.version, extra_info: p.extra_info,
              version_status: p.version_status, last_seen: t, first_seen: cur.first_seen && cur.first_seen < t ? cur.first_seen : t,
              last_observation_id: obsId, last_scan_import_id: importId, observation_count: cur.observation_count + 1, updated_at: now,
            });
            changed ? updatedServices++ : unchangedServices++;
          } else {
            db.update('services', cur.id, {
              observation_count: cur.observation_count + 1,
              first_seen: !cur.first_seen || t < cur.first_seen ? t : cur.first_seen,
              updated_at: now,
            });
            historyOnly++;
          }
        }
      }
      for (const a of assetIds) db.run('INSERT OR IGNORE INTO evidence_assets (evidence_id, asset_id) VALUES (?,?)', ev.id, a);

      if (historyOnly) warnings.push(`${historyOnly} observation(s) are older than the current inventory; they were added to service history without changing current state.`);
      if (versionLost) warnings.push(`${versionLost} service(s) had a detected version in an earlier scan, but this newer scan did not detect a version; current inventory now shows the version as unknown (earlier detections remain in history).`);
      if (dup) warnings.push(`This file is identical to ${dup.code}; it was recorded as a separate scan run at the analyst's request. Inventory totals are unaffected because services are unique per asset, port, and protocol.`);
      const hostInfo = parsed.hosts.map((h) => ({ ip: h.ip, scope: checkScope(db, eng.id, h.ip, h.hostname) }));
      warnings.push(...scopeWarningsFor(hostInfo, eng));

      db.update('scan_imports', importId, {
        hosts_up: hostsUp, observations_count: observationCount(parsed), new_assets: newAssets, new_services: newServices,
        updated_services: updatedServices, unchanged_services: unchangedServices + historyOnly, warnings,
      });
      logActivity(
        db, eng.id, 'scan.imported', 'scan_import',
        parsed.parseable
          ? `Imported ${code} from ${filename} (${ev.code}): ${parsed.hosts.length} hosts, ${newServices} new / ${updatedServices} updated services${status === 'partial' ? ' — partial import with row errors' : ''}`
          : `Stored ${filename} as raw scan evidence ${ev.code} (${code}, not parsed)`,
        { id: importId, code },
      );
      return { id: importId, code, status, evidence_id: ev.id, evidence_code: ev.code, new_assets: newAssets, new_services: newServices, updated_services: updatedServices, unchanged_services: unchangedServices, history_only: historyOnly, warnings, errors: parsed.errors };
    });
  } catch (e) {
    // The evidence row rolled back with the transaction; remove its stored bytes too.
    if (evidenceInfo) fs.rmSync(path.join(cfg.evidenceDir, eng.id, hash.slice(0, 2), `${(evidenceInfo as { id: string }).id}.bin`), { force: true });
    throw e;
  }
}
