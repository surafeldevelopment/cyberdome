import type { ReportData } from './assemble.js';
import { SECTION_TITLES } from './assemble.js';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—');
const sevLabel = (s: string) => s[0].toUpperCase() + s.slice(1);
const VALIDATION: Record<string, string> = {
  scanner_reported: 'Scanner-reported (not verified)',
  potential: 'Potential — requires verification',
  validated: 'Analyst-validated',
  false_positive: 'False positive',
};

/** Escape-first mini Markdown → HTML for narrative text. */
export function mdToHtml(text: string): string {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\b((?:DEMO-)?EV-\d{3,})\b/g, '<span class="ev">$1</span>');
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if (h) { flushPara(); closeList(); const lv = Math.min(h[1].length + 2, 5); out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); continue; }
    if (li) {
      flushPara();
      const kind = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  flushPara();
  closeList();
  return out.join('\n');
}

const evList = (items: { code: string; status?: string }[]) =>
  items.length ? items.map((e) => `<span class="ev${e.status === 'withdrawn' ? ' withdrawn' : ''}">${esc(e.code)}</span>`).join(' ') : '<span class="muted">none</span>';

export const REPORT_CSS = `
:root{--ink:#16202c;--muted:#5b6878;--line:#d6dde6;--accent:#0f766e}
*{box-sizing:border-box}body{font-family:'Barlow','Segoe UI',system-ui,sans-serif;color:var(--ink);background:#fff;margin:0;line-height:1.5;font-size:11pt}
.page{max-width:820px;margin:0 auto;padding:36px 40px}
h1{font-size:24pt;margin:0 0 4px;line-height:1.15}h2{font-size:15pt;margin:28px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--ink);break-after:avoid}
h3{font-size:12pt;margin:18px 0 6px;break-after:avoid}h4,h5{font-size:11pt;margin:12px 0 4px}
p{margin:0 0 8px}.muted{color:var(--muted)}.small{font-size:9.5pt}
table{width:100%;border-collapse:collapse;margin:6px 0 12px;font-size:9.5pt}th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}th{background:#f1f4f8}
tr{break-inside:avoid}.mono,code{font-family:'JetBrains Mono',Consolas,monospace;font-size:8.8pt}
.ev{font-family:'JetBrains Mono',Consolas,monospace;font-size:8.5pt;border:1px solid #9cc9c4;background:#ecf7f6;border-radius:3px;padding:0 3px;white-space:nowrap}
.ev.withdrawn{text-decoration:line-through;color:var(--muted)}
.sev{font-weight:700;font-size:8.5pt;border:1px solid;border-radius:3px;padding:0 4px;white-space:nowrap}
.sev-critical{color:#9f1239;border-color:#9f1239}.sev-high{color:#b45309;border-color:#b45309}.sev-medium{color:#854d0e;border-color:#a16207}.sev-low{color:#1e40af;border-color:#1e40af}.sev-info{color:#475569;border-color:#475569}
.flag{display:inline-block;font-size:8.5pt;font-weight:700;padding:1px 6px;border-radius:3px;background:#fef3c7;color:#78350f;border:1px solid #f59e0b}
.finding{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin:10px 0;break-inside:avoid}
.kv{display:grid;grid-template-columns:170px 1fr;gap:3px 12px;font-size:10pt}.kv dt{color:var(--muted)}.kv dd{margin:0}
.banner{padding:8px 12px;border:2px dashed #b45309;color:#78350f;background:#fffbeb;font-weight:700;margin-bottom:14px}
.banner.demo{border-color:#a21caf;color:#701a75;background:#fdf4ff}
.cover{border-bottom:3px solid var(--accent);padding-bottom:14px;margin-bottom:10px}
figure{margin:10px 0;break-inside:avoid}figure img{max-width:100%;border:1px solid var(--line)}figcaption{font-size:9pt;color:var(--muted)}
.watermark{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:72pt;font-weight:800;color:rgba(180,83,9,.08);transform:rotate(-24deg);pointer-events:none;z-index:0}
@page{size:Letter;margin:16mm 14mm}
@media print{.page{padding:0;max-width:none}h2{break-before:auto}.pb{break-before:page}}
`;

