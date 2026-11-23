/**
 * Reproducible, ordered schema migrations. Each migration runs once inside a
 * transaction and is recorded in schema_migrations. Never edit a migration that
 * has shipped — add a new one instead.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: /* sql */ `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE engagements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  authorization_ref TEXT NOT NULL DEFAULT '',
  authorization_status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (authorization_status IN ('unconfirmed','confirmed')),
  authorization_confirmed_by TEXT,
  authorization_confirmed_at TEXT,
  window_start TEXT,
  window_end TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  rules_of_engagement TEXT NOT NULL DEFAULT '',
  prohibited_actions TEXT NOT NULL DEFAULT '',
  approved_evidence_sources TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','reporting','complete','on_hold')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scope_entries (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('in','out')),
  target TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'other' CHECK (target_type IN ('cidr','ip','range','domain','url','hostname','other')),
  notes TEXT NOT NULL DEFAULT '',
  confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_scope_eng ON scope_entries(engagement_id);

CREATE TABLE team_members (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  responsibilities TEXT NOT NULL DEFAULT '',
  contributions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Monotonic per-engagement counters for human-readable codes (EV-001, FND-001 ...).
-- Values are never decremented, so deleted/withdrawn codes are never reused.
CREATE TABLE counters (
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (engagement_id, kind)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  ip TEXT,
  hostname TEXT NOT NULL DEFAULT '',
  hostnames TEXT NOT NULL DEFAULT '[]',
  mac TEXT,
  os_name TEXT,
  os_accuracy INTEGER,
  os_source TEXT NOT NULL DEFAULT 'unknown' CHECK (os_source IN ('detected','analyst','unknown')),
  criticality TEXT NOT NULL DEFAULT 'unknown' CHECK (criticality IN ('unknown','low','medium','high','critical')),
  role TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  host_state TEXT NOT NULL DEFAULT 'unknown',
  origin TEXT NOT NULL DEFAULT 'import' CHECK (origin IN ('import','manual')),
  first_seen TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);
CREATE UNIQUE INDEX idx_assets_ip ON assets(engagement_id, ip) WHERE ip IS NOT NULL;

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('file','reference','text')),
  original_filename TEXT,
  mime_type TEXT,
  detected_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  storage_path TEXT,
  reference_uri TEXT,
  source_category TEXT NOT NULL CHECK (source_category IN ('authorized_lab','instructor_supplied','external_reference','demo','project_artifact')),
  source_tool TEXT NOT NULL DEFAULT '',
  collected_at TEXT,
  collected_at_note TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  observation TEXT NOT NULL DEFAULT '',
  interpretation TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'unrated' CHECK (confidence IN ('unrated','high','medium','low','requires_more_evidence')),
  tags TEXT NOT NULL DEFAULT '[]',
  sanitization_status TEXT NOT NULL DEFAULT 'not_reviewed' CHECK (sanitization_status IN ('not_reviewed','sanitized','no_sensitive_data','contains_sensitive')),
  derived_from_id TEXT REFERENCES evidence(id),
  derivation_note TEXT NOT NULL DEFAULT '',
  analysis_status TEXT NOT NULL DEFAULT 'stored_only',
  analysis_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  withdrawn_reason TEXT,
  withdrawn_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);
CREATE INDEX idx_evidence_eng ON evidence(engagement_id);
CREATE INDEX idx_evidence_sha ON evidence(engagement_id, sha256);

CREATE TABLE evidence_assets (
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (evidence_id, asset_id)
);

CREATE TABLE evidence_reviews (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  reviewer TEXT NOT NULL,
  action TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE scan_imports (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  evidence_id TEXT REFERENCES evidence(id),
  format TEXT NOT NULL CHECK (format IN ('nmap_xml','csv','json','raw_text')),
  tool TEXT NOT NULL DEFAULT '',
  tool_version TEXT,
  command_line TEXT,
  scan_started_at TEXT,
  scan_finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('complete','partial','failed','stored_only')),
  hosts_total INTEGER NOT NULL DEFAULT 0,
  hosts_up INTEGER NOT NULL DEFAULT 0,
  observations_count INTEGER NOT NULL DEFAULT 0,
  new_assets INTEGER NOT NULL DEFAULT 0,
  new_services INTEGER NOT NULL DEFAULT 0,
  updated_services INTEGER NOT NULL DEFAULT 0,
  unchanged_services INTEGER NOT NULL DEFAULT 0,
  duplicate_of_import_id TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  errors TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);

-- Historical, append-only record of every service observation from every scan.
CREATE TABLE service_observations (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  scan_import_id TEXT NOT NULL REFERENCES scan_imports(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence(id),
  ip_observed TEXT,
  hostname_observed TEXT,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL,
  state TEXT NOT NULL,
  reason TEXT,
  service_name TEXT,
  product TEXT,
  version TEXT,
  extra_info TEXT,
  version_status TEXT NOT NULL DEFAULT 'unknown' CHECK (version_status IN ('detected','inferred','unknown')),
  service_method TEXT,
  service_conf INTEGER,
  os_observation TEXT,
  observed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_obs_asset ON service_observations(asset_id, port, protocol);
CREATE INDEX idx_obs_import ON service_observations(scan_import_id);

-- Current inventory: exactly one row per (asset, port, protocol).
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL,
  state TEXT NOT NULL,
  service_name TEXT,
  product TEXT,
  version TEXT,
  extra_info TEXT,
  version_status TEXT NOT NULL DEFAULT 'unknown' CHECK (version_status IN ('detected','inferred','unknown')),
  first_seen TEXT,
  last_seen TEXT,
  last_observation_id TEXT,
  last_scan_import_id TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0,
  normal_purpose TEXT NOT NULL DEFAULT '',
  analyst_notes TEXT NOT NULL DEFAULT '',
  needs_investigation INTEGER NOT NULL DEFAULT 0,
  investigation_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (asset_id, port, protocol)
);
CREATE INDEX idx_services_eng ON services(engagement_id);

CREATE TABLE recon_observations (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('domain','ip_range','technology','naming_pattern','public_info','osint_artifact','other')),
  classification TEXT NOT NULL CHECK (classification IN ('asset_discovery','technology_discovery','identity_discovery','attack_surface')),
  value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  source_category TEXT NOT NULL DEFAULT 'instructor_supplied',
  collected_at TEXT,
  analyst_notes TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','disputed')),
  verified_by TEXT,
  verified_at TEXT,
  next_step TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);
CREATE TABLE recon_evidence (
  recon_id TEXT NOT NULL REFERENCES recon_observations(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (recon_id, evidence_id)
);

CREATE TABLE finding_imports (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  evidence_id TEXT REFERENCES evidence(id),
  format TEXT NOT NULL,
  scanner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  rows_total INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  warnings TEXT NOT NULL DEFAULT '[]',
  errors TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  severity_basis TEXT NOT NULL DEFAULT 'analyst' CHECK (severity_basis IN ('scanner','analyst','cvss')),
  cves TEXT NOT NULL DEFAULT '[]',
  cvss_score REAL,
  cvss_version TEXT,
  cvss_vector TEXT,
  cvss_source TEXT,
  impact TEXT NOT NULL DEFAULT '',
  remediation TEXT NOT NULL DEFAULT '',
  validation_status TEXT NOT NULL DEFAULT 'potential' CHECK (validation_status IN ('scanner_reported','potential','validated','false_positive')),
  validation_notes TEXT NOT NULL DEFAULT '',
  validated_by TEXT,
  validated_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','remediated','risk_accepted')),
  owner TEXT NOT NULL DEFAULT '',
  priority_rank INTEGER CHECK (priority_rank IS NULL OR priority_rank BETWEEN 1 AND 3),
  priority_rationale TEXT NOT NULL DEFAULT '',
  f_evidence_strength INTEGER,
  f_exposure INTEGER,
  f_impact INTEGER,
  f_asset_importance INTEGER,
  f_remediation_available INTEGER,
  retest_notes TEXT NOT NULL DEFAULT '',
  scanner_name TEXT,
  scanner_plugin_id TEXT,
  dedupe_key TEXT,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('import','manual')),
  import_id TEXT REFERENCES finding_imports(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);
CREATE INDEX idx_findings_eng ON findings(engagement_id);
CREATE INDEX idx_findings_dedupe ON findings(engagement_id, dedupe_key);
CREATE TABLE finding_assets (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (finding_id, asset_id)
);
CREATE TABLE finding_services (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (finding_id, service_id)
);
CREATE TABLE finding_evidence (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (finding_id, evidence_id)
);

CREATE TABLE remediation_tasks (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','wont_fix')),
  due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE indicators (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  lab TEXT NOT NULL CHECK (lab IN ('lab1','lab5')),
  title TEXT NOT NULL,
  indicator_type TEXT NOT NULL DEFAULT 'other',
  value TEXT NOT NULL DEFAULT '',
  observation TEXT NOT NULL DEFAULT '',
  why_suspicious TEXT NOT NULL DEFAULT '',
  benign_explanations TEXT NOT NULL DEFAULT '',
  additional_evidence_needed TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'unrated' CHECK (confidence IN ('unrated','high','medium','low','requires_more_evidence')),
  assessment TEXT NOT NULL DEFAULT 'unassessed' CHECK (assessment IN ('unassessed','suspicious','benign','requires_more_evidence')),
  analyst_assessment TEXT NOT NULL DEFAULT '',
  source_host TEXT NOT NULL DEFAULT '',
  dest_host TEXT NOT NULL DEFAULT '',
  observed_at TEXT,
  observed_at_original TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);
CREATE TABLE indicator_evidence (
  indicator_id TEXT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (indicator_id, evidence_id)
);

CREATE TABLE log_imports (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  evidence_id TEXT REFERENCES evidence(id),
  format TEXT NOT NULL,
  source_timezone TEXT,
  status TEXT NOT NULL,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  analysis_scope TEXT NOT NULL DEFAULT '',
  warnings TEXT NOT NULL DEFAULT '[]',
  errors TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);

CREATE TABLE log_events (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  log_import_id TEXT NOT NULL REFERENCES log_imports(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence(id),
  row_number INTEGER NOT NULL,
  original_timestamp TEXT,
  normalized_ts TEXT,
  ts_status TEXT NOT NULL CHECK (ts_status IN ('explicit_offset','assumed_timezone','missing','unparseable')),
  source TEXT,
  destination TEXT,
  src_port INTEGER,
  dst_port INTEGER,
  protocol TEXT,
  event_type TEXT,
  message TEXT,
  raw TEXT NOT NULL DEFAULT '{}',
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_log_events_eng ON log_events(engagement_id, normalized_ts);

CREATE TABLE timeline_events (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  original_timestamp TEXT,
  normalized_ts TEXT,
  timezone_note TEXT NOT NULL DEFAULT '',
  time_certainty TEXT NOT NULL DEFAULT 'exact' CHECK (time_certainty IN ('exact','approximate','unknown')),
  order_certainty TEXT NOT NULL DEFAULT 'established' CHECK (order_certainty IN ('established','uncertain')),
  sequence_hint INTEGER,
  source_host TEXT NOT NULL DEFAULT '',
  dest_host TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  observation TEXT NOT NULL,
  student_interpretation TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'unrated' CHECK (confidence IN ('unrated','high','medium','low','requires_more_evidence')),
  verification_status TEXT NOT NULL DEFAULT 'requires_more_evidence' CHECK (verification_status IN ('fact','assumption','requires_more_evidence')),
  log_event_id TEXT REFERENCES log_events(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);
CREATE TABLE timeline_evidence (
  timeline_id TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (timeline_id, evidence_id)
);

CREATE TABLE ai_sessions (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  task_type TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  evidence_codes TEXT NOT NULL DEFAULT '[]',
  context_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  error TEXT,
  response_text TEXT,
  citations TEXT NOT NULL DEFAULT '{}',
  attack_ids TEXT NOT NULL DEFAULT '[]',
  usage TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'unverified' CHECK (review_status IN ('unverified','verified','verified_with_edits','rejected')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (engagement_id, code)
);

CREATE TABLE human_reviews (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  decision TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  edited_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reviews_target ON human_reviews(target_type, target_id);

CREATE TABLE attack_mappings (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('finding','timeline','indicator')),
  target_id TEXT NOT NULL,
  technique_id TEXT NOT NULL,
  technique_name TEXT NOT NULL DEFAULT '',
  tactics TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'analyst' CHECK (origin IN ('analyst','ai_suggested')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','verified','rejected')),
  ai_session_id TEXT REFERENCES ai_sessions(id) ON DELETE SET NULL,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE reference_cache (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('nvd','kev','attack')),
  ref_key TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  data TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','not_found','error')),
  error TEXT,
  origin TEXT NOT NULL DEFAULT 'fetched' CHECK (origin IN ('fetched','imported')),
  retrieved_at TEXT NOT NULL,
  UNIQUE (source, ref_key)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL UNIQUE REFERENCES engagements(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  narrative TEXT NOT NULL DEFAULT '{}',
  narrative_sources TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  finalized_by TEXT,
  finalized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE deliverables (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','done')),
  notes TEXT NOT NULL DEFAULT '',
  evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (engagement_id, key)
);

CREATE TABLE screenshot_requirements (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  lab TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  capture_kind TEXT NOT NULL CHECK (capture_kind IN ('app_view','tool_activity')),
  app_route TEXT,
  evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (engagement_id, key)
);

CREATE TABLE lab_signoffs (
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  lab TEXT NOT NULL,
  signed_off_by TEXT NOT NULL,
  signed_off_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (engagement_id, lab)
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id TEXT REFERENCES engagements(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  entity_code TEXT,
  summary TEXT NOT NULL
);
CREATE INDEX idx_activity_eng ON activity(engagement_id, id DESC);
`,
  },
  {
    version: 2,
    name: 'scan_runs',
    sql: `
CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  profile TEXT NOT NULL,
  target_input TEXT NOT NULL,
  addresses TEXT NOT NULL DEFAULT '[]',
  excluded TEXT NOT NULL DEFAULT '[]',
  args TEXT NOT NULL DEFAULT '[]',
  nmap_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled','interrupted')),
  progress REAL,
  progress_note TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  exit_code INTEGER,
  stderr TEXT NOT NULL DEFAULT '',
  scan_import_id TEXT REFERENCES scan_imports(id) ON DELETE SET NULL,
  evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
  requested_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (engagement_id, code)
);
CREATE INDEX idx_scan_runs_eng ON scan_runs(engagement_id, started_at DESC);
`,
  },
  {
    version: 3,
    name: 'scan_schedules',
    sql: `
CREATE TABLE scan_schedules (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  profile TEXT NOT NULL,
  skip_discovery INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes >= 60),
  ends_at TEXT NOT NULL,
  next_run_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_id TEXT REFERENCES scan_runs(id) ON DELETE SET NULL,
  last_status TEXT,
  last_message TEXT,
  runs_started INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_scan_sched_due ON scan_schedules(enabled, next_run_at);
ALTER TABLE scan_runs ADD COLUMN schedule_id TEXT REFERENCES scan_schedules(id) ON DELETE SET NULL;
`,
  },
  {
    version: 4,
    name: 'autopilot_runs',
    sql: `
CREATE TABLE autopilot_runs (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running','completed','blocked','failed','cancelled','interrupted')),
  options TEXT NOT NULL DEFAULT '{}',
  steps TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_autopilot_eng ON autopilot_runs(engagement_id, started_at DESC);
`,
  },
];
