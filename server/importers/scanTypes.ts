/** Normalized scan structures shared by all scan importers (Nmap XML, CSV, JSON). */
export type VersionStatus = 'detected' | 'inferred' | 'unknown';

export interface ParsedPort {
  port: number;
  protocol: string;
  state: string;
  reason: string | null;
  service_name: string | null;
  product: string | null;
  version: string | null;
  extra_info: string | null;
  version_status: VersionStatus;
  service_method: string | null;
  service_conf: number | null;
  observed_at: string | null;
  notes: string | null;
  row?: number;
}

export interface ParsedHost {
  ip: string | null;
  hostname: string | null;
  hostnames: string[];
  mac: string | null;
  state: 'up' | 'down' | 'unknown';
  os_matches: { name: string; accuracy: number | null }[];
  os_text: string | null;
  observed_at: string | null;
  ports: ParsedPort[];
}

export interface ParseIssue {
  row?: number;
  message: string;
}

export interface ParsedScan {
  format: 'nmap_xml' | 'csv' | 'json' | 'raw_text';
  tool: string;
  tool_version: string | null;
  command: string | null;
  started_at: string | null;
  finished_at: string | null;
  hosts: ParsedHost[];
  warnings: string[];
  errors: ParseIssue[];
  /** False when nothing usable could be extracted (file may still be kept as raw evidence). */
  parseable: boolean;
}

export const PORT_STATES = ['open', 'closed', 'filtered', 'unfiltered', 'open|filtered', 'closed|filtered'];
export const PROTOCOLS = ['tcp', 'udp', 'sctp', 'ip'];

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isIp = (s: string) => IPV4.test(s) || (/^[0-9a-f:]+$/i.test(s) && s.includes(':') && s.length >= 3);

export const emptyScan = (format: ParsedScan['format']): ParsedScan => ({
  format, tool: '', tool_version: null, command: null, started_at: null, finished_at: null, hosts: [], warnings: [], errors: [], parseable: false,
});

export const observationCount = (s: ParsedScan) => s.hosts.reduce((a, h) => a + h.ports.length, 0);
