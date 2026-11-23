# Product Requirements Document: CyberDome Command Center

*Final PRD for NWIT 246 (Fall 2026), describing the system as implemented. Follows the Section 7 template of the project packet.*

| PRD field | Response |
|---|---|
| **Project name** | CyberDome Command Center |
| **Team members / roles** | Nolawi: Project Manager. Jayden: Recon Lead and Network Assessment Lead. Yohaness: Vulnerability Lead. Zelalem: AI/Reporting Lead. Surafel: Evidence Custodian and platform developer. Roles are also recorded in the app (Team page) and appear in the report's contribution section. |
| **Problem statement** | CyberDome Corporation expanded its network and web services and needs to know whether new systems expose unnecessary services, weak configurations or outdated software. Assessment evidence (scans, logs, packet captures, screenshots) is spread across tools. Analysts need one place that keeps it traceable, separates facts from interpretation and AI drafts, and produces a defensible report. |
| **Primary users** | Ethical hacker or security analyst (collects and interprets evidence), team reviewer (verifies AI output and findings), manager or instructor (reads the dashboard, executive summary and report). |
| **Project goal** | A user can record an authorized engagement, collect or import real lab evidence, see the attack surface and risk picture, prioritize findings with written rationale, rebuild an attack timeline, ask an AI analyst evidence-grounded questions, verify its output, and export a traceable report and evidence package. |
| **In scope** | Instructor-approved targets and instructor-supplied datasets only. Our authorized target was scanme.nmap.org (45.33.32.156) under the Nmap Project's published permission; Lab 5 used the instructor's six Nmap packet captures. Features: engagement scope and authorization, recon records, Nmap scans run from the app against in-scope targets, scan and vulnerability report import, log and tshark import, timeline and indicators, ATT&CK mapping, AI analysis with human review, reports and exports. |
| **Out of scope** | Scanning anything not on the scope list; public targets other than the authorized one; other students or production systems; denial of service, destructive testing, persistence, credential theft, brute forcing or exfiltration; uploading evidence to third-party services; multi-user accounts. |
| **Platform choice** | Windows desktop application (Electron) with a React + TypeScript interface and a Node.js + Express + TypeScript backend that listens only on the local computer. Installed with CyberDomeInstaller.exe; updates are offered inside the app from the GitHub releases page. |
| **Data storage** | SQLite database and evidence files in the user's local app data folder (%LOCALAPPDATA%\CyberDome\data). Every artifact gets an Evidence ID and a SHA-256 hash. Zip backups with hash manifests. |
| **AI provider** | Google Gemini (gemini-3.5-flash) through its OpenAI-compatible endpoint. The app also supports Anthropic and local Ollama models. The API key is stored on the local computer only. |
| **Security / privacy controls** | Loopback-only server with a host allow-list and a request header check; secrets kept on the local computer; scans limited to fixed Nmap profiles against addresses on the scope list, with exclusions enforced; only evidence marked sanitized or no sensitive data can be sent to the AI, after a context preview; every AI answer starts as an unverified draft and needs a team member's review note before it can enter the report; personal details from the team workstation snapshot were redacted into sanitized copies. |
| **Required modules** | Engagement, Recon, Scan & Enumeration, Vulnerabilities, Attack Evidence, AI Security Analyst, Evidence Locker and Reports, all implemented, plus a Dashboard, Autopilot (one-click scan of the scope list), Team page and Settings. |
| **Success criteria** | All six labs show complete on the in-app tracker; every finding, timeline event and AI citation resolves to an Evidence ID; the report has no readiness blockers; 143 automated tests pass. |
| **Known risks / limitations** | See the end of this document. |

## User stories

| # | User story |
|---|---|
| 1 | As a security analyst, I want to view discovered ports so that I can understand the exposed attack surface. *(Scan & Enumeration services table; dashboard.)* |
| 2 | As a manager, I want to see findings by severity so that I can prioritize remediation. *(Vulnerabilities severity view; top-three priorities.)* |
| 3 | As an analyst, I want to run Nmap from inside the app against our scope list and have the output saved as evidence automatically, so that scan results are never retyped or lost. |
| 4 | As an analyst, I want every finding to link to the evidence that supports it, so that I can explain how it was validated during the presentation. |
| 5 | As the AI/Reporting Lead, I want to see exactly which sanitized evidence goes to the AI and have every answer start as an unverified draft, so that only checked conclusions reach the report. |
| 6 | As an incident analyst, I want imported packet data to keep its original timestamps and mark uncertain events, so that the attack timeline never claims more than the evidence shows. |
| 7 | As the Evidence Custodian, I want a clear list of evidence still waiting for a sanitization decision, so that nothing sensitive is sent to the AI or packaged by mistake. |

## Acceptance criteria (packet): status

| Criterion | Status |
|---|---|
| All required modules are accessible from the main navigation | Met. The sidebar lists every module with its lab number. |
| At least one real or supplied evidence item is visible in each technical module | Met. Recon (EV-003), Scan (EV-001, EV-002, EV-018), Vulnerabilities (5 findings), Attack Evidence (EV-023 to EV-036), Evidence Locker (42 items). |
| AI output references evidence and does not invent unsupported facts | Met. Evidence-only context, citation checks and mandatory review. Ten AI sessions were verified with edits; the review notes record each wrong citation we corrected. |
| The final platform can produce or display a clear executive summary | Met. Executive summary view and PDF export. |
| The platform is demonstrable within the presentation time limit | Met. Live demo from the desktop app, paced by the presentation deck. |

## Architecture summary

A desktop shell starts a local Node.js server that serves the React interface and a JSON API on 127.0.0.1. Scans, imports and uploads are parsed on the server into normalized tables, and every artifact lands in the Evidence Locker first. AI requests are made from the server with only sanitized evidence; prompts, cited Evidence IDs, responses and reviews are all stored. Reports are assembled from the records when they are viewed or exported. See `docs/ARCHITECTURE.md`.

## Known limitations

* Single user per installation; the reviewer name is self-declared in Settings.
* Scans use three fixed Nmap profiles against in-scope IPv4 targets (256-host cap, 30-minute limit, one scan at a time). No custom arguments, scripts or UDP scans.
* The app looks for tshark only on the system PATH, so on our PC the Lab 5 captures were summarized with tshark outside the app and imported as tshark field exports.
* The free Gemini tier rate-limits requests and refused requests that included the recon page text; we worked around it by sending smaller evidence sets.
* Citation checks prove an Evidence ID was supplied, not that it supports the claim; that is what the human review is for.
