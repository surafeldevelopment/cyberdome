# Test results

Run with `npm test`. All fixtures are **synthetic** (`tests/fixtures/synthetic/`, `samples/demo/`);
none are presented as assessment results. Real-format Nmap fixtures come from scanning the build
sandbox's own loopback interface.

**Automated: 143 tests in 15 files, all passing** (Node 22, vitest 2.1).

| File | Tests | Covers |
|---|---|---|
| core | 6 | Empty real engagement, CSRF header, loopback Host check, monotonic evidence IDs, demo isolation, executable refusal |
| engagement | 10 | Fields/timezone/window validation, authorization rules, scope + exclusions, team, deletion guard, tracker rules, sign-off refusal, backup → verify → restore |
| evidence | 15 | SHA-256 from bytes, duplicates, pasted text, references, filters/sort, index exports all records, cross-module links, review history, derivatives, withdraw/restore, tamper detection, safe previews, sandboxed downloads, 413 size limit |
| scans | 14 | Nmap XML preview/import, counting, detected vs. unknown versions, duplicate reimport (no inflation), rescans and older scans, malformed XML, CSV/JSON, scope warnings |
| vulns | 18 | Nessus, Greenbone, normalized CSV/JSON, partial imports, dedupe on reimport, validation requires evidence + notes, priorities, remediation tasks, exports |
| references | 9 | NVD parse/cache/not found/429/unreachable/disabled, KEV, ATT&CK, offline imports |
| recon | 9 | CRUD, verification, CSV/JSON import, malformed files, demo refusal, export |
| attack | 16 | Timestamp normalization (no invented times), Wireshark relative times, log imports, duplicates, timeline from log events, unplaced events, indicators, ATT&CK mappings, tshark processing |
| ai | 11 | 503 without provider, context preview, sanitized-only context, injection delimiters, citation validation, review workflow, report gating, proposed mappings, failures, OpenAI-compatible |
| reports | 8 | Assembly, readiness, narrative provenance, HTML escaping + DRAFT label, Markdown/JSON, package manifest hashes, sanitized-only package, demo labels |
| demo | 4 | Demo builds through real importers, `DEMO-` IDs, no AI sessions, real engagement stays empty, removal |
| collect | 8 | Target expansion and host cap, no scan outside the authorized scope list, private addresses never assumed authorized, exclusions dropped from arguments, injection and extra-argument rejection, demo refusal (the testing window is documented, not a gate), **real Nmap run against loopback imported as SCN/EV records**, host snapshot stored as unreviewed evidence, AI keys saved server-side and never returned |
| persistence | 1 | Records and files survive recreating the app on the same data folder |

## Acceptance workflows (brief §19)

| # | Workflow | Result |
|---|---|---|
| 1 | Create an engagement and define its scope | Pass (engagement tests; UI) |
| 2 | Import a real-format Nmap XML file | Pass (API + browser UI import) |
| 3 | Correct assets and services | Pass |
| 4 | Reimport without inflated totals | Pass |
| 5 | Open the original supporting evidence | Pass (API + browser: asset → evidence chip → evidence detail) |
| 6 | Create a finding linked to asset and evidence | Pass |
| 7 | Import log events and build a timeline | Pass |
| 8 | Filter records and follow cross-module links | Pass (API + browser: metric card → services, search) |
| 9 | Generate an AI response when a provider is configured | Pass **against a mock provider only**; not tested with a real model |
| 10 | Follow citations and review conclusions | Pass |
| 11 | Truthful unavailable state without a provider | Pass (API + browser) |
| 12 | Export a coherent report and evidence index | Pass; print-to-PDF rendered (13-page report, 1-page executive summary) |
| 13 | Restart without losing records | Pass (automated + manual server restart, identical metrics) |
| 14 | Demo data isolated from the real engagement | Pass |

## Manual / visual checks
* Every primary module rendered at 1440 px, plus tablet (1024 px) and phone (390 px) passes on key pages; no console errors.
* Browser flow (Playwright): UI scan import with preview → dashboard updates → metric card opens services → asset detail → evidence detail → global search → AI disconnected state. All passed.

## Known limitations
* No real AI model call was made during development (no API key available); configure one and run a Lab 6 task to confirm with your provider.
* NVD could not be reached from the build sandbox; its handling was verified with emulated responses.
* Single-user/no login; reviewer identity is self-declared.
* pcapng header timestamps assume microsecond resolution; tshark output is summary fields only.
