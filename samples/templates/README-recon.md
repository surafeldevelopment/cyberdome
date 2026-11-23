# Recon import format (CSV or JSON)

Import authorized, instructor-approved reconnaissance observations into **Recon → Import**.
CyberDome never performs reconnaissance itself; it only stores what you collected.

| Column | Required | Allowed values / notes |
|---|---|---|
| `category` | no (default `other`) | `domain`, `ip_range`, `technology`, `naming_pattern`, `public_info`, `osint_artifact`, `other` |
| `classification` | **yes** | `asset_discovery`, `technology_discovery`, `identity_discovery`, `attack_surface` |
| `value` | **yes** | The observation itself (≤ 2000 chars) |
| `description` | no | What was observed |
| `source` | no* | Where it came from (*needed for Lab 2 completeness) |
| `collected_at` | no | ISO 8601; times without an offset are interpreted in the timezone chosen at import |
| `analyst_notes` | no* | Why it matters |
| `next_step` | no* | Proposed next **authorized** assessment step |

JSON: an array of objects with the same keys, or `{ "observations": [ ... ] }`.

Behavior: rows with errors are rejected and listed; unknown columns are ignored with a warning; the
import file is stored in the Evidence Locker (SHA-256 hashed) and linked to every imported row.
Template: `recon-template.csv`. Example (synthetic): `../demo/recon-demo.json`.