export interface RenderOpts {
  /** Returns an <img> src for a screenshot evidence item (data URI or relative path), or null to omit. */
  imageSrc?: (evidenceId: string) => string | null;
}

export function renderReportHtml(d: ReportData, opts: RenderOpts = {}): string {
  const draft = d.report.status !== 'final';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.report.title)}</title><style>${REPORT_CSS}</style></head><body>${draft ? '<div class="watermark" aria-hidden="true">DRAFT</div>' : ''}<div class="page">\n${renderReportBody(d, opts)}\n</div></body></html>`;
}

/** Report body fragment (escaped). Used for standalone HTML and the in-app preview/print views. */
export function renderReportBody(d: ReportData, opts: RenderOpts = {}): string {
  const e = d.engagement;
  const draft = d.report.status !== 'final';
  const sec = (key: string) => {
    const txt = d.narrative[key];
    const src = d.narrative_sources[key];
    const prov = src?.type === 'ai_session' ? `<p class="small muted">Drafted with AI (${esc(src.code)}), verified by ${esc(src.reviewer)} on ${fmt(src.reviewed_at)}.</p>` : '';
    return txt?.trim() ? mdToHtml(txt) + prov : '<p class="muted">Not yet written.</p>';
  };
  const parts: string[] = [];
  if (e.is_demo) parts.push('<div class="banner demo">DEMO DATA — This report was generated from clearly labeled synthetic demonstration records. It is not an assessment result.</div>');
  if (draft) parts.push('<div class="banner">DRAFT — not finalized. Content may change before submission.</div>');
  parts.push(`<div class="cover"><h1>${esc(d.report.title)}</h1><p class="muted">${esc(e.client_name)} · ${esc(e.name)} · Generated ${fmt(d.generated_at)}${d.report.finalized_at ? ` · Finalized by ${esc(d.report.finalized_by)} ${fmt(d.report.finalized_at)}` : ''}</p></div>`);

  // 1 Executive summary
  parts.push(`<h2>1. Executive summary</h2>${sec('executive_summary')}`);
  parts.push(`<p class="small muted">Findings by severity (excluding false positives): ${Object.entries(d.severity_counts).map(([k, v]) => `${sevLabel(k)} ${v}`).join(' · ')}.</p>`);

  // 2 Scope
  parts.push('<h2>2. Scope and authorization</h2><dl class="kv">');
  parts.push(`<dt>Client</dt><dd>${esc(e.client_name)} (fictional)</dd><dt>Purpose</dt><dd>${esc(e.purpose) || '—'}</dd>`);
  parts.push(`<dt>Written authorization</dt><dd>${esc(e.authorization_ref) || '<span class="flag">Not recorded</span>'}</dd>`);
  parts.push(`<dt>Testing window</dt><dd>${e.window_start ? `${fmt(e.window_start)} – ${fmt(e.window_end)}` : '<span class="flag">Not recorded</span>'} (${esc(e.timezone)})</dd>`);
  parts.push(`<dt>Authorized targets</dt><dd>${d.scope.in.length ? d.scope.in.map((s: any) => `<span class="mono">${esc(s.target)}</span>`).join(', ') : '<span class="flag">None recorded</span>'}</dd>`);
  parts.push(`<dt>Excluded targets</dt><dd>${d.scope.out.length ? d.scope.out.map((s: any) => `<span class="mono">${esc(s.target)}</span>`).join(', ') : '—'}</dd>`);
  parts.push(`<dt>Rules of engagement</dt><dd>${mdToHtml(e.rules_of_engagement.split('\n').map((l: string) => (l.trim() ? `- ${l.replace(/^\s*[-*]\s*/, '')}` : '')).join('\n')) || '—'}</dd><dt>Prohibited actions</dt><dd>${mdToHtml(e.prohibited_actions.split('\n').map((l: string) => (l.trim() ? `- ${l}` : '')).join('\n')) || '—'}</dd></dl>`);

  // 3 Methodology
  parts.push(`<h2>3. Methodology</h2>${sec('methodology')}`);
  const mi = d.methodology_inputs;
  if (mi.scan_imports.length || mi.finding_imports.length || mi.log_imports.length) {
    parts.push('<h3>Recorded data collection</h3><table><thead><tr><th>Import</th><th>Type</th><th>Tool / format</th><th>Status</th><th>Evidence</th></tr></thead><tbody>');
    for (const s of mi.scan_imports) parts.push(`<tr><td class="mono">${esc(s.code)}</td><td>Scan</td><td>${esc(s.tool || s.format)} ${s.command_line ? `<br><span class="mono">${esc(s.command_line)}</span>` : ''}</td><td>${esc(s.status)}</td><td>${s.evidence_code ? `<span class="ev">${esc(s.evidence_code)}</span>` : '—'}</td></tr>`);
    for (const s of mi.finding_imports) parts.push(`<tr><td class="mono">${esc(s.code)}</td><td>Vulnerability report</td><td>${esc(s.scanner || s.format)}</td><td>${esc(s.status)}</td><td>${s.evidence_code ? `<span class="ev">${esc(s.evidence_code)}</span>` : '—'}</td></tr>`);
    for (const s of mi.log_imports) parts.push(`<tr><td class="mono">${esc(s.code)}</td><td>Logs / packets</td><td>${esc(s.format)}<br><span class="small muted">${esc(s.analysis_scope)}</span></td><td>${esc(s.status)}</td><td>${s.evidence_code ? `<span class="ev">${esc(s.evidence_code)}</span>` : '—'}</td></tr>`);
    parts.push('</tbody></table>');
  }

  // 4 Limitations
  parts.push(`<h2>4. Limitations</h2>${sec('limitations')}`);

  // 5 Recon
  parts.push('<h2>5. Reconnaissance summary</h2>');
  if (!d.recon.items.length) parts.push('<p class="muted">No reconnaissance observations recorded.</p>');
  else {
    parts.push(`<p class="small muted">${d.recon.items.length} observations (${d.recon.verified} verified). ${Object.entries(d.recon.by_classification).map(([k, v]) => `${human(k)}: ${v}`).join(' · ')}</p>`);
    parts.push('<table><thead><tr><th>ID</th><th>Observation</th><th>Classification</th><th>Status</th><th>Next step</th><th>Evidence</th></tr></thead><tbody>');
    for (const r of d.recon.items) parts.push(`<tr><td class="mono">${esc(r.code)}</td><td>${esc(r.value)}${r.analyst_notes ? `<br><span class="small muted">${esc(r.analyst_notes)}</span>` : ''}</td><td>${human(r.classification)}</td><td>${human(r.verification_status)}</td><td>${esc(r.next_step)}</td><td>${evList(r.evidence)}</td></tr>`);
    parts.push('</tbody></table>');
  }

  // 6 Inventory
  parts.push('<h2>6. Asset and service inventory</h2>');
  if (!d.inventory.assets.length) parts.push('<p class="muted">No assets recorded.</p>');
  else {
    parts.push(`<p class="small muted">${d.inventory.assets.length} assets; ${d.inventory.open_services} open service endpoints (distinct asset/port/protocol in current inventory).</p>`);
    parts.push('<table><thead><tr><th>Asset</th><th>IP</th><th>Hostname</th><th>OS observation</th><th>Port</th><th>Service</th><th>Version</th><th>Normal purpose / notes</th></tr></thead><tbody>');
    for (const s of d.inventory.services.filter((x: any) => x.state === 'open'))
      parts.push(`<tr><td class="mono">${esc(s.asset_code)}</td><td class="mono">${esc(s.ip)}</td><td>${esc(s.hostname)}</td><td>${esc(d.inventory.assets.find((a: any) => a.code === s.asset_code)?.os_name ?? '')}</td><td class="mono">${s.port}/${esc(s.protocol)}</td><td>${esc(s.service_name)}</td><td>${s.version_status === 'unknown' ? '<span class="muted">not detected</span>' : `${esc([s.product, s.version].filter(Boolean).join(' '))} <span class="muted small">(${esc(s.version_status)})</span>`}</td><td>${esc(s.normal_purpose)}${s.needs_investigation ? `<br><span class="flag">Investigate</span> ${esc(s.investigation_reason)}` : ''}</td></tr>`);
    parts.push('</tbody></table>');
  }

  // 7 Findings
  parts.push('<h2 class="pb">7. Findings</h2>');
  if (!d.findings.length) parts.push('<p class="muted">No findings recorded.</p>');
  for (const f of d.findings) {
    parts.push(`<div class="finding"><h3><span class="mono">${esc(f.code)}</span> ${esc(f.title)} <span class="sev sev-${f.severity}">${sevLabel(f.severity)}</span>${f.priority_rank ? ` <span class="flag">Priority ${f.priority_rank}</span>` : ''}</h3>`);
    if (f.unverified) parts.push(`<p><span class="flag">${esc(VALIDATION[f.validation_status])}</span> This item has not been validated by an analyst.</p>`);
    parts.push('<dl class="kv">');
    parts.push(`<dt>Validation</dt><dd>${esc(VALIDATION[f.validation_status] ?? f.validation_status)}${f.validation_notes ? ` — ${esc(f.validation_notes)}` : ''}</dd>`);
    parts.push(`<dt>Status / owner</dt><dd>${human(f.status)}${f.owner ? ` · ${esc(f.owner)}` : ''}</dd>`);
    parts.push(`<dt>Affected assets</dt><dd>${f.assets.map((a: any) => `<span class="mono">${esc(a.code)} ${esc(a.ip ?? a.hostname)}</span>`).join(', ') || '—'}${f.services.length ? `<br>${f.services.map((s: any) => `<span class="mono">${esc(s.asset_code)}:${s.port}/${esc(s.protocol)}</span>`).join(', ')}` : ''}</dd>`);
    if (f.cves.length || f.cvss_score != null) parts.push(`<dt>CVE / CVSS</dt><dd>${f.cves.map((c: string) => `<span class="mono">${esc(c)}</span>`).join(', ') || '—'}${f.cvss_score != null ? ` · CVSS ${esc(f.cvss_score)} ${f.cvss_version ? `v${esc(f.cvss_version)}` : ''} ${f.cvss_vector ? `<span class="mono">${esc(f.cvss_vector)}</span>` : ''} ${f.cvss_source ? `(source: ${esc(f.cvss_source)})` : ''}` : ''}</dd>`);
    parts.push(`<dt>Description</dt><dd>${esc(f.description) || '—'}</dd><dt>Potential impact</dt><dd>${esc(f.impact) || '—'}</dd><dt>Remediation</dt><dd>${esc(f.remediation) || '<span class="flag">Missing</span>'}</dd>`);
    parts.push(`<dt>Evidence</dt><dd>${evList(f.evidence)}</dd>`);
    if (f.retest_notes) parts.push(`<dt>Retest notes</dt><dd>${esc(f.retest_notes)}</dd>`);
    parts.push('</dl></div>');
  }
  if (d.false_positives.length) parts.push(`<p class="small muted">Excluded as false positives: ${d.false_positives.map((f: any) => `${esc(f.code)} ${esc(f.title)}`).join('; ')}.</p>`);

  // 8 Top three
  parts.push('<h2>8. Top-three priorities and rationale</h2>');
  if (!d.top_three.length) parts.push('<p class="muted">Top-three priorities have not been ranked.</p>');
  else {
    parts.push('<table><thead><tr><th>Rank</th><th>Finding</th><th>Severity</th><th>Rationale</th><th>Evidence</th></tr></thead><tbody>');
    for (const f of d.top_three) parts.push(`<tr><td>${f.priority_rank}</td><td><span class="mono">${esc(f.code)}</span> ${esc(f.title)}</td><td><span class="sev sev-${f.severity}">${sevLabel(f.severity)}</span></td><td>${esc(f.priority_rationale) || '<span class="flag">Missing rationale</span>'}</td><td>${evList(f.evidence)}</td></tr>`);
    parts.push('</tbody></table>');
  }

  // 9 Timeline
  parts.push('<h2>9. Attack timeline</h2>');
  if (!d.timeline.length && !d.timeline_unplaced.length) parts.push('<p class="muted">No timeline events recorded.</p>');
  else {
    parts.push('<p class="small muted">Times are shown as recorded in the evidence, with the normalized UTC time. Events marked uncertain could not be placed precisely from the evidence.</p>');
    parts.push('<table><thead><tr><th>ID</th><th>Time (original → UTC)</th><th>Source → destination</th><th>Observed event</th><th>Interpretation</th><th>Status</th><th>Evidence</th></tr></thead><tbody>');
    for (const t of [...d.timeline, ...d.timeline_unplaced])
      parts.push(`<tr><td class="mono">${esc(t.code)}</td><td class="mono">${esc(t.original_timestamp ?? 'unknown')}<br>${t.normalized_ts ? esc(fmt(t.normalized_ts)) : '<span class="flag">Time unknown</span>'}${t.time_certainty !== 'exact' || t.order_certainty !== 'established' ? '<br><span class="flag">Uncertain</span>' : ''}</td><td class="mono">${esc(t.source_host || '?')} → ${esc(t.dest_host || '?')}</td><td>${esc(t.event_type)}: ${esc(t.observation)}</td><td>${esc(t.student_interpretation)}</td><td>${human(t.verification_status)}</td><td>${evList(t.evidence)}</td></tr>`);
    parts.push('</tbody></table>');
  }
  if (d.indicators.length) {
    parts.push('<h3>Indicators</h3><table><thead><tr><th>ID</th><th>Lab</th><th>Indicator</th><th>Assessment</th><th>Additional evidence needed</th><th>Evidence</th></tr></thead><tbody>');
    for (const i of d.indicators) parts.push(`<tr><td class="mono">${esc(i.code)}</td><td>${esc(i.lab)}</td><td>${esc(i.title)}<br><span class="small muted">${esc(i.observation)}</span></td><td>${human(i.assessment)} (${human(i.confidence)})</td><td>${esc(i.additional_evidence_needed)}</td><td>${evList(i.evidence)}</td></tr>`);
    parts.push('</tbody></table>');
  }
  if (d.attack_mappings.length) {
    parts.push('<h3>MITRE ATT&amp;CK mappings (human-verified only)</h3><table><thead><tr><th>Technique</th><th>Record</th><th>Rationale</th><th>Origin</th></tr></thead><tbody>');
    for (const m of d.attack_mappings) parts.push(`<tr><td class="mono">${esc(m.technique_id)} ${esc(m.technique_name)}</td><td class="mono">${esc(m.target_code)}</td><td>${esc(m.rationale)}</td><td>${m.origin === 'ai_suggested' ? 'AI-suggested, human-verified' : 'Analyst'}</td></tr>`);
    parts.push('</tbody></table>');
  }

  // 10 Remediation
  parts.push(`<h2>10. Remediation recommendations</h2>${d.narrative.recommendations?.trim() ? sec('recommendations') : ''}`);
  if (d.remediation.length) {
    parts.push('<table><thead><tr><th>Finding</th><th>Severity</th><th>Recommended fix</th><th>Owner / status</th></tr></thead><tbody>');
    for (const r of d.remediation) parts.push(`<tr><td><span class="mono">${esc(r.code)}</span> ${esc(r.title)}${r.priority_rank ? ` <span class="flag">P${r.priority_rank}</span>` : ''}</td><td><span class="sev sev-${r.severity}">${sevLabel(r.severity)}</span></td><td>${esc(r.remediation)}${r.tasks.length ? `<br><span class="small muted">Tasks: ${r.tasks.map((t: any) => `${esc(t.title)} (${human(t.status)})`).join('; ')}</span>` : ''}</td><td>${esc(r.owner) || '—'} · ${human(r.status)}</td></tr>`);
    parts.push('</tbody></table>');
  } else if (!d.narrative.recommendations?.trim()) parts.push('<p class="muted">No remediation recommendations recorded.</p>');
  if (d.remediated.length) parts.push(`<p class="small">Remediated: ${d.remediated.map((r: any) => `${esc(r.code)} ${esc(r.title)}${r.retest_notes ? ` (retest: ${esc(r.retest_notes)})` : ''}`).join('; ')}</p>`);

  // 11 Evidence references
  parts.push('<h2 class="pb">11. Evidence references</h2><p class="small muted">SHA-256 values identify file contents at import time. A hash alone does not establish authenticity or a complete chain of custody.</p>');
  if (!d.evidence.length) parts.push('<p class="muted">No evidence recorded.</p>');
  else {
    parts.push('<table><thead><tr><th>ID</th><th>Title</th><th>Source</th><th>Collected</th><th>SHA-256 / reference</th></tr></thead><tbody>');
    for (const ev of d.evidence) parts.push(`<tr><td class="mono">${esc(ev.code)}${ev.status === 'withdrawn' ? '<br><span class="flag">Withdrawn</span>' : ''}</td><td>${esc(ev.title)}<br><span class="small muted">${esc(ev.original_filename ?? '')}</span></td><td>${human(ev.source_category)}<br><span class="small muted">${esc(ev.source_tool)}</span></td><td class="small">${fmt(ev.collected_at)}</td><td class="mono" style="word-break:break-all">${esc(ev.sha256 ?? '')}${ev.reference_uri ? `<br>${esc(ev.reference_uri)}` : ''}</td></tr>`);
    parts.push('</tbody></table>');
  }
  if (d.screenshots.length) {
    parts.push('<h3>Figures</h3>');
    for (const s of d.screenshots) {
      const src = opts.imageSrc?.(s.evidence_id) ?? null;
      parts.push(`<figure>${src ? `<img src="${esc(src)}" alt="${esc(s.title)}">` : ''}<figcaption>Figure ${s.figure} — ${esc(s.label)} (<span class="ev">${esc(s.code)}</span> ${esc(s.title)})</figcaption></figure>`);
    }
  }

  // 12 AI statement
  const ai = d.ai;
  parts.push('<h2>12. AI use and human verification statement</h2>');
  parts.push(`<p>${ai.total ? `The team used an AI assistant (${ai.providers.map(esc).join(', ')}) for ${ai.total} analysis request(s): ${ai.verified} verified by a team member, ${ai.rejected} rejected, ${ai.unverified} unverified, ${ai.failed} failed. AI requests were grounded only in selected, sanitized evidence records, and every response began as an unverified draft.` : 'No AI-generated analysis was used in this engagement.'}</p>`);
  if (ai.sections.length) parts.push(`<p>Report sections drafted with AI and verified before inclusion: ${ai.sections.map((s: any) => `${esc(s.section)} (${esc(s.code)}, verified by ${esc(s.reviewer)} ${fmt(s.reviewed_at)})`).join('; ')}.</p>`);
  parts.push('<p>Unverified AI output is never included in this report. All conclusions were checked against the cited evidence by the assessment team.</p>');
  if (ai.sessions.length) {
    parts.push('<table><thead><tr><th>Session</th><th>Task</th><th>Review</th><th>Reviewer</th></tr></thead><tbody>');
    for (const s of ai.sessions) parts.push(`<tr><td class="mono">${esc(s.code)}</td><td>${esc(s.task)}</td><td>${s.status === 'failed' ? 'failed' : human(s.review_status)}</td><td>${esc(s.reviewer ?? '—')}${s.reviewed_at ? ` ${fmt(s.reviewed_at)}` : ''}</td></tr>`);
    parts.push('</tbody></table>');
  }

  // 13 Team
  parts.push('<h2>13. Team contributions</h2>');
  if (!d.team.length) parts.push('<p class="muted">No team members recorded.</p>');
  else {
    parts.push('<table><thead><tr><th>Name</th><th>Role</th><th>Responsibilities</th><th>Contributions</th></tr></thead><tbody>');
    for (const t of d.team) parts.push(`<tr><td>${esc(t.name)}</td><td>${esc(t.role)}</td><td>${esc(t.responsibilities)}</td><td>${esc(t.contributions)}</td></tr>`);
    parts.push('</tbody></table>');
  }
  if (d.narrative.lessons_learned?.trim()) parts.push(`<h2>14. Lessons learned</h2>${sec('lessons_learned')}`);
  return parts.join('\n');
}

export function renderExecutiveHtml(d: ReportData): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Executive summary — ${esc(d.engagement.client_name)}</title><style>${REPORT_CSS}
.page{max-width:780px;padding:28px 34px}h1{font-size:19pt}h2{font-size:12.5pt;margin:14px 0 5px}body{font-size:10.5pt}@page{size:Letter;margin:12mm}</style></head><body><div class="page">
${renderExecutiveBody(d)}
</div></body></html>`;
}

