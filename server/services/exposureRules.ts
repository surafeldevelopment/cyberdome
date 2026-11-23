import type { Ctx } from '../app.js';
import type { Row } from '../db/index.js';
import { nextCode, nowIso, uid } from '../lib/codes.js';

/**
 * Exposure rules: turn open services that real scans observed into findings that an analyst
 * must verify. Each finding is labeled "Scanner-reported" (never validated automatically), links
 * the asset, the service, and the scan evidence that observed it, and states the observation.
 * Impact and remediation are left for the analyst to write.
 */
export interface ExposureRule {
  key: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  ports: number[];
  services: string[];
  title: string;
  why: string;
  typicalFix: string;
}

export const EXPOSURE_RULES: ExposureRule[] = [
  { key: 'telnet', severity: 'high', ports: [23], services: ['telnet'], title: 'Telnet remote login exposed', why: 'Telnet sends credentials and session data in cleartext.', typicalFix: 'Disable Telnet and use SSH, or restrict it to a management network.' },
  { key: 'vnc', severity: 'high', ports: [5900, 5901, 5902], services: ['vnc'], title: 'VNC remote desktop exposed', why: 'VNC is often weakly authenticated and gives full desktop control.', typicalFix: 'Restrict VNC to a VPN or management network and require strong authentication.' },
  { key: 'database', severity: 'high', ports: [1433, 1521, 3306, 5432, 6379, 9200, 27017], services: ['mysql', 'postgresql', 'ms-sql-s', 'oracle', 'oracle-tns', 'redis', 'mongodb', 'mongod', 'elasticsearch', 'wap-wsp'], title: 'Database service reachable over the network', why: 'Databases reachable from untrusted networks invite credential attacks and data theft.', typicalFix: 'Bind the database to localhost or an internal interface and firewall the port.' },
  { key: 'smb', severity: 'medium', ports: [139, 445], services: ['microsoft-ds', 'netbios-ssn', 'smb'], title: 'SMB file sharing reachable', why: 'SMB is a common path for lateral movement and has a long history of critical flaws.', typicalFix: 'Block SMB at the network edge, disable SMBv1, and keep the host patched.' },
  { key: 'rdp', severity: 'medium', ports: [3389], services: ['ms-wbt-server', 'rdp'], title: 'Remote Desktop (RDP) reachable', why: 'Exposed RDP is a frequent target for password spraying and exploitation.', typicalFix: 'Put RDP behind a VPN or gateway, enable Network Level Authentication, and limit who can log in.' },
  { key: 'winrm', severity: 'medium', ports: [5985, 5986], services: ['wsman', 'wsmans'], title: 'Windows Remote Management (WinRM) reachable', why: 'WinRM allows remote command execution with valid credentials.', typicalFix: 'Restrict WinRM to administrative hosts and require HTTPS.' },
  { key: 'ftp', severity: 'medium', ports: [21], services: ['ftp'], title: 'FTP service exposed', why: 'FTP usually sends credentials in cleartext and may allow anonymous access.', typicalFix: 'Replace FTP with SFTP or FTPS and disable anonymous login.' },
  { key: 'http_cleartext', severity: 'low', ports: [80, 8000, 8008, 8080], services: ['http', 'http-proxy', 'http-alt'], title: 'Web service without TLS', why: 'Traffic to this web service is not encrypted.', typicalFix: 'Serve the site over HTTPS and redirect HTTP to HTTPS.' },
];

function ruleFor(s: Row): ExposureRule | null {
  if (s.state !== 'open' || s.protocol !== 'tcp') return null;
  const name = String(s.service_name ?? '').toLowerCase();
  if (/ssl|https|tls/.test(name) || /ssl|tls/i.test(String(s.extra_info ?? ''))) {
    // Encrypted variants are not the cleartext rule; other rules still apply by port.
    const r = EXPOSURE_RULES.find((x) => x.key !== 'http_cleartext' && x.ports.includes(s.port));
    return r ?? null;
  }
  return EXPOSURE_RULES.find((x) => x.services.includes(name)) ?? EXPOSURE_RULES.find((x) => x.ports.includes(s.port)) ?? null;
}

export interface RuleResult {
  created: { id: string; code: string; title: string; severity: string; asset: string }[];
  already: number;
  services_checked: number;
}

export function applyExposureRules(ctx: Ctx, eng: Row): RuleResult {
  const { db } = ctx;
  const services = db.all(
    `SELECT s.*, a.ip, a.hostname, a.code AS asset_code, si.code AS scan_code, si.evidence_id, e.code AS evidence_code
     FROM services s JOIN assets a ON a.id = s.asset_id
     LEFT JOIN scan_imports si ON si.id = s.last_scan_import_id LEFT JOIN evidence e ON e.id = si.evidence_id
     WHERE s.engagement_id = ? AND s.state = 'open'`,
    eng.id,
  );
  const out: RuleResult = { created: [], already: 0, services_checked: services.length };
  db.tx(() => {
    for (const s of services) {
      const rule = ruleFor(s);
      if (!rule) continue;
      const dedupe = `rule:${rule.key}:${s.id}`;
      if (db.get('SELECT id FROM findings WHERE engagement_id = ? AND dedupe_key = ?', eng.id, dedupe)) {
        out.already++;
        continue;
      }
      const host = s.ip ?? s.hostname;
      const svc = [s.product, s.version].filter(Boolean).join(' ') || s.service_name || 'unidentified service';
      const id = uid();
      const code = nextCode(db, eng.id, 'finding');
      const now = nowIso();
      const title = `${rule.title} on ${host}:${s.port}`;
      db.insert('findings', {
        id, engagement_id: eng.id, code, title,
        description:
          `Observed: Nmap reported ${host} port ${s.port}/${s.protocol} open, identified as ${svc}` +
          `${s.scan_code ? ` (${s.scan_code}${s.evidence_code ? `, ${s.evidence_code}` : ''})` : ''}.\n\n` +
          `Why it can matter: ${rule.why}\n\nCommon fix to evaluate: ${rule.typicalFix}\n\n` +
          `Raised automatically by the CyberDome exposure rule "${rule.key}". Verify it against the evidence, then write the impact and remediation in your own words.`,
        severity: rule.severity, severity_basis: 'scanner', validation_status: 'scanner_reported', status: 'open',
        scanner_name: 'CyberDome exposure rules', scanner_plugin_id: rule.key, dedupe_key: dedupe, origin: 'import',
        created_at: now, updated_at: now,
      });
      db.run('INSERT OR IGNORE INTO finding_assets (finding_id, asset_id) VALUES (?,?)', id, s.asset_id);
      db.run('INSERT OR IGNORE INTO finding_services (finding_id, service_id) VALUES (?,?)', id, s.id);
      if (s.evidence_id) db.run('INSERT OR IGNORE INTO finding_evidence (finding_id, evidence_id) VALUES (?,?)', id, s.evidence_id);
      out.created.push({ id, code, title, severity: rule.severity, asset: host });
    }
  });
  return out;
}
