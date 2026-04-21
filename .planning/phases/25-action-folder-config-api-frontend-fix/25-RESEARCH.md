# Phase 25: Action Folder Config API & Frontend Fix - Research

**Researched:** 2026-04-21
**Domain:** Fastify REST API routes, TypeScript frontend fetch, Zod-validated config
**Confidence:** HIGH

## Summary

This is a straightforward gap closure phase. All the backend config infrastructure already exists (`getActionFolderConfig`, `updateActionFolderConfig`, `onActionFolderConfigChange` in ConfigRepository). The phase adds an HTTP layer by copying the proven `review-config.ts` route pattern, and fixes one hardcoded string in the frontend.

The `review-config.ts` route file is an almost exact template -- swap `Review` for `ActionFolder` and adjust method names. The frontend fix at `app.ts:1661` replaces `const actionPrefix = 'Actions'` with a value fetched from the new API. The change listener wiring (D-07) is already complete in `index.ts:112`.

**Primary recommendation:** Copy `review-config.ts` verbatim, rename methods, add `ActionFolderConfig` to shared types, add `getActionFolders`/`updateActionFolders` to `api.ts`, and fix the frontend hardcoded prefix.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** GET/PUT at `/api/config/action-folders`, matching the existing `review-config` route pattern exactly
- **D-02:** New file `src/web/routes/action-folder-config.ts` with `registerActionFolderConfigRoutes(app, deps)`
- **D-03:** GET returns `deps.configRepo.getActionFolderConfig()` directly
- **D-04:** PUT accepts partial config body, calls `deps.configRepo.updateActionFolderConfig(body)`, returns updated config
- **D-05:** Frontend fetches action folder prefix from `/api/config/action-folders` when the folder management settings section initializes (lazy load)
- **D-06:** Replace hardcoded `const actionPrefix = 'Actions'` at `app.ts:1661` with the prefix value from the API response
- **D-07:** PUT route calls `updateActionFolderConfig` which already fires `onActionFolderConfigChange` listeners -- no additional wiring needed. The existing `index.ts:112` handler stops the poller, recreates folders, and restarts polling.
- **D-08:** PUT validation errors return 400 with `{ error: 'Validation failed', details: [message] }`, matching the review-config pattern

### Claude's Discretion
- Whether to cache the action folder config on the frontend or fetch each time the settings section opens
- Exact function naming in the new route file
- Whether to add the config fetch to an existing frontend API module or inline it

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONF-01 | Action folder prefix and folder names are configurable with sensible defaults | API route exposes `getActionFolderConfig()` which returns prefix, folder names; `updateActionFolderConfig()` accepts partial updates with Zod validation and defaults |
| CONF-02 | Action folders can be enabled/disabled via config | `ActionFolderConfig.enabled` field exists in schema; PUT route accepts `{ enabled: false }` partial update |
| CONF-03 | Poll interval is configurable | `ActionFolderConfig.pollInterval` field exists in schema; PUT route accepts `{ pollInterval: N }` partial update; change listener rebuilds poller |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | (existing) | HTTP server | Already used for all routes [VERIFIED: codebase] |
| zod | (existing) | Config validation | Already validates ActionFolderConfig schema [VERIFIED: codebase] |

No new dependencies required. This phase uses only existing libraries. [VERIFIED: codebase grep]

## Architecture Patterns

### Recommended Project Structure
```
src/web/routes/
  action-folder-config.ts  # NEW: GET/PUT /api/config/action-folders
src/web/
  server.ts                # MODIFY: add import + register call
src/web/frontend/
  api.ts                   # MODIFY: add config.getActionFolders / updateActionFolders
  app.ts                   # MODIFY: fix hardcoded prefix at line 1661
src/shared/
  types.ts                 # MODIFY: export ActionFolderConfig type
```

### Pattern 1: Config Route (copy from review-config.ts)
**What:** GET returns config object, PUT accepts partial body with Zod validation
**When to use:** Every config domain route in this project follows this pattern
**Example:**
```typescript
// Source: src/web/routes/review-config.ts (verified in codebase)
import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerActionFolderConfigRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/config/action-folders', async () => {
    return deps.configRepo.getActionFolderConfig();
  });

  app.put('/api/config/action-folders', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const updated = await deps.configRepo.updateActionFolderConfig(body as any);
      return updated;
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });
}
```
[VERIFIED: exact pattern from review-config.ts in codebase]