export function renderExecutiveBody(d: ReportData): string {
  const e = d.engagement;
  const draft = d.report.status !== 'final';
  const top = d.top_three.length ? d.top_three : d.findings.slice(0, 3);
  return `${e.is_demo ? '<div class="banner demo">DEMO DATA — synthetic demonstration records, not assessment results.</div>' : ''}${draft ? '<div class="banner">DRAFT — not finalized.</div>' : ''}
<div class="cover"><h1>Executive summary</h1><p class="muted">${esc(e.client_name)} · ${esc(e.name)} · ${fmt(d.generated_at)}</p></div>
<h2>Overview</h2>${d.narrative.executive_summary?.trim() ? mdToHtml(d.narrative.executive_summary) : '<p class="muted">The executive summary has not been written yet.</p>'}
<h2>Risk picture</h2><p>${Object.entries(d.severity_counts).map(([k, v]) => `<span class="sev sev-${k}">${sevLabel(k)} ${v}</span>`).join(' ')} — ${d.findings.length} findings, ${d.findings.filter((f: any) => f.unverified).length} awaiting verification; ${d.inventory.assets.length} assets and ${d.inventory.open_services} open service endpoints in scope of this report.</p>
<h2>${d.top_three.length ? 'Top-three priorities' : 'Highest-severity findings (not yet ranked)'}</h2>
${top.length ? `<ol>${top.map((f: any) => `<li><strong>${esc(f.title)}</strong> <span class="sev sev-${f.severity}">${sevLabel(f.severity)}</span>${f.unverified ? ' <span class="flag">Unverified</span>' : ''}<br>${esc(f.priority_rationale || f.impact || '')}<br><span class="small">Fix: ${esc(f.remediation || '—')}</span></li>`).join('')}</ol>` : '<p class="muted">No findings recorded.</p>'}
<h2>Scope</h2><p class="small">Authorized: ${d.scope.in.map((s: any) => esc(s.target)).join(', ') || '<span class="flag">not recorded</span>'}. Authorization: ${esc(e.authorization_ref) || '<span class="flag">not recorded</span>'}.</p>
${d.narrative.limitations?.trim() ? `<h2>Limitations</h2><div class="small">${mdToHtml(d.narrative.limitations.split('\n').slice(0, 6).join('\n'))}</div>` : ''}
<p class="small muted">AI assistance: ${d.ai.total ? `${d.ai.verified} of ${d.ai.total} AI drafts were verified by the team; unverified AI text is excluded.` : 'none used'}. Details, evidence IDs, and remediation steps are in the full technical report.</p>`;
}

