# Classroom demonstration guide (10–12 minutes)

Open **Demo Walkthrough** in the left navigation: it has the same seven sections with a presenter
timer, live counts, and “Open live view” buttons. Present from your **real engagement** once
your evidence is imported; use the demo engagement only to rehearse, and say so if you show it.

**Before class:** run `npm start`, open http://127.0.0.1:4646, set your name in Settings, check
the status pills (Database green; AI green if you configured a provider), and confirm the report
readiness panel has no blockers. Every team member should present one section.

| Time | Section | Show | Say |
|---|---|---|---|
| 1 min | Scenario & scope | Engagement → Overview and Scope | Who CyberDome is, the written authorization reference, authorized vs. excluded targets, prohibited actions |
| 1 min | Architecture & navigation | Dashboard (exposure matrix, a metric's calculator popover), left navigation | One engagement, evidence-first data model, calculated metrics, local-only design |
| 2 min | Recon & scanning | Recon table (one useful observation and its next step); Scan & Enumeration → Services (versions marked Detected/Unknown, the flagged service) | How recon guided the scan; why the flagged service needs investigation |
| 2 min | Vulnerability prioritization | Vulnerabilities → Top-three priorities, then one finding detail | Why these three first: evidence strength, exposure, impact, asset importance, available fix — not only CVSS |
| 2 min | Attack evidence & timeline | Attack Evidence → Timeline (fact vs. assumption labels, an uncertain item); one evidence detail with its SHA-256 | What happened, in what order, and what is still uncertain |
| 2 min | Evidence-grounded AI | AI Analyst: select sanitized evidence → Preview context → open a verified session; click a citation chip | What the AI saw, how citations were checked, what the reviewer changed |
| 1 min | Recommendations | Reports → Preview (top remediation priorities, executive summary) | The three things CyberDome should fix first |
| 1 min | Lessons learned / Q&A | — | Where AI helped, where human verification was required |

## “How was this finding validated?”

Open the validated finding (Vulnerabilities → filter *Analyst-validated*). Walk the chain the
Demo Walkthrough shows: **finding → affected asset/service → supporting Evidence IDs (open one,
show the raw scan line and hash) → validation notes, reviewer and time → any AI explanation and
its human review**. Be explicit that a version string or CVE match alone was not treated as
confirmation.
