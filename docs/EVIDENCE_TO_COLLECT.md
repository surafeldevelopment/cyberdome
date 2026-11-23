# Evidence your team still needs to collect

The platform is complete, but the **real engagement is intentionally empty**: no lab evidence
was supplied while it was built, and nothing was invented. Everything below must come from your
instructor-approved lab work. The Project Tracker checks each item against your stored records.

## Before any lab work
- [ ] Written authorization reference from the instructor (Engagement → Overview)
- [ ] Authorized targets/networks exactly as assigned, and any excluded targets (Engagement → Scope)
- [ ] Testing window and timezone
- [ ] Team members, roles and responsibilities (Engagement → Team); set each person's name in Settings when they review

## Lab 1 — signs of compromise
- [ ] Instructor-approved Windows CMD or Kali output showing ≥ 5 possible signs of compromise (save each output as evidence: upload, or paste sanitized text)
- [ ] For each: observation, why suspicious, benign explanations, additional evidence needed, confidence, assessment
- [ ] Screenshots: Engagement page, two evidence items, indicator table (use **Capture view** on those pages)

## Lab 2 — recon
- [ ] ≥ 5 recon items about the fictional/instructor-approved target only (domains, ranges, technologies, naming patterns, instructor OSINT artifacts), each with source, note and next authorized step
- [ ] AI recon summary → verified with a student verification note
- [ ] Screenshots: Recon page, one evidence record, the verified AI summary

## Lab 3 — scanning
- [ ] Nmap XML from the assigned target, e.g. `nmap -sV -oX lab3-scan.xml <INSTRUCTOR-APPROVED-TARGET>` (import on Scan & Enumeration → Import)
- [ ] Normal purpose for ≥ 5 services; ≥ 1 service flagged with a reason
- [ ] AI scan interpretation (after the scan) → verified
- [ ] Screenshot of the scan command and result **from your own terminal** (the app cannot and will not generate this); asset table; AI interpretation

## Lab 4 — vulnerabilities
- [ ] Instructor-approved scanner report (Nessus `.nessus`, Greenbone XML) or instructor-provided findings (normalized CSV/JSON)
- [ ] ≥ 5 findings with asset, description, severity, evidence, impact, remediation; validate the ones you can confirm
- [ ] Top-three priorities with written rationale
- [ ] AI plain-language explanation for management → verified against scanner evidence
- [ ] Screenshots: severity dashboard, one finding page, top-three list

## Lab 5 — attack evidence
- [ ] The instructor-provided PCAP/log/host evidence package (upload the PCAP; import logs or a Wireshark/tshark export)
- [ ] ≥ 5 meaningful indicators/events with source, destination, time, event type, Evidence ID, interpretation
- [ ] ≥ 5 timeline events with your own interpretation; uncertain items marked “requires additional evidence”
- [ ] AI timeline summary generated **after** your analysis → verified
- [ ] Screenshots: analysis filter view, evidence table, completed timeline

## Lab 6 — AI analyst and reporting
- [ ] An AI provider configured in `.env` (or the instructor-approved tool you use — if you use an external tool instead, record its output as evidence and note that in the report)
- [ ] Verified AI sessions for: assessment summary, top-three risks, non-technical explanation, next investigative step, remediation priorities, executive summary; ATT&CK mapping only where evidence supports it, verified by a person
- [ ] Executive summary placed in the report; methodology, limitations, lessons learned written
- [ ] Screenshots: AI page, an evidence-grounded response, final report preview

## Final submission (Blackboard, by Monday, November 23, 2026)
- [ ] Working platform (local demo) · technical report (Reports → print to PDF) · one-page executive summary · evidence package zip · updated PRD (`docs/PRD.md`, fill in team fields) · presentation slides · repository export · team contribution statement
