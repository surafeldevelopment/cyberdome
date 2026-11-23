# Integrations and connection states

| Integration | How it connects | States shown in the app | Verified during development |
|---|---|---|---|
| SQLite database | Built-in `node:sqlite`, file `data/cyberdome.db` | Connected / error (top bar, Settings) | Yes — all tests, restart persistence |
| AI — Anthropic | `POST {base}/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`; key saved in Settings (server file) or `CYBERDOME_ANTHROPIC_API_KEY` | Not configured · misconfigured · configured; per-request failures (401/403/429/529/timeout) stored as failed sessions | Request/response handling tested against a **mock provider in the test suite only**. No real model call was made (no key was available). |
| AI — OpenAI-compatible | `POST {base}/chat/completions` (Bearer key optional, e.g. local Ollama) | Same as above | Mock provider in tests only |
| NVD CVE API 2.0 | `services.nvd.nist.gov/rest/json/cves/2.0?cveId=…`, optional `apiKey` header | Fetched / cached (with retrieval time) / not found / rate-limited / unavailable / disabled | Parser tested with emulated responses; the real endpoint was blocked in the build sandbox and the app correctly reported “unavailable” |
| CISA KEV catalog | Official cisa.gov JSON feed; falls back to CISA's official GitHub mirror (`cisagov/kev-data`) and records which URL was used | Not loaded / loaded (catalog version, retrieval time) / refresh failed (cached copy kept) | Yes — real catalog 2026.10.16 (1,748 entries) via the GitHub mirror |
| MITRE ATT&CK | Official `mitre-attack/attack-stix-data` Enterprise STIX bundle | Not loaded / loaded (version, count) | Yes — real ATT&CK v20.0, 706 techniques |
| Offline reference import | Settings/References: upload NVD JSON, KEV JSON or ATT&CK STIX | Labeled “imported” | Tested |
| Nmap | Local `execFile` (no shell), fixed profile arguments, validated IPv4 addresses only, XML on stdout, 30 min limit | Found (version) / not found; per-run running · completed · failed · cancelled · interrupted | Yes — real runs against the sandbox's loopback (`127.0.0.1`), detecting a local HTTP service |
| Host snapshot | Fixed read-only OS commands (`netstat -ano`, `tasklist /svc`, `net user`, `net localgroup administrators`, `schtasks /query`, `ipconfig /all` on Windows; `ss`/`ps`/`who`/`ip` on Linux) | Per-command output or "unavailable" | Yes — Linux sandbox |
| tshark (Wireshark) | Local `execFile` with fixed arguments, 60 s timeout, size and packet limits | Available (version) / not installed | Yes — synthetic PCAP processed with TShark 4.2.2 |
| VirusTotal | Not implemented by design (no evidence upload path) | — | — |

Uploaded evidence is **never** sent to external services automatically. Reference lookups send
only the identifier (a CVE ID); the AI receives only evidence you selected and marked sanitized,
after you preview the exact context.
