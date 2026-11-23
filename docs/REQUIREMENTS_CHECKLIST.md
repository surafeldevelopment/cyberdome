# Requirement checklist

✅ implemented and tested · 🟡 implemented, depends on your lab evidence · ⛔ deliberately not implemented

## Packet — required modules (§3)
| Module | Status | Where |
|---|---|---|
| Home / Executive Dashboard: risk picture, project status, assets, open ports, vulnerability totals, severity, quick navigation | ✅ | `/` |
| Engagement: scenario, authorization, scope, exclusions, rules, team roles | ✅ | `/engagement` |
| Recon: public info, target profile, technologies, screenshots, notes | ✅ | `/recon` |
| Scan & Enumeration: hosts, ports, services, versions, OS, tool output, notes | ✅ | `/scan` |
| Vulnerabilities: findings, CVE/CVSS, severity, assets, evidence, remediation | ✅ | `/vulnerabilities` |
| Attack Evidence: PCAP/log/host evidence, indicators, timeline, conclusions | ✅ | `/attack` |
| AI Security Analyst: grounded analysis, prioritization, next steps, ATT&CK, report help | ✅ | `/ai` |
| Evidence Locker: screenshots, sanitized output, logs, hashes, PCAP references, IDs | ✅ | `/evidence` |
| Reports: executive summary, technical findings, recommendations, final report | ✅ | `/reports` |

## Packet — labs (§6)
| Lab | Platform support | Your evidence |
|---|---|---|
| 1 Scope + ≥5 signs of compromise with evidence and assessment | ✅ | 🟡 |
| 2 ≥5 recon items, classification, next step, verified AI summary | ✅ | 🟡 |
| 3 Scan import, ≥5 service purposes, ≥1 flagged service, scanner output in locker, AI after scan | ✅ | 🟡 |
| 4 ≥5 findings, CVE/CVSS, top-three with rationale, verified AI plain-language explanation | ✅ | 🟡 |
| 5 ≥5 indicators/events, ≥5-event timeline, facts vs. assumptions, AI after team analysis | ✅ | 🟡 |
| 6 All seven AI capabilities with guardrails, human verification, report preview | ✅ (needs an AI provider) | 🟡 |
| Required screenshots per lab | ✅ tracked; app views capturable; tool screenshots must be attached by you | 🟡 |

## Brief — key requirements
| Requirement | Status |
|---|---|
| Real data only; truthful empty states; isolated, labeled demo engagement | ✅ |
| Source categories: authorized lab, instructor-supplied, external reference, demo (+ project artifact for app captures) | ✅ |
| Provenance: imported / calculated / external / AI-generated / human-verified | ✅ |
| Every dashboard card/chart opens records or explains its calculation; no invented score; no “live” claims | ✅ |
| Persistence across restarts; durable evidence storage; migrations; backup/restore | ✅ |
| Secrets server-side only; input validation; engagement scoping; stable IDs never reused | ✅ |
| Local single-user documented; loopback bind; no fake login | ✅ |
| Data model: engagements, scope, team, assets, recon, scan imports/runs, services vs. observations, findings, evidence, indicators, timeline, remediation, AI sessions, reviews, reports, activity | ✅ |
| Nmap XML, CSV template, JSON, raw text retention; preview, validation, partial import, duplicates, reimport, history | ✅ |
| Detected vs. inferred vs. unknown versions | ✅ |
| Normalized findings + Nessus + Greenbone import; validation classes; top-three with editable rationale; prioritization beyond CVSS | ✅ |
| NVD, CISA KEV, ATT&CK with source/time/URL/cached state/errors; offline import; no evidence sent out | ✅ |
| Log import, tshark CSV/JSON import, optional local tshark processing with limits, honest PCAP analysis labels | ✅ |
| Timeline with original timestamps, normalization documented, uncertainty labels, no invented times | ✅ |
| Evidence Locker: all listed fields, SHA-256 from bytes, derivatives hashed separately, safe previews, index export | ✅ |
| AI: server-side provider, disconnected state, context preview, sanitized-only, injection defenses, citation validation, Unverified AI Draft, review workflow, no autonomous actions | ✅ (real model not exercised during build) |
| Reports: all sections, readiness issues, print-to-PDF, one-page summary, CSV/JSON, evidence index, package with manifest, no unverified AI | ✅ |
| Tracker, due date Nov 23 2026, final checklist, presentation route, finding-validation walkthrough | ✅ |
| PRD with ≥5 user stories | ✅ `docs/PRD.md` (team fields to fill in) |
| Scan execution | ⛔ import-first by design (allowed by the brief) |
| VirusTotal | ⛔ not implemented (optional in brief) |
| General-purpose terminal / arbitrary shell | ⛔ excluded by design |
