# Phase 31: Auto-Healing & Failure Handling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 31-auto-healing-failure-handling
**Areas discussed:** Reference Update Scope, Notification Format, Rule Disabling Strategy, Re-planting Behavior
**Mode:** --auto (all decisions auto-selected)

---

## Reference Update Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Iterate all config sources, replace old path, persist via saveConfig() without listeners | Avoids pipeline rebuild per HEAL-02, updates rules + review config + action folder paths | ✓ |
| Use ConfigRepository update methods | Would trigger change listeners and cause full pipeline rebuilds | |

**User's choice:** [auto] Iterate all config sources, replace old path, persist via saveConfig() without listeners (recommended default)
**Notes:** HEAL-02 explicitly requires no full pipeline rebuilds. Direct saveConfig() bypasses all change listeners.

| Option | Description | Selected |
|--------|-------------|----------|
| Process each rename independently | Simple, multiple renames per scan window is rare | ✓ |
| Batch all renames from a scan report | Adds complexity for an unlikely scenario | |

**User's choice:** [auto] Process each rename independently (recommended default)

---

## Notification Format

| Option | Description | Selected |
|--------|-------------|----------|
| Plain text INBOX email via appendMessage() | Subject: [Mail Manager] Folder lost: {path}. Body explains what happened, affected rules, and fix suggestions | ✓ |
| Structured HTML email | More complex, mail clients render HTML inconsistently | |
| No notification (log only) | Would violate FAIL-02 requirement | |

**User's choice:** [auto] Plain text INBOX email via appendMessage() (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Track notified losses to avoid re-notifying | Prevent duplicate notifications on every scan cycle | ✓ |
| Notify on every scan | Would spam INBOX with duplicate notifications | |

**User's choice:** [auto] Track notified losses to avoid re-notifying (recommended default)

---

## Rule Disabling Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Set enabled: false on affected rules | Preserves rules for user to fix, non-destructive | ✓ |
| Delete affected rules | Destructive, user loses rule configuration | |
| Mark with special status | Would require schema changes | |

**User's choice:** [auto] Set enabled: false on affected rules (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Log warning for action folder paths, don't disable config | User can recreate folder or change config | ✓ |
| Disable action folder config | Too aggressive — folder may be temporarily inaccessible | |

**User's choice:** [auto] Log warning for action folder paths, don't disable config (recommended default)

---

## Re-planting Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Log to activity log, no INBOX notification | Self-healing operation, not user-facing. HEAL-04 requires logging. | ✓ |
| Silent re-plant (no logging) | Would violate HEAL-04 | |
| Notify user via INBOX | Unnecessarily noisy for self-healing | |

**User's choice:** [auto] Log to activity log, no INBOX notification (recommended default)

---

## Claude's Discretion

- Internal module structure
- Folder existence check method
- Activity log entry format
- Config update helper extraction
- Test organization

## Deferred Ideas

None — discussion stayed within phase scope
