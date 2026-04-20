---
phase: 13
slug: disposition-query-api
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-19
---

# Phase 13 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| client -> GET /api/dispositions | Query parameter `type` is untrusted user input | String query param from HTTP request |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-01 | Tampering | query param `type` | mitigate | Allowlist validation via `isValidDispositionType()` (line 33); safe `typeof` narrowing from `unknown` (lines 29-30); 400 response for invalid values | closed |
| T-13-02 | Info Disclosure | endpoint data exposure | accept | Single-user local app, no auth boundary. Endpoint returns subset of data already available via GET /api/rules. No new data exposure. | closed |
| T-13-03 | Denial of Service | filter performance | accept | In-memory filter over config rules array (typically <100 rules). No database queries, no expensive operations. Same cost as GET /api/rules. | closed |
| T-13-04 | Info Disclosure | isSenderOnly false positives | mitigate | Predicate checks all 6 EmailMatch fields (sender, recipient, subject, deliveredTo, visibility, readStatus). readStatus 'any' treated as equivalent to undefined. 25 unit tests validate behavior. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-13-01 | T-13-02 | Single-user local app with no auth boundary. Endpoint returns subset of existing rule data. No new information disclosure vector. | gsd-orchestrator | 2026-04-19 |
| AR-13-02 | T-13-03 | Filter runs over in-memory array of <100 rules. No amplification possible. Same computational cost as existing GET /api/rules endpoint. | gsd-orchestrator | 2026-04-19 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-19 | 4 | 4 | 0 | gsd-orchestrator |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-19
