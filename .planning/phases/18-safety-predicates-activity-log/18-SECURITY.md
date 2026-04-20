---
phase: 18
slug: safety-predicates-activity-log
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-20
---

# Phase 18 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| SQL queries | Source string inserted into parameterized query | Compile-time string literal, no user input |
| In-memory config | ACTION_REGISTRY and Rule[] from Zod-validated config | Static typed data, no external input |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-18-01 | Tampering | isSystemMove SQL | accept | Source value is compile-time string literal union, never user input. Parameterized query with `?` placeholder for message_id. No injection vector. | closed |
| T-18-02 | Information Disclosure | activity table | accept | Activity log is local SQLite, no network exposure. Same trust boundary as existing sources. | closed |
| T-18-03 | Tampering | ACTION_REGISTRY | accept | Static module-level constant. No user input can modify registry entries. Compile-time typed. | closed |
| T-18-04 | Tampering | findSenderRule | accept | Operates on Rule[] from ConfigRepository (Zod-validated). Sender comparison is case-insensitive exact match on pre-parsed email addresses. No injection vector. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-18-01 | T-18-01 | SQL IN clause uses parameterized queries; source values are compile-time literals from TypeScript union type | plan author | 2026-04-20 |
| AR-18-02 | T-18-02 | Local SQLite database, no network listeners, same trust model as existing activity log | plan author | 2026-04-20 |
| AR-18-03 | T-18-03 | Static Record constant frozen at module load, typed as Record<ActionType, ActionDefinition> | plan author | 2026-04-20 |
| AR-18-04 | T-18-04 | Input is Zod-validated config; sender matching uses simple toLowerCase() comparison | plan author | 2026-04-20 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-20 | 4 | 4 | 0 | gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-20
