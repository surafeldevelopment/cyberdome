# CyberDome Command Center — Architecture

## Deployment model

**Local, single-user, no login.** The server binds to `127.0.0.1` by default and rejects
requests whose `Host` header is not loopback (DNS-rebinding guard). Mutating API calls must
carry an `X-CyberDome: 1` header, which browsers do not attach to cross-site form posts
(CSRF guard). There is no authentication, so **do not bind it to a LAN or public address**.
The reviewer identity used in activity logs and AI reviews is the self-declared
“Analyst name” from Settings — it is not an authenticated identity.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, TanStack Query, React Router | Typed SPA with cached server state and URL-synced filters |
| Backend | Node.js 22 + Express 4 + TypeScript (run with `tsx`) | One language end to end; no build step for the server |
| Database | SQLite via Node's built-in `node:sqlite` (Node ≥ 22.13) or `better-sqlite3` (older Node), WAL mode | No native compilation required, single file, easy backup |
| Schema | Ordered migrations in `server/db/migrations.ts`, recorded in `schema_migrations` | Reproducible schema setup on every start |
| Evidence storage | `data/evidence/<engagement>/<sha-prefix>/<uuid>.bin` (mode 0600) | Content stored outside the web root under random names; original filename kept only as metadata |
| Validation | `zod` on every request body | Clear field-level errors, no unvalidated writes |
| Parsing | `fast-xml-parser` (Nmap, Nessus, Greenbone XML), `papaparse` (CSV) | Pure JS, no external tools required |
| Packaging | `archiver` (zip evidence packages and backups) | |
| Optional | `tshark` (Wireshark CLI) | If installed, PCAPs can be summarized locally with fixed arguments |

## Data flow

```
                ┌──────────────── Evidence Locker (source of truth) ────────────────┐
 Upload / paste │ EV-### : bytes → SHA-256, detected type, source category, collected │
 / reference ──►│ time, observation, interpretation, confidence, sanitization, tags  │
                └──────┬─────────────┬──────────────┬──────────────┬────────────────┘
                       │             │              │              │
          Nmap XML/CSV/JSON   Nessus/Greenbone/   Logs / tshark   Recon CSV/JSON
                       │      normalized findings  exports / PCAP        │
                       ▼             ▼              ▼              ▼
   scan_imports ─► service_observations (history, append-only)    recon_observations
                       │
                       ▼
   assets (one per IP) ─► services (current inventory: one row per asset/port/protocol)
                       │
                       ▼
   findings ◄── finding_evidence / finding_assets / finding_services ──► remediation_tasks
                       │
   log_events ─► timeline_events ◄── timeline_evidence      indicators ◄── indicator_evidence
                       │
                       ▼
   ai_sessions (prompt context, Evidence IDs sent, response, citation check) ─► human_reviews
                       │
                       ▼
   reports (narrative + provenance of each section) ─► HTML / Markdown / print-to-PDF / zip package
```

Every module writes into the **same engagement**. Records reference evidence through link
tables, so one artifact can support many findings/events and a finding can cite many
artifacts.

## Identifiers

Human-readable codes are allocated per engagement from a monotonic counter table and are
**never reused**, even after a record is withdrawn or deleted: `EV-001` (evidence),
`AST-001` (asset), `SCN-001` (scan import), `FND-001` (finding), `VIM-001` (vulnerability
import), `REC-001` (recon), `IOC-001` (indicator), `LOG-001` (log import), `TL-001`
(timeline event), `AI-001` (AI session). Demo engagement codes are prefixed `DEMO-` so they
can never be mistaken for real evidence IDs.

## Counting rules (dashboard)

* **Assets** — distinct hosts per engagement (one asset per IP address).
* **Open service endpoints** — distinct (asset, port, protocol) whose *most recent*
  observation state is `open`. Imports append to `service_observations`; the `services`
  table is upserted, so re-importing a scan never inflates the total.
