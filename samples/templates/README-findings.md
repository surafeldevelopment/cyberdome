# Vulnerability findings import formats

CyberDome imports vulnerability findings in four formats. Every import:

1. is **previewed first** (nothing is written until you confirm),
2. stores the original report file in the Evidence Locker with a SHA-256 calculated from its bytes,
3. links every created finding to that Evidence ID, and
4. lands findings as **Scanner-reported** (Nessus, Greenbone) or **Potential — requires verification**
   (normalized CSV/JSON). Nothing becomes *Analyst-validated* automatically: a version string or a CVE
   match is not validation. Validate each finding on its detail page with linked evidence and notes.

## 1. Normalized CSV (`findings-template.csv`)

| Column | Required | Notes |
| --- | --- | --- |
| `title` | yes | Short finding name |
| `severity` | yes | `critical`, `high`, `medium`, `low`, `info` (also accepts `informational`, `none`, `0`–`4`) |
| `host_ip` | no | IPv4 address of the affected host. Non-IP values are kept as a hostname (never guessed into an IP). |
| `port`, `protocol` | no | 1–65535; `tcp`/`udp` (defaults to `tcp` when a port is given) |
| `cves` | no | Comma/semicolon/space separated `CVE-YYYY-NNNN`. Malformed IDs are dropped with a warning. |
| `cvss_score` | no | 0–10 |
| `cvss_version`, `cvss_vector` | no | Version is inferred from a `CVSS:3.1/...` vector when omitted |
| `description`, `impact`, `remediation` | no | Free text |
| `scanner`, `plugin_id` | no | Used for re-import de-duplication |
| `evidence_note` | no | Appended to the description as source detail |

Unknown columns are reported in the preview and ignored. Rows missing a title or a recognizable
severity are rejected with their row number; the remaining rows can still be imported (a **partial import**).

## 2. Normalized JSON (`findings-template.json`)

Either an array of objects or `{ "findings": [ ... ] }` with the same field names. `cves` may be an array.

## 3. Nessus (`.nessus`, NessusClientData_v2)

Reads `ReportHost` (`host-ip`, `host-fqdn`) and each `ReportItem` (`severity` 0–4, `pluginID`, `pluginName`,
`port`/`protocol`/`svc_name`, `cve`, `cvss3_base_score`/`cvss3_vector` with CVSS v2 fallback, `synopsis`,
`description`, `plugin_output`, `solution`). Severity 0 (informational) rows are skipped unless
“Include informational results” is checked.

## 4. Greenbone / OpenVAS XML report

Accepts a `get_reports_response` or a bare `<report>`. Reads each `result` (`host`, `hostname`, `port`
such as `22/tcp` or `general/tcp`, `threat`, `severity`, `description`, `qod`) and its `nvt`
(`oid`, `name`, `cvss_base`, `severities` v3 vector, `tags` summary/insight/affected/impact/solution,
`solution`, `refs/ref type="cve"`). `Log` results are informational.

## Asset and service matching

Findings are linked to an existing asset when the host IP (or hostname) matches the asset inventory,
and to a service when the port/protocol matches that asset's current service inventory. **Hosts that
are not in the inventory are never created from a vulnerability report**; import the scan first, or
link the asset manually afterwards. The reported host is kept in the finding description.

## Re-imports

Each finding gets a de-duplication key: `scanner | plugin/NVT id (or title) | host | port/protocol`.
Re-importing the same or a newer report updates scanner-sourced fields (and severity only when the
severity basis is still “scanner”), adds the new evidence link, and never touches analyst fields
(validation, status, owner, priority, notes). Re-importing the identical file reuses the stored artifact.
