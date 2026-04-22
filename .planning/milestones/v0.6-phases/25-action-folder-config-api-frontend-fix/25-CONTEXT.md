# Phase 25: Action Folder Config API & Frontend Fix - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose the existing action folder configuration (prefix, folder names, enabled, pollInterval) via a web API, and fix the frontend rename guard that hardcodes `'Actions'` instead of reading from config. This is a gap closure phase — the config repo methods (`getActionFolderConfig`, `updateActionFolderConfig`, `onActionFolderConfigChange`) already exist and are wired into the startup lifecycle. This phase adds the HTTP layer and fixes the frontend.

</domain>

<decisions>
## Implementation Decisions

### API Route Design
- **D-01:** GET/PUT at `/api/config/action-folders`, matching the existing `review-config` route pattern exactly
- **D-02:** New file `src/web/routes/action-folder-config.ts` with `registerActionFolderConfigRoutes(app, deps)`
- **D-03:** GET returns `deps.configRepo.getActionFolderConfig()` directly
- **D-04:** PUT accepts partial config body, calls `deps.configRepo.updateActionFolderConfig(body)`, returns updated config

### Frontend Config Fetch
- **D-05:** Frontend fetches action folder prefix from `/api/config/action-folders` when the folder management settings section initializes (lazy load)
- **D-06:** Replace hardcoded `const actionPrefix = 'Actions'` at `app.ts:1661` with the prefix value from the API response

### Config Change Propagation
- **D-07:** PUT route calls `updateActionFolderConfig` which already fires `onActionFolderConfigChange` listeners — no additional wiring needed. The existing `index.ts:112` handler stops the poller, recreates folders, and restarts polling.

### Error Handling
- **D-08:** PUT validation errors return 400 with `{ error: 'Validation failed', details: [message] }`, matching the review-config pattern

### Claude's Discretion
- Whether to cache the action folder config on the frontend or fetch each time the settings section opens
- Exact function naming in the new route file
- Whether to add the config fetch to an existing frontend API module or inline it

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — CONF-01, CONF-02, CONF-03 requirement definitions

### Roadmap
- `.planning/ROADMAP.md` §Phase 25 — Success criteria (4 items)

### Prior Phase Context
- `.planning/phases/17-configuration-folder-lifecycle/17-CONTEXT.md` — Config schema decisions (D-01 through D-12)

### Pattern to Follow
- `src/web/routes/review-config.ts` — Exact pattern for GET/PUT config route (copy and adapt)
- `src/web/server.ts` — Route registration pattern (add import + register call)
- `src/config/repository.ts:130-151` — `getActionFolderConfig`, `updateActionFolderConfig`, `onActionFolderConfigChange` methods

### Files to Fix
- `src/web/frontend/app.ts:1661` — Hardcoded `const actionPrefix = 'Actions'` that needs to read from config API
- `src/web/routes/folders.ts:64` — Backend rename guard already reads from config (reference for correct pattern)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConfigRepository.getActionFolderConfig()` — Already exists, returns full config object
- `ConfigRepository.updateActionFolderConfig(input)` — Already exists, validates via Zod, fires change listeners, persists
- `registerReviewConfigRoutes` — Template for the new route file (nearly copy-paste)
- Backend rename guard in `folders.ts:64` — Shows correct pattern: `deps.configRepo.getActionFolderConfig().prefix || 'Actions'`

### Established Patterns
- Config routes: GET returns current config, PUT takes partial update body, 400 on validation failure
- Route registration: Import function in `server.ts`, call in `createServer()` body
- Frontend API calls: `api.ts` module with typed fetch wrappers

### Integration Points
- `src/web/server.ts` — Add import + `registerActionFolderConfigRoutes(app, deps)` call
- `src/web/frontend/app.ts:1661` — Replace hardcoded prefix with API-fetched value
- `src/web/frontend/api.ts` — Optional: add `getActionFolderConfig()` fetch wrapper

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The backend work is essentially copying review-config.ts and swapping the config method calls. The frontend fix needs to fetch the prefix before the rename guard evaluates.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 25-action-folder-config-api-frontend-fix*
*Context gathered: 2026-04-21*
