---
phase: 16
slug: inline-sender-management
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-20
---

# Phase 16 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser -> API | User input (sender pattern) crosses to backend via api.rules.create() | Sender pattern string, action type |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-16-01 | Spoofing | openAddSenderModal | accept | No auth in scope — single-user local app (PROJECT.md) | closed |
| T-16-02 | Tampering | api.rules.create payload | mitigate | Backend validates via `ruleSchema.safeParse()` in `src/config/repository.ts:32` | closed |
| T-16-03 | Information Disclosure | sender pattern in confirm() | accept | confirm() displays user's own data locally, no cross-user risk | closed |
| T-16-04 | Injection | sender pattern input | mitigate | `h()` helper uses `document.createTextNode()` (app.ts:22); `esc()` escapes HTML entities (app.ts:28-30). No raw innerHTML with user input. | closed |
| T-16-05 | Denial of Service | rapid add/remove clicks | mitigate | Submit button disabled during async (`submitBtn.disabled = true`, app.ts:394-395). Remove button disabled with `...` text (app.ts:493-494, 638-639). | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-16-01 | T-16-01 | Single-user local application; no authentication boundary exists or is needed | system | 2026-04-20 |
| AR-16-03 | T-16-03 | Sender data displayed in confirm() is the user's own data; no multi-user scenario | system | 2026-04-20 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-20 | 5 | 5 | 0 | gsd-secure-phase |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-20
