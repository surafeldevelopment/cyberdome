# CyberDome Command Center

An evidence-driven ethical hacking assessment workspace for the **NWIT 246: Attacker Tools and
Techniques** semester project (Fall 2026, final due **Monday, November 23, 2026**).

It organizes one cumulative engagement for the fictional client **CyberDome Corporation** across
all six labs: scope and authorization, reconnaissance, scanning and enumeration, vulnerability
analysis, attack evidence and timelines, an evidence-grounded AI analyst, and reporting. Every
number on screen is calculated from stored records, and every finding, event and AI citation traces
back to an Evidence ID (`EV-001`, `EV-002`, …).

> **Use only instructor-authorized systems, files, networks, and lab targets.** CyberDome only
> scans addresses that are on the Engagement page's authorized scope list. Exclusions are always
> enforced on the server.

---

## Install (Windows)

Download **`CyberDomeInstaller.exe`** from this repository's
[latest release](https://github.com/surafeldevelopment/cyberdome/releases/latest) and run it. It installs CyberDome into `C:\Program Files\CyberDome`
(Windows asks for permission once), adds Start menu and desktop shortcuts, and registers an uninstaller in
Settings > Apps. To run scans from the app, also install **Nmap** with Npcap from nmap.org.
Installed copies offer new versions automatically (Update now, Remind me later, or Skip this
version); publishing one is `npm run release -- <version> "<notes>"`.
Details, data location and uninstalling: [`docs/INSTALL.md`](docs/INSTALL.md).

## Run from source

Requirements: **Node.js 18.18 or newer** (20 LTS or 22 LTS recommended). On Node 22.13+ the app
uses Node's built-in `node:sqlite`; on older versions it uses the `better-sqlite3` package, which
`npm install` fetches as a prebuilt binary (no compilers needed). Optional: Nmap for in-app scans and
Wireshark's `tshark` for local PCAP summaries.

```bash
npm install
npm run build        # builds the web interface into dist/
npm start            # http://127.0.0.1:4646
```

Development mode with hot reload: `npm run dev` (web on http://127.0.0.1:5173, API on 4646). On
Windows, `scripts\start-dev.cmd` does the same with a double-click. Build the desktop app and its
installer with `npm run installer`; see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

Run the tests: `npm test` (synthetic fixtures only).

## Repository layout

```
server/     API, database, importers, scan runner and scheduler (Express + TypeScript)
web/        User interface (React + Vite)
desktop/    Windows desktop shell (Electron) and the installer build (NSIS)
docs/       Architecture, install, development, requirements and test documentation
samples/    Import templates and the synthetic demo data set
scripts/    Developer launcher for Windows
tests/      Automated tests (Vitest + Supertest)
```

### First run

The app creates one real engagement, **CyberDome Corporation · NWIT 246 Assessment**, with
the instructor packet's purpose, rules and prohibited actions prefilled and labeled as coming from
the packet. Targets, authorization reference, testing window and team are **empty and
unconfirmed** until you enter them. All modules start with truthful empty states.

To explore the interface with sample data, open **Settings → Demo data → Load demo engagement**.
The demo is a separate engagement built from the synthetic files in `samples/demo/` (RFC 5737
documentation addresses, `cyberdome.example`). While it is selected a striped **Demo Data** band is
always visible and all IDs carry a `DEMO-` prefix. Demo records can never be added to the real
engagement (the server refuses them).

---

## Modules

| Module | Lab | What it does |
|---|---|---|
| Executive Dashboard | All | Exposure matrix (hosts × open ports shaded by worst linked finding), calculated metrics with counting rules, severity/validation/remediation charts, most exposed assets, top-three risks, recent evidence, activity, checkpoints, missing requirements |
| Autopilot | 3, 4 | One-click pass over the authorized scope: service scan of every target, `-Pn` retry for silent targets, exposure rules that raise *Scanner-reported* findings to verify (with the scan evidence linked), optional host snapshot, live step-by-step progress |
| Engagement | 1 | **Read-only host snapshot** of this computer (connections, processes, accounts, scheduled tasks, network) saved as evidence for the signs-of-compromise review; client, purpose, authorization reference + confirmation, authorized/excluded targets with a scope checker, testing window/timezone, rules, prohibited actions, team roles, signs-of-compromise workflow |
| Recon | 2 | Observations classified as asset / technology / identity discovery or attack surface; source, collection time, evidence links, verification, next authorized step; CSV/JSON import |
| Scan & Enumeration | 3 | **Run Nmap from the app** (host discovery, quick or standard service scan; fixed arguments; authorized scope only; exclusions skipped; output hashed, stored as evidence and imported) plus Nmap XML / CSV / JSON import with preview, validation, partial-import warnings, duplicate and reimport handling, scope warnings; assets, current service inventory vs. historical observations; detected / inferred / unknown versions; normal purpose and investigation flags |
| Vulnerabilities | 4 | Normalized CSV/JSON, Nessus and Greenbone/OpenVAS import; scanner-reported vs. potential vs. analyst-validated vs. false positive vs. remediated; CVE/CVSS; NVD + CISA KEV reference panel; top-three prioritization with rationale; remediation tasks |
| Attack Evidence | 5 | Log import (CSV, JSON Lines, Wireshark/tshark CSV/JSON), optional local tshark PCAP processing, event filtering, timeline with original timestamps and uncertainty labels, indicators, ATT&CK mappings |
| AI Security Analyst | 6 | **Ask general questions with no evidence** (only the question is sent); server-side provider (Anthropic or OpenAI-compatible, incl. local Ollama); evidence selection + exact context preview; only sanitized evidence is sent; citation validation; **Unverified AI Draft** until a named reviewer verifies it |
| Evidence Locker | all | **Sanitization review queue** with one-click No sensitive data / Contains sensitive decisions; SHA-256 from file bytes, safe previews, sanitized derivatives, reference records, review history, withdraw/restore (IDs never reused), evidence index export |
| Reports | all | Report builder from records, readiness check, print-to-PDF layout, one-page executive summary, HTML/Markdown/JSON/CSV exports, evidence package zip with manifest |
| Team | All | Member cards with role, responsibilities, contribution statement, recorded activity, and role coverage |
| Project Tracker | All | Requirement checks for all six labs, required screenshots (capture app views or attach real tool screenshots), deliverables checklist, checkpoints, countdown |
| Demo Walkthrough | All | 10–12 minute presentation route with live data and a “how one finding was validated” chain |
| Settings | All | Analyst name, connection states, **AI provider setup in the page** (Anthropic, OpenAI, or local Ollama; key stored on the server only, with a connection test), reference data refresh, engagements, demo data, backup |

## Configuration

The AI provider is easiest to set in **Settings → AI provider** (saved to `data/ai-settings.json`,
which overrides `.env` and is excluded from backups). Alternatively copy `.env.example` to `.env`.
Everything is optional.

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `anthropic` or `openai` (any OpenAI-compatible endpoint) |
| `CYBERDOME_ANTHROPIC_API_KEY`, `CYBERDOME_ANTHROPIC_MODEL` | Anthropic credentials / model (default `claude-sonnet-5-5`) |
| `CYBERDOME_OPENAI_API_KEY`, `CYBERDOME_OPENAI_BASE_URL`, `CYBERDOME_OPENAI_MODEL` | OpenAI or local server such as Ollama (`http://localhost:11434/v1`) |
| `NVD_API_KEY` | Optional; higher NVD rate limits |
| `CYBERDOME_REFERENCES_ONLINE=false` | Disable all outbound reference lookups |
| `CYBERDOME_PORT`, `CYBERDOME_DATA_DIR`, `CYBERDOME_MAX_UPLOAD_MB` | Server port, data folder, upload limit |
| `CYBERDOME_NMAP_PATH`, `CYBERDOME_TSHARK_PATH` | Explicit tool paths if they are not on PATH |

Keys are read only on the server and never sent to the browser. Restart after changing `.env`.

## Import formats

Templates and format notes live in `samples/templates/` (`README-scan.md`, `README-findings.md`,
`README-logs.md`, `README-recon.md`). Each import screen also links its template.

| Data | Formats |
|---|---|
| Scans | Nmap XML (`nmap -sV -oX scan.xml <INSTRUCTOR-APPROVED-TARGET>`), CSV template, JSON template; unparseable text can be kept as raw evidence |
| Vulnerabilities | Normalized CSV/JSON template, Nessus `.nessus` (v2), Greenbone/OpenVAS XML report |
| Logs / packets | CSV template, JSON / JSON Lines, Wireshark “Export Packet Dissections → CSV”, `tshark -T fields` CSV, `tshark -T json`/`ek`; PCAP/PCAPNG processed locally by tshark when installed |
| Recon | CSV/JSON template |
| Evidence | Any screenshot, text output, log, CSV/JSON/XML, PDF, PCAP (executables are refused); or a reference with an analyst-supplied hash |

## Exports

From **Reports → Export**: report (print to PDF), one-page executive summary, HTML, Markdown,
engagement JSON, evidence index (CSV/JSON, always every matching record rather than one page), and the
**evidence package** zip (`manifest.json` with SHA-256 of every file, evidence originals and
sanitized derivatives, evidence index, report, data CSVs). Items marked as containing sensitive
data are excluded and listed in the manifest. Module pages export their own tables as CSV/JSON.

## Data, backup and restore

All data lives in `./data` (database `cyberdome.db` + `evidence/`). Back up from **Settings →
Backup** or `npm run backup`; restore with the server stopped: `npm run restore -- <backup.zip>`.
See `docs/BACKUP_RESTORE.md`.

## Security model

Local, **single-user, no login**. Bound to `127.0.0.1`, loopback-only Host check, CSRF header on
every change, no stack traces in responses, evidence stored outside the web root, uploaded markup
never rendered. Do not expose it on a network. Details: `docs/ARCHITECTURE.md`.

## Documentation

* `docs/INSTALL.md`: installing, updating and uninstalling the desktop app
* `docs/DEVELOPMENT.md`: repository layout, scripts and building the installer
* `docs/ARCHITECTURE.md`: stack, data flow, counting rules, provenance, security controls
* `docs/PRD.md`: product requirements as implemented (packet template)
* `docs/REQUIREMENTS_CHECKLIST.md`: packet and brief requirements mapped to features
* `docs/DEMO_GUIDE.md`: 10–12 minute classroom demonstration script
* `docs/EVIDENCE_TO_COLLECT.md`: what your team still needs to gather for each lab
* `docs/INTEGRATIONS.md`: external integrations and their connection states
* `docs/TEST_RESULTS.md`: automated and manual test results, known limitations
* `docs/BACKUP_RESTORE.md`: backup and restore procedures
