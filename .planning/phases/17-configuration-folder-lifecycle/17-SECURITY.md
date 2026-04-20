---
phase: 17
slug: configuration-folder-lifecycle
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-20
---

# Phase 17 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Config file -> Zod schema | User-provided YAML config values are untrusted input | String/number config values (prefix, folder names, pollInterval) |
| API -> ConfigRepository | Web UI config updates pass through repository validation | Partial<ActionFolderConfig> objects |
| Config -> folder names | User-configured folder names become IMAP mailbox paths | Folder name strings sent to IMAP server |
| IMAP server response | status() and createMailbox responses from remote server | Mailbox existence/creation results |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-17-01 | Tampering | actionFolderConfigSchema | mitigate | Zod `z.string().min(1)` on prefix and all folder names prevents empty/injection; `z.number().int().positive()` on pollInterval prevents zero/negative values (schema.ts:143-153) | closed |
| T-17-02 | Tampering | config/default.yml | accept | File permissions managed by deployment; same trust model as existing config sections | closed |
| T-17-03 | Denial of Service | pollInterval | mitigate | `z.number().int().positive()` prevents 0 or negative intervals; minimum 1 second enforced by schema (schema.ts:146) | closed |
| T-17-04 | Tampering | Folder name injection | mitigate | Zod min(1) validation on all folder names; array-form `createMailbox([prefix, name])` prevents separator injection (folders.ts:49); ImapFlow handles modified UTF-7 encoding | closed |
| T-17-05 | Denial of Service | IMAP server unavailable | mitigate | `ensureActionFolders` returns false on failure (folders.ts:53); caller logs warning and continues startup — graceful degradation | closed |
| T-17-06 | Information Disclosure | Error messages from IMAP | accept | Error objects logged via pino structured logging; no sensitive data in folder names; same pattern as existing IMAP error handling | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-17-01 | T-17-02 | Config file permissions are an operational concern managed by deployment infrastructure, not application code. Same trust model as all other config sections (imap, server, rules, review). | gsd-security-auditor | 2026-04-20 |
| AR-17-02 | T-17-06 | IMAP error messages are logged via pino structured logging. Folder names contain no sensitive data (they are user-configured display names). Error handling follows the same pattern as all existing IMAP operations. | gsd-security-auditor | 2026-04-20 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-20 | 6 | 6 | 0 | gsd-secure-phase orchestrator |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-20
