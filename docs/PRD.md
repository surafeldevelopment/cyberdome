# Product Requirements Document — CyberDome Command Center

*Updated PRD describing the system as implemented (NWIT 246 packet, Section 7 template).*
*Team-specific fields marked ⟨to complete⟩ must be filled in by the team; they are deliberately not invented.*

| PRD field | Response |
|---|---|
| **Project name** | CyberDome Command Center |
| **Team members / roles** | ⟨to complete — e.g. Recon Lead, Network Assessment Lead, Vulnerability Lead, AI/Reporting Lead⟩. Roles are also recorded in the app (Engagement → Team) and flow into the report's contribution section. |
| **Problem statement** | CyberDome Corporation expanded its network and web services and needs to know whether new systems expose unnecessary services, weak configurations or outdated software. Assessment evidence (scans, scanner reports, logs, captures, screenshots) is scattered across tools; analysts need one place that keeps it traceable, separates facts from interpretation and AI drafts, and produces a defensible report. |
| **Primary users** | Ethical hacker / security analyst (collects and interprets evidence), team reviewer (verifies AI output and findings), manager / instructor (reads the dashboard, executive summary and report). |
| **Project goal** | A user can define an authorized engagement, import real lab evidence, see an accurate attack-surface and risk picture, prioritize findings with written rationale, reconstruct an attack timeline, ask an AI analyst evidence-grounded questions, verify its output, and export a traceable report and evidence package. |
| **In scope** | Instructor-approved lab targets and instructor-supplied datasets only. Features: engagement scope/authorization, recon records, Nmap/CSV/JSON scan import, Nessus/Greenbone/normalized vulnerability import, log/tshark import and local PCAP summarization, timeline and indicators, ATT&CK mapping records, AI analysis with review, reports and exports, lab tracker, isolated demo dataset. |
| **Out of scope** | Running scans or any shell commands from the app; scanning public Internet targets, other students or production systems; DoS, destructive testing, persistence, credential theft, exfiltration; uploading evidence to third-party services; VirusTotal lookups; multi-user authentication. |
| **Platform choice** | Local web application: React + TypeScript (Vite) frontend, Node.js + Express + TypeScript backend. |
| **Data storage** | SQLite (Node built-in `node:sqlite`, WAL) in `./data/cyberdome.db` with versioned migrations; evidence files in `./data/evidence/` named by random ID; zip backups with SHA-256 manifests. |
| **AI provider** | Configurable on the server: Anthropic Messages API or any OpenAI-compatible endpoint (incl. a local Ollama model). No provider → truthful “not configured” state; no canned text. |
| **Security / privacy controls** | Loopback bind + Host allow-list; CSRF header; secrets only in server environment variables; only evidence marked *sanitized* or *no sensitive data* can be sent to AI, after an exact context preview; evidence text wrapped as untrusted data; executables refused; uploaded HTML/SVG never rendered; sandboxed downloads; CSV formula neutralization; demo data isolated by engagement and `DEMO-` IDs; sensitive evidence excluded from packages by default. |
| **Required modules** | Engagement, Recon, Scan & Enumeration, Vulnerabilities, Attack Evidence, AI Analyst, Evidence Locker, Reports — all implemented, plus Executive Dashboard, Project Tracker, Demo Walkthrough and Settings. |
| **Success criteria** | The 14 acceptance workflows in `docs/TEST_RESULTS.md` pass; every dashboard value opens its records or explains its calculation; every finding and AI citation resolves to an Evidence ID; re-importing a scan does not change totals; unverified AI text cannot enter the final report; data survives restarts. |
| **Known risks / limitations** | See the end of this document. |

## User stories

| # | User story |
|---|---|
| 1 | As a security analyst, I want to view discovered ports so that I can understand the exposed attack surface. *(Scan & Enumeration services table; dashboard exposure matrix.)* |
| 2 | As a manager, I want to see findings by severity so that I can prioritize remediation. *(Dashboard severity distribution; Vulnerabilities severity chart.)* |
| 3 | As an analyst, I want to import my Nmap XML and see a preview with validation and scope warnings before saving, so that I never record out-of-scope or malformed data by accident. |
| 4 | As an analyst, I want every finding to link to the evidence that supports it, so that I can explain how it was validated during the presentation. |
| 5 | As the AI/Reporting lead, I want to see exactly which sanitized evidence will be sent to the AI and have every answer start as an unverified draft, so that only human-verified conclusions reach the report. |
| 6 | As an incident analyst, I want imported log events to keep their original timestamps and show uncertainty, so that the attack timeline never states an order the evidence can't support. |
| 7 | As a team member, I want a tracker that checks each lab's requirements against our actual records, so that we know what is still missing before November 23. |

## Acceptance criteria (packet) — status

| Criterion | Status |
|---|---|
| All required modules are accessible from the main navigation | Met — left navigation lists all modules with lab numbers |
| At least one real/supplied evidence item is visible in each technical module | **Depends on the team's evidence** — the platform supports it; the real engagement starts empty |
| AI output references evidence and does not invent unsupported facts | Enforced by prompt rules, evidence-only context, citation validation (valid / not in context / unknown) and mandatory human review |
| The final platform can produce or display a clear executive summary | Met — one-page executive summary view, HTML export, print-to-PDF |
| The platform is demonstrable within the presentation time limit | Met — Demo Walkthrough route with timed 7-section script |

## Architecture summary

Single local Node.js process serving a React SPA and a JSON API. Imports are parsed server-side
into normalized tables; current inventories (`services`) are kept separate from history
(`service_observations`). All artifacts land in the Evidence Locker first and are referenced by
link tables. AI calls are made server-side; prompts, evidence IDs, responses and reviews are
stored. Reports are assembled from records at request time. See `docs/ARCHITECTURE.md`.

## Known limitations

* Single-user, no authentication; reviewer identity is self-declared in Settings.
* Scan execution is limited to three fixed Nmap profiles against in-scope IPv4 targets (256-host cap, 30-minute limit, one scan at a time). No custom arguments, scripts or UDP scans; anything else is imported.
* NVD, CISA KEV and ATT&CK lookups need Internet access; cached results show their retrieval time. NVD free-tier rate limits apply.
* PCAP analysis is limited to tshark field summaries (frame time, addresses, ports, protocol, info) when tshark is installed; otherwise only file-header metadata is read.
* pcapng timestamps from header parsing assume the default microsecond resolution.
* Restore is command-line only and reads backups up to 4 GB.
* AI quality depends on the configured model; citation validation proves an ID was supplied, not that it supports the claim.