export function renderReportMarkdown(d: ReportData): string {
  const e = d.engagement;
  const L: string[] = [];
  const t = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  L.push(`# ${d.report.title}`, '');
  if (e.is_demo) L.push('> **DEMO DATA** — synthetic demonstration records, not assessment results.', '');
  if (d.report.status !== 'final') L.push('> **DRAFT — not finalized.**', '');
  L.push(`${e.client_name} · ${e.name} · Generated ${fmt(d.generated_at)}`, '');
  for (const key of ['executive_summary', 'methodology', 'limitations']) {
    L.push(`## ${SECTION_TITLES[key]}`, '', d.narrative[key]?.trim() || '_Not yet written._', '');
  }
  L.push('## Scope and authorization', '', `- Authorization: ${e.authorization_ref || 'not recorded'}`, `- Testing window: ${e.window_start ? `${fmt(e.window_start)} – ${fmt(e.window_end)}` : 'not recorded'}`, `- Authorized targets: ${d.scope.in.map((s: any) => s.target).join(', ') || 'none recorded'}`, `- Excluded: ${d.scope.out.map((s: any) => s.target).join(', ') || 'none'}`, '');
  L.push('## Reconnaissance summary', '');
  if (d.recon.items.length) {
    L.push('| ID | Observation | Classification | Status | Evidence |', '|---|---|---|---|---|');
    for (const r of d.recon.items) L.push(`| ${r.code} | ${t(r.value)} | ${human(r.classification)} | ${human(r.verification_status)} | ${r.evidence.map((x: any) => x.code).join(', ')} |`);
  } else L.push('_None recorded._');
  L.push('', '## Asset and service inventory', '');
  const open = d.inventory.services.filter((s: any) => s.state === 'open');
  if (open.length) {
    L.push('| Asset | IP | Port | Service | Version |', '|---|---|---|---|---|');
    for (const s of open) L.push(`| ${s.asset_code} | ${s.ip ?? ''} | ${s.port}/${s.protocol} | ${t(s.service_name)} | ${s.version_status === 'unknown' ? 'not detected' : t([s.product, s.version].filter(Boolean).join(' ')) + ` (${s.version_status})`} |`);
  } else L.push('_None recorded._');
  L.push('', '## Findings', '');
  for (const f of d.findings) {
    L.push(`### ${f.code} — ${f.title} (${sevLabel(f.severity)})${f.priority_rank ? ` · Priority ${f.priority_rank}` : ''}`, '');
    if (f.unverified) L.push(`> ${VALIDATION[f.validation_status]} — not validated by an analyst.`, '');
    L.push(`- Assets: ${f.assets.map((a: any) => `${a.code} ${a.ip ?? a.hostname}`).join(', ') || '—'}`, `- CVE/CVSS: ${f.cves.join(', ') || '—'}${f.cvss_score != null ? ` · ${f.cvss_score} ${f.cvss_vector ?? ''}` : ''}`, `- Description: ${t(f.description)}`, `- Impact: ${t(f.impact)}`, `- Remediation: ${t(f.remediation)}`, `- Evidence: ${f.evidence.map((x: any) => x.code).join(', ') || '—'}`, '');
  }
  if (!d.findings.length) L.push('_None recorded._', '');
  L.push('## Top-three priorities', '');
  for (const f of d.top_three) L.push(`${f.priority_rank}. **${f.code} ${f.title}** — ${t(f.priority_rationale)}`);
  if (!d.top_three.length) L.push('_Not ranked._');
  L.push('', '## Attack timeline', '');
  const tl = [...d.timeline, ...d.timeline_unplaced];
  if (tl.length) {
    L.push('| ID | Time | Event | Interpretation | Status | Evidence |', '|---|---|---|---|---|---|');
    for (const x of tl) L.push(`| ${x.code} | ${t(x.original_timestamp ?? 'unknown')}${x.time_certainty !== 'exact' || x.order_certainty !== 'established' ? ' (uncertain)' : ''} | ${t(x.event_type)}: ${t(x.observation)} | ${t(x.student_interpretation)} | ${human(x.verification_status)} | ${x.evidence.map((y: any) => y.code).join(', ')} |`);
  } else L.push('_None recorded._');
  L.push('', '## Remediation recommendations', '', d.narrative.recommendations?.trim() || '');
  for (const r of d.remediation) L.push(`- **${r.code}** (${r.severity}): ${t(r.remediation)}`);
  L.push('', '## Evidence references', '', '_SHA-256 values identify file contents; a hash alone does not establish authenticity or chain of custody._', '', '| ID | Title | Source | SHA-256 |', '|---|---|---|---|');
  for (const ev of d.evidence) L.push(`| ${ev.code}${ev.status === 'withdrawn' ? ' (withdrawn)' : ''} | ${t(ev.title)} | ${human(ev.source_category)} | ${ev.sha256 ?? ev.reference_uri ?? ''} |`);
  L.push('', '## AI use and human verification statement', '', d.ai.total ? `${d.ai.total} AI request(s): ${d.ai.verified} verified, ${d.ai.rejected} rejected, ${d.ai.unverified} unverified, ${d.ai.failed} failed. Unverified AI output is never included in this report.` : 'No AI-generated analysis was used.', '');
  for (const s of d.ai.sections) L.push(`- ${s.section}: drafted with ${s.code}, verified by ${s.reviewer} (${fmt(s.reviewed_at)})`);
  L.push('', '## Team contributions', '');
  for (const m of d.team) L.push(`- **${m.name}** (${m.role || 'role not set'}): ${t(m.contributions || m.responsibilities)}`);
  if (!d.team.length) L.push('_None recorded._');
  if (d.narrative.lessons_learned?.trim()) L.push('', '## Lessons learned', '', d.narrative.lessons_learned);
  return L.join('\n') + '\n';
}
