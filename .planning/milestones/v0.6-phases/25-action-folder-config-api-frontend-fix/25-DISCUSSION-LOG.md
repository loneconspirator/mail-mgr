# Phase 25: Action Folder Config API & Frontend Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 25-action-folder-config-api-frontend-fix
**Areas discussed:** API route design, Frontend config fetch, Config change propagation, Error handling
**Mode:** --auto (all areas auto-selected, recommended defaults chosen)

---

## API Route Design

| Option | Description | Selected |
|--------|-------------|----------|
| GET/PUT `/api/config/action-folders` | Matches existing review-config route pattern | ✓ |
| Embed in existing settings route | Fewer files but inconsistent with per-domain routes | |
| REST resource `/api/action-folders/config` | More RESTful but deviates from codebase convention | |

**User's choice:** [auto] GET/PUT `/api/config/action-folders` (recommended default)
**Notes:** Follows the exact same pattern as review-config.ts — minimal new code, maximum consistency.

---

## Frontend Config Fetch

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch on settings section load | Lazy load when folder management opens | ✓ |
| Fetch on app init | Available immediately but unnecessary overhead | |
| Embed in server-rendered config | Would require template changes | |

**User's choice:** [auto] Fetch from `/api/config/action-folders` when folder management section loads (recommended default)
**Notes:** Only the settings page needs the prefix; no reason to fetch eagerly.

---

## Config Change Propagation

| Option | Description | Selected |
|--------|-------------|----------|
| PUT calls updateActionFolderConfig (existing wiring) | Fires onActionFolderConfigChange listeners automatically | ✓ |
| Manual listener notification | Redundant — repo method already does this | |

**User's choice:** [auto] PUT calls updateActionFolderConfig which fires existing listeners (recommended default)
**Notes:** The config repo and index.ts handler from Phase 17 already handle the full lifecycle.

---

## Error Handling

| Option | Description | Selected |
|--------|-------------|----------|
| 400 with error details | Matches review-config pattern | ✓ |
| 422 Unprocessable Entity | More semantically correct but inconsistent | |

**User's choice:** [auto] 400 response matching review-config pattern (recommended default)
**Notes:** Consistency with existing routes trumps HTTP purity.

---

## Claude's Discretion

- Frontend caching strategy for config fetch
- Exact function/variable naming in new route file
- Whether to add API wrapper to api.ts or inline the fetch

## Deferred Ideas

None — all decisions stayed within phase scope.