### Pattern 2: Route Registration
**What:** Import + call in server.ts buildServer function
**Example:**
```typescript
// In server.ts imports:
import { registerActionFolderConfigRoutes } from './routes/action-folder-config.js';

// In buildServer body (after existing registerReviewConfigRoutes):
registerActionFolderConfigRoutes(app, deps);
```
[VERIFIED: server.ts registration pattern in codebase]

### Pattern 3: Frontend API Module Extension
**What:** Add methods to `api.config` namespace in `api.ts`
**Example:**
```typescript
// In api.ts config section:
getActionFolders: () => request<ActionFolderConfig>('/api/config/action-folders'),
updateActionFolders: (cfg: Partial<ActionFolderConfig>) =>
  request<ActionFolderConfig>('/api/config/action-folders', {
    method: 'PUT', body: JSON.stringify(cfg)
  }),
```
[VERIFIED: matches existing api.config.getReview / updateReview pattern]

### Pattern 4: Frontend Prefix Fix
**What:** Replace hardcoded `'Actions'` with API-fetched prefix
**Current code (app.ts:1661):**
```typescript
const actionPrefix = 'Actions';  // HARDCODED -- must fix
```
**Backend reference (folders.ts:64):**
```typescript
const actionPrefix = deps.configRepo.getActionFolderConfig().prefix || 'Actions';
```
**Frontend fix approach:** Fetch prefix from API when folder management section initializes, fall back to `'Actions'` if fetch fails.
[VERIFIED: both files read from codebase]

### Anti-Patterns to Avoid
- **Inlining fetch calls in app.ts:** Use the `api.ts` module like every other API call in the frontend [VERIFIED: codebase convention]
- **Adding new dependencies:** This is pure wiring -- no new packages needed

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config validation | Custom validation | Zod schema (already exists) | `actionFolderConfigSchema` handles all validation including nested `folders` object [VERIFIED: schema.ts] |
| Change propagation | Custom event system | `updateActionFolderConfig` listener pattern | Already fires `onActionFolderConfigChange` listeners and persists [VERIFIED: repository.ts:134-147] |
| Error formatting | Custom error handler | Existing 400 pattern | `{ error: 'Validation failed', details: [message] }` is the project standard [VERIFIED: review-config.ts] |

## Common Pitfalls

### Pitfall 1: Forgetting to Export ActionFolderConfig in shared/types.ts
**What goes wrong:** Frontend can't import the type for API response typing
**Why it happens:** ActionFolderConfig is exported from config/schema.ts and config/index.ts but NOT from shared/types.ts
**How to avoid:** Add `ActionFolderConfig` to the re-exports in shared/types.ts
**Warning signs:** TypeScript compilation error in frontend api.ts
[VERIFIED: grep confirmed ActionFolderConfig absent from shared/types.ts]

### Pitfall 2: Frontend Fetch Race Condition
**What goes wrong:** The `handleFolderSelection` function runs before the config API response arrives, using stale/undefined prefix
**Why it happens:** If config is fetched lazily when settings section opens, but folder selection happens before response
**How to avoid:** Fetch config when section initializes, store in closure variable with `'Actions'` default; the fetch fills in the real value before user interaction is likely
**Warning signs:** Action folders temporarily not blocked from rename on slow connections

### Pitfall 3: Missing .js Extension in Import
**What goes wrong:** ESM module resolution fails at runtime
**Why it happens:** This project uses ESM with `.js` extensions in imports
**How to avoid:** Use `'./routes/action-folder-config.js'` not `'./routes/action-folder-config'`
**Warning signs:** Runtime "Cannot find module" error
[VERIFIED: all existing imports in server.ts use .js extension]

### Pitfall 4: Missing ServerDeps Properties in Test Mock
**What goes wrong:** Tests fail because `makeDeps()` doesn't return required properties
**Why it happens:** `ServerDeps` interface may require properties not provided by older test helpers
**How to avoid:** Check current `makeDeps` in test/unit/web/api.test.ts and add any missing properties (getMoveTracker, getProposalStore were added in recent phases)
**Warning signs:** TypeScript errors in test file
[VERIFIED: api.test.ts makeDeps function exists but may be outdated vs ServerDeps interface]

## Code Examples

