# Scan import formats (Scan & Enumeration — Lab 3)

CyberDome imports scan results; it never runs scans itself. Run instructor-approved
commands against your assigned lab targets only, then import the output.

```
nmap -sV -oX scan.xml <INSTRUCTOR-APPROVED-TARGET>
```

Every imported file is stored unchanged in the Evidence Locker with a SHA-256 hash
calculated from its bytes, and gets an Evidence ID (EV-###) and a scan code (SCN-###).

## 1. Nmap XML (`-oX`) — preferred

Parsed fields: host status, IPv4/IPv6/MAC addresses, hostnames, port, protocol, state,
reason, service name, product, version, extra info, detection method and confidence,
OS matches (name + accuracy), command line, start/finish times, Nmap version.

Version rules:

| Nmap output | Stored as |
|---|---|
| `method="probed"` with a `version` attribute | **Detected** version |
| `method="probed"` with product but no version | Product kept, version **Unknown** |
| `method="table"` (port-table guess, no probe) | Service name only, version **Unknown** |

An unknown version is never promoted to a detected/confirmed version.
Hosts reported **down** are listed as warnings and do not create assets.

## 2. CSV template — `scan-template.csv`

| Column | Required | Notes |
|---|---|---|
| `host_ip` | yes | IPv4 or IPv6 address |
| `hostname` | no | |
| `port` | yes | 0–65535 |
| `protocol` | no | tcp (default), udp, sctp, ip |
| `state` | yes | open, closed, filtered, unfiltered, open\|filtered, closed\|filtered |
| `service` | no | e.g. ssh, http |
| `product` | no | e.g. OpenSSH |
| `version` | no | |
| `version_status` | no | detected, inferred, unknown. If a version is given without a status it is recorded as **inferred**, never detected. |
| `os` | no | OS observation as reported by your tool |
| `observed_at` | no | ISO 8601 preferred (`2026-10-12T14:07:00Z`). Values without an offset are read in the engagement timezone. Missing values stay unknown. |
| `notes` | no | Analyst note |

Lines starting with `#` are ignored. Unknown columns are reported as warnings and ignored.
Invalid rows are reported with their row number; valid rows still import (a **partial** import).

## 3. Structured JSON — `scan-template.json`

```json
{ "tool": "Nmap", "command": "...", "scanned_at": "2026-10-12T14:05:00Z",
  "hosts": [ { "ip": "192.0.2.10", "hostname": "web01", "os": "Linux",
               "ports": [ { "port": 22, "protocol": "tcp", "state": "open", "service": "ssh",
                            "product": "OpenSSH", "version": "8.2p1", "version_status": "detected" } ] } ] }
```

A flat JSON array of CSV-shaped rows is also accepted.

## 4. Anything else

Unparseable files (for example Nmap normal `-oN` output or a terminal transcript) can be
kept as **raw evidence** by ticking “Store as raw evidence”. No hosts or services are
extracted from them.

## Re-imports and duplicates

* Importing the identical file again is refused (same SHA-256) unless you explicitly record
  it as a separate scan run. Totals never inflate either way.
* The current service inventory holds one row per (asset, port, protocol). New scans update
  it only when their observation time is newer; older scans are added to history only.
* Every observation from every scan is kept in the service history.

The example rows in the templates use RFC 5737 documentation addresses and are SYNTHETIC.