* **Findings** — all findings except those marked false positive.
* **Awaiting verification** — validation status scanner-reported or potential, not remediated.
* **Unresolved indicators** — assessment unassessed, suspicious, or requires more evidence.
* **Lab completion** — requirements met per lab, each checked against stored records.

No composite “security score” is computed.

## Data provenance

| Kind | Where it comes from | How the UI marks it |
|---|---|---|
| Imported | Parsed from an uploaded artifact | “Imported” + Evidence ID |
| Analyst-entered | Typed by a team member | “Analyst-entered” |
| Calculated | Derived from stored records at request time | “Calculated” + counting rule |
| External reference | NVD / CISA KEV / MITRE ATT&CK, cached with retrieval time | “External reference” + source, URL, time |
| AI-generated | Output of the configured model | “AI-generated”, **Unverified AI Draft** until reviewed |
| Human-verified | Reviewed by a named reviewer with a note | “Human-verified” |
| Demo | Separate demo engagement only | Persistent “Demo Data” band + `DEMO-` IDs |

## In-app collection

* **Nmap runs** (`server/services/nmapRunner.ts`). The server rebuilds the plan on every start
  request: the engagement must be real (not demo); the target (IPv4, CIDR, range, or hostname
  resolved server-side) is expanded to addresses, and each must match an authorized in-scope entry.
  The authorization reference and testing window are documented on the Engagement page and in the
  report; they do not gate scans.
  Excluded addresses are dropped; anything else outside scope refuses the whole run. Arguments come
  from three fixed profiles plus validated addresses, run with `execFile` (no shell), one scan at a
  time, 256 hosts, 30 minutes. The XML is stored as evidence (SHA-256) and imported through the same
  importer as uploads, so a run is recorded as `RUN-###` → `SCN-###` → `EV-###`.
* **Automatic schedules** (`server/services/scanScheduler.ts`). Repeat a scan every 1 hour to 1
  week until an end date at most 30 days away. Every run re-plans from the database, so a removed
  scope entry or a new exclusion skips the run.
* **Autopilot** (`server/services/autopilot.ts`). One pass over the authorized scope: readiness
  check, a service scan of every in-scope target, a `-Pn` retry for targets where no host
  answered, exposure rules, and an optional host snapshot. Each scan uses the same plan/start path
  as a manual run. Progress is stored per step in `autopilot_runs`.
* **Exposure rules** (`server/services/exposureRules.ts`). Open services such as Telnet, FTP, SMB,
  RDP, WinRM, VNC, network-reachable databases and cleartext HTTP raise findings labeled
  *Scanner-reported* (never validated automatically), linked to the asset, the service and the scan
  evidence. Impact and remediation stay empty for the analyst. A dedupe key prevents repeats.
* **Host snapshot** (`server/services/hostSnapshot.ts`). Fixed read-only OS commands on the
  computer running CyberDome, saved as a text evidence file marked *not reviewed*.
* **AI settings** (`server/services/aiSettings.ts`). Saved to `data/ai-settings.json` (mode 0600),
  applied in memory without a restart, never returned to the browser, excluded from backups.

## Security controls

* Loopback bind + Host header allow-list; custom-header CSRF guard.
* Evidence bytes hashed (SHA-256) on upload; re-verification on demand.
* Executables refused; type detection from bytes, not extensions.
* Raw downloads are `Content-Disposition: attachment` with `nosniff` and a sandbox CSP.
  Only raster images are previewed inline; HTML/SVG/scripts are shown as plain text.
* CSV exports neutralize spreadsheet formula injection.
* Secrets (AI keys, NVD key) live only on the server (environment variables or
  `data/ai-settings.json`) and are never sent to the browser. App-specific variable names avoid inheriting unrelated credentials.
* Uploaded evidence is never sent to external services automatically. The AI receives only
  evidence the analyst selected **and** marked sanitized, and the exact context is shown
  before sending.
* Errors return safe messages; stack traces stay in the server console.
