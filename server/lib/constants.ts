/** AI task types. Lab requirement checks depend on these keys. */
export const AI_TASKS = {
  assessment_summary: { label: 'Summarize selected assessment evidence', lab: 'lab6' },
  top_risks: { label: 'Identify the top three supported risks', lab: 'lab6' },
  explain_nontechnical: { label: 'Explain a finding in non-technical language', lab: 'lab4' },
  next_step: { label: 'Recommend a next authorized investigative step', lab: 'lab6' },
  remediation_priorities: { label: 'Draft remediation priorities', lab: 'lab6' },
  attack_mapping: { label: 'Suggest MITRE ATT&CK mappings', lab: 'lab6' },
  executive_summary: { label: 'Draft an executive summary', lab: 'lab6' },
  recon_summary: { label: 'Summarize reconnaissance evidence', lab: 'lab2' },
  scan_interpretation: { label: 'Interpret completed scan results', lab: 'lab3' },
  timeline_summary: { label: 'Summarize the attack timeline', lab: 'lab5' },
  custom: { label: 'Custom evidence-grounded question', lab: null },
  general_question: { label: 'General question (no evidence sent)', lab: null },
} as const;
export type AiTask = keyof typeof AI_TASKS;

export const VERIFIED_REVIEW = ['verified', 'verified_with_edits'];

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

/** Final due date and checkpoints from the NWIT 246 packet (Fall 2026). */
export const CHECKPOINTS = [
  { key: 'cp1', date: '2026-09-21', label: 'Checkpoint 1: Team, project name, platform choice, PRD draft', check: 'Instructor approval' },
  { key: 'cp2', date: '2026-10-05', label: 'Checkpoint 2: Working UI shell with Engagement and Recon navigation', check: 'Demo in class' },
  { key: 'cp3', date: '2026-10-19', label: 'Checkpoint 3: Scanning/Enumeration data visible in dashboard', check: 'Evidence review' },
  { key: 'cp4', date: '2026-11-02', label: 'Checkpoint 4: Vulnerability page with severity and remediation fields', check: 'Risk review' },
  { key: 'cp5', date: '2026-11-09', label: 'Checkpoint 5: Attack Evidence page with timeline and evidence IDs', check: 'Analysis review' },
  { key: 'cp6', date: '2026-11-16', label: 'Checkpoint 6: AI Analyst working against sanitized project evidence', check: 'Beta demo' },
  { key: 'final', date: '2026-11-23', label: 'Final: Complete submission and presentation-ready platform', check: 'Final grading' },
];
export const FINAL_DUE = '2026-11-23';