### Complete Route File (action-folder-config.ts)
```typescript
// Source: adapted from src/web/routes/review-config.ts [VERIFIED]
import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerActionFolderConfigRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/config/action-folders', async () => {
    return deps.configRepo.getActionFolderConfig();
  });

  app.put('/api/config/action-folders', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const updated = await deps.configRepo.updateActionFolderConfig(body as any);
      return updated;
    } catch (err: any) {
      return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
    }
  });
}
```

### Frontend API Addition (api.ts)
```typescript
// Add to api.config object [VERIFIED: matches existing pattern]
getActionFolders: () => request<ActionFolderConfig>('/api/config/action-folders'),
updateActionFolders: (cfg: Partial<ActionFolderConfig>) =>
  request<ActionFolderConfig>('/api/config/action-folders', {
    method: 'PUT', body: JSON.stringify(cfg)
  }),
```

### Frontend Prefix Fix (app.ts ~line 1661)
```typescript
// Before (hardcoded):
const actionPrefix = 'Actions';

// After (from API, with fallback):
const actionPrefix = actionFolderPrefix ?? 'Actions';
// where actionFolderPrefix was fetched when settings section initialized
```

## ActionFolderConfig Schema Reference

```typescript
// Source: src/config/schema.ts [VERIFIED]
{
  enabled: boolean,       // default: true
  prefix: string,         // default: 'Actions', min length 1
  pollInterval: number,   // default: 15, positive integer
  folders: {
    vip: string,          // default: 'Star VIP Sender'
    block: string,        // default: 'No Entry Block Sender'
    undoVip: string,      // default: 'Left Arrow Undo VIP'
    unblock: string,      // default: 'Check Unblock Sender'
  }
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/web/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | GET /api/config/action-folders returns config with prefix+folders | unit | `npx vitest run test/unit/web/action-folder-config.test.ts -t "GET"` | No -- Wave 0 |
| CONF-01 | PUT /api/config/action-folders updates prefix and folder names | unit | `npx vitest run test/unit/web/action-folder-config.test.ts -t "PUT"` | No -- Wave 0 |
| CONF-02 | PUT can set enabled=false | unit | `npx vitest run test/unit/web/action-folder-config.test.ts -t "enabled"` | No -- Wave 0 |
| CONF-03 | PUT can update pollInterval | unit | `npx vitest run test/unit/web/action-folder-config.test.ts -t "pollInterval"` | No -- Wave 0 |
| CONF-01 | PUT with invalid body returns 400 | unit | `npx vitest run test/unit/web/action-folder-config.test.ts -t "validation"` | No -- Wave 0 |
| CONF-01 | Frontend uses prefix from API not hardcoded | manual-only | Visual check: change prefix in config, verify rename guard uses new prefix | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/web/action-folder-config.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/web/action-folder-config.test.ts` -- covers CONF-01, CONF-02, CONF-03 API routes
- No framework install needed -- vitest already configured

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A (no auth in this project) |
| V3 Session Management | no | N/A |
| V4 Access Control | no | Local-only app, no RBAC |
| V5 Input Validation | yes | Zod schema validation on PUT body (already implemented in `updateActionFolderConfig`) |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed config body crashes server | Tampering | Zod safeParse + 400 error response (already in repository.ts) |
| XSS via folder name in config | Tampering | Frontend renders folder names as text nodes, not innerHTML [ASSUMED] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Frontend renders folder names as text not innerHTML | Security Domain | XSS if folder names are rendered as HTML -- low risk since this is a local-only app |

## Open Questions

None -- this phase is fully constrained by CONTEXT.md decisions and the codebase provides clear patterns to follow.

## Sources

### Primary (HIGH confidence)
- `src/web/routes/review-config.ts` -- exact template for new route file
- `src/web/server.ts` -- route registration pattern
- `src/config/repository.ts:130-151` -- existing ActionFolderConfig methods
- `src/config/schema.ts:131-153` -- ActionFolderConfig schema and defaults
- `src/web/frontend/api.ts` -- frontend API module pattern
- `src/web/frontend/app.ts:1661` -- hardcoded prefix to fix
- `src/web/routes/folders.ts:64` -- correct backend pattern reading from config
- `src/index.ts:112` -- change listener already wired
- `src/shared/types.ts` -- confirmed ActionFolderConfig NOT exported (needs adding)
- `test/unit/web/api.test.ts` -- test helper pattern for route tests

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure wiring
- Architecture: HIGH -- exact template exists in review-config.ts
- Pitfalls: HIGH -- codebase inspection reveals all integration points

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable -- internal codebase patterns)
