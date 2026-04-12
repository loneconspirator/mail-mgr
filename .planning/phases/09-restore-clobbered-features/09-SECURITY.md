---
phase: 9
slug: restore-clobbered-features
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-12
---

# Phase 9 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| client -> API | Batch/review/folder routes accept user input | JSON request bodies, query params |
| user input -> DOM | Frontend renders user-provided data | Email subjects, folder names, config values |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-09-01 | Information Disclosure | parseMessage envelopeHeader | accept | Pre-existing design: header name from config, not user input. No change from pre-clobber behavior. | closed |
| T-09-02 | — | — (pure restoration) | accept | Pure restoration — pre-existing security posture unchanged. | closed |
| T-09-03 | Spoofing | batch routes | accept | Pre-existing validation via Zod schemas, no new input surfaces added. | closed |
| T-09-04 | Information Disclosure | review-config route | accept | Pre-existing validation via reviewConfigSchema.safeParse, restored as-is. | closed |
| T-09-05 | Tampering | app.ts DOM rendering | mitigate | Phase 8's `esc()` XSS helper used for all user-provided data rendered to DOM. Batch UI uses textContent assignment (inherently safe). | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-09-01 | T-09-01 | Header name sourced from config file, not user input — no injection vector | plan author | 2026-04-12 |
| AR-09-02 | T-09-02 | Pure code restoration with no behavioral changes | plan author | 2026-04-12 |
| AR-09-03 | T-09-03 | Zod schema validation already in place, no new input surfaces | plan author | 2026-04-12 |
| AR-09-04 | T-09-04 | Zod safeParse validation restored unchanged | plan author | 2026-04-12 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-12 | 5 | 5 | 0 | gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-12
