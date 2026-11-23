/** Shared frontend types. Module-specific types live next to their pages. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'unrated' | 'high' | 'medium' | 'low' | 'requires_more_evidence';
export type SourceCategory = 'authorized_lab' | 'instructor_supplied' | 'external_reference' | 'demo' | 'project_artifact';
export type Sanitization = 'not_reviewed' | 'sanitized' | 'no_sensitive_data' | 'contains_sensitive';

export interface EngagementSummary {
  id: string;
  name: string;
  client_name: string;
  status: string;
  is_demo: boolean;
  authorization_status: 'unconfirmed' | 'confirmed';
  created_at: string;
  updated_at: string;
}

export interface ScopeEntry {
  id: string;
  kind: 'in' | 'out';
  target: string;
  target_type: string;
  notes: string;
  confirmed: boolean;
  confirmed_by: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  responsibilities: string;
  contributions: string;
}

export interface Engagement extends EngagementSummary {
  purpose: string;
  authorization_ref: string;
  authorization_confirmed_by: string | null;
  authorization_confirmed_at: string | null;
  window_start: string | null;
  window_end: string | null;
  timezone: string;
  rules_of_engagement: string;
  prohibited_actions: string;
  approved_evidence_sources: string;
  scope: ScopeEntry[];
  team: TeamMember[];
}

export interface EvidenceBrief {
  id: string;
  code: string;
  title: string;
  status: 'active' | 'withdrawn';
  source_category?: SourceCategory;
  sanitization_status?: Sanitization;
}

export interface Evidence extends EvidenceBrief {
  kind: 'file' | 'reference' | 'text';
  original_filename: string | null;
  mime_type: string | null;
  detected_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  reference_uri: string | null;
  source_category: SourceCategory;
  source_tool: string;
  collected_at: string | null;
  collected_at_note: string;
  imported_at: string;
  observation: string;
  interpretation: string;
  confidence: Confidence;
  tags: string[];
  sanitization_status: Sanitization;
  derived_from_id: string | null;
  derivation_note: string;
  analysis_status: string;
  analysis_note: string;
  withdrawn_reason: string | null;
  finding_links?: number;
  timeline_links?: number;
  recon_links?: number;
  indicator_links?: number;
  asset_labels?: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface AssetBrief {
  id: string;
  code: string;
  ip: string | null;
  hostname: string;
}

export interface StatusInfo {
  database: { state: string; schemaVersion?: number; file?: string; message?: string };
  ai: { state: 'configured' | 'not_configured' | 'misconfigured'; provider: string; model: string | null; endpoint?: string; message?: string };
  references: { online: boolean; nvdApiKey: boolean; nvd: any; kev: any; attack: any };
  tshark: { available: boolean; version: string | null };
  mode: string;
  bind: string;
  maxUploadMb: number;
  serverTime: string;
}
