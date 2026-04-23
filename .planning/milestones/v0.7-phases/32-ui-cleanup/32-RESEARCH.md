# Phase 32: UI Cleanup - Research

**Researched:** 2026-04-22
**Domain:** Frontend/backend feature removal (TypeScript, vanilla DOM, Fastify)
**Confidence:** HIGH

## Summary

Phase 32 is a pure subtraction phase: remove the manual folder rename UI card and its backing API endpoint. The sentinel auto-healing system (Phase 31) makes manual folder renames unnecessary. The scope is narrow and well-defined -- 4 files modified, 1 test file to address, zero new code introduced.

The CONTEXT.md decisions are clear: hard-delete the API endpoint (no deprecation), remove all rename-related CSS, keep the low-level IMAP `renameFolder()` primitive. Research confirms all code references are isolated to the identified files with no hidden consumers.

**Primary recommendation:** Execute as a single plan with two waves -- backend removal first (route + test), then frontend removal (UI function, API client method, CSS, import cleanup).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Remove the `POST /api/folders/rename` endpoint entirely (hard delete, not deprecation). Rationale: single-user app with no external consumers -- a deprecation response adds complexity for zero benefit.
- **D-02:** Remove all rename-related CSS classes (`.rename-section`, `.rename-disabled-hint`, `.rename-warning`) from `styles.css`. Dead code should not linger.
- **D-03:** Keep `renameFolder()` on the folder cache (`src/folders/cache.ts`). It's a low-level IMAP primitive that the sentinel healer or future features may use. Only the UI-facing route and frontend code are removed.

### Claude's Discretion
- Whether to remove the `renderFolderRenameCard` function entirely or just remove its call site -- Claude should remove the function entirely since it will have no callers.
- Whether to remove the `api.folders.rename` client method -- Claude should remove it since the endpoint is being deleted.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Folder rename card is removed from the settings page | Remove `renderFolderRenameCard()` function (lines 1626-1809 of app.ts) and its call site (line 1006). Remove associated CSS classes. |
| UI-02 | Folder rename API endpoint is removed or deprecated | Hard-delete `POST /api/folders/rename` route handler (lines 28-89 of folders.ts) per D-01. Remove `findNode` helper (lines 5-11) which is only used by the rename handler. |
</phase_requirements>

## Standard Stack

No new libraries. This phase only removes code from existing files.

### Core (existing, unchanged)
| Library | Version | Purpose | Relevance |
|---------|---------|---------|-----------|
| Fastify | (existing) | HTTP server with route registration | Route removal target | [VERIFIED: codebase grep]
| Vitest | 4.0.18 | Test runner | Test file cleanup | [VERIFIED: npx vitest --version]
| TypeScript | (existing) | Type checking ensures clean removal | Compile check validates no dangling references | [VERIFIED: codebase grep]

## Architecture Patterns

### Removal Inventory

All items verified by codebase grep. No hidden consumers found. [VERIFIED: grep across src/]

#### Backend (src/web/routes/folders.ts)
| Lines | Element | Action | Reason |
|-------|---------|--------|--------|
| 5-11 | `findNode()` helper function | DELETE | Only used by rename handler |
| 28-89 | `POST /api/folders/rename` handler | DELETE | Per D-01 |

After removal, `folders.ts` will contain only the `GET /api/folders` route (lines 15-26) and the `registerFolderRoutes` export. The file retains its purpose. [VERIFIED: read folders.ts]

#### Frontend - app.ts (src/web/frontend/app.ts)
| Lines | Element | Action | Reason |
|-------|---------|--------|--------|
| 4 | `clearFolderCache` in import from `./folder-picker.js` | REMOVE from import | Only used inside rename card (lines 1771, 1790). `renderFolderPicker` stays. |
| 1006 | `await renderFolderRenameCard(app);` call site | DELETE | Removes the card from settings page |
| 1625-1809 | `renderFolderRenameCard()` function + comment header | DELETE | No callers after line 1006 removal |

#### Frontend - api.ts (src/web/frontend/api.ts)
| Lines | Element | Action | Reason |
|-------|---------|--------|--------|
| 82-85 | `rename` method on `api.folders` | DELETE | Endpoint being removed |

After removal, `api.folders` will contain only `list`. [VERIFIED: read api.ts]

#### Frontend - styles.css (src/web/frontend/styles.css)
| Lines | Element | Action | Reason |
|-------|---------|--------|--------|
| 684-689 | `.rename-section` + comment | DELETE | Per D-02 |
| 691-695 | `.field-error` | DELETE | Only used in rename card (app.ts:1712) |
| 697-700 | `.folder-selected` | DELETE | Zero JS references -- already dead code |
| 702-707 | `.rename-disabled-hint` | DELETE | Per D-02 |
| 709-716 | `.rename-warning` | DELETE | Per D-02 |

This removes lines 684-716 (end of file). The file ends cleanly at line 683. [VERIFIED: styles.css is 716 lines, content ends at 716]

#### Test file
| File | Action | Reason |
|------|--------|--------|
| `test/unit/web/folders-rename.test.ts` | DELETE entire file | Tests the removed endpoint; keeping it causes test failures |

### Files Explicitly Retained (per D-03)
- `src/folders/cache.ts` -- `renameFolder()` stays (IMAP primitive)
- `src/imap/client.ts` -- low-level IMAP rename stays
- `test/unit/imap/client-rename.test.ts` -- tests low-level IMAP rename (not the web route)

## Don't Hand-Roll

Not applicable -- this phase removes code, it does not add any.

## Common Pitfalls

### Pitfall 1: Forgetting the import cleanup
**What goes wrong:** Removing `renderFolderRenameCard` and its call but leaving `clearFolderCache` in the import causes a TypeScript unused-import warning (or lint error).
**How to avoid:** Remove `clearFolderCache` from the line 4 import. Keep `renderFolderPicker`.

### Pitfall 2: Leaving orphaned CSS
**What goes wrong:** Removing only the three classes named in D-02 but leaving `.field-error` and `.folder-selected` which are also only used by the rename card.
**How to avoid:** Remove the entire block from line 684 to end of file (716). All five classes in this block are rename-only.

### Pitfall 3: Not deleting the test file
**What goes wrong:** `test/unit/web/folders-rename.test.ts` tests the removed route handler. Vitest will fail on import errors.
**How to avoid:** Delete the test file. The `test/unit/imap/client-rename.test.ts` file stays (tests low-level IMAP, not the web route).

### Pitfall 4: Accidentally removing findNode usage outside folders.ts
**What goes wrong:** Searching broadly and removing the wrong thing.
**How to avoid:** `findNode` in `folders.ts` is a local function, not exported. Removal is scoped to that file only. [VERIFIED: grep confirms no other files reference it]

## Code Examples

### folders.ts after removal
```typescript
// Source: verified from src/web/routes/folders.ts lines 1-3, 14-26
import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerFolderRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/folders', async (request, reply) => {
    const query = request.query as { refresh?: string };
    const forceRefresh = query.refresh === 'true';
    try {
      const cache = deps.getFolderCache();
      await cache.getTree(forceRefresh);
      return cache.getResponse();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return reply.status(503).send({ error: 'Folder list unavailable - IMAP not connected' });
    }
  });
}
```

### api.ts folders object after removal
```typescript
// Source: verified from src/web/frontend/api.ts lines 80-86
folders: {
  list: () => request<FolderTreeResponse>('/api/folders'),
},
```

### app.ts import after cleanup
```typescript
// Source: verified from src/web/frontend/app.ts line 4
import { renderFolderPicker } from './folder-picker.js';
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/web/folders.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Rename card absent from settings page | manual-only | Visual check: load settings page | N/A |
| UI-02 | Rename API returns 404 | smoke | `npx vitest run test/unit/web/folders.test.ts` (verify no rename route registered) | Existing file covers GET /api/folders |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/web/` -- verify web route tests pass
- **Per wave merge:** `npx vitest run` -- full suite
- **Phase gate:** Full suite green + TypeScript compile (`npx tsc --noEmit`)

### Wave 0 Gaps
None -- existing test infrastructure covers all needs. The main validation is that `npx tsc --noEmit` compiles cleanly (no dangling references) and `npx vitest run` passes (no import errors from deleted test file).

## Security Domain

Not applicable. This phase removes an authenticated endpoint -- it reduces attack surface. No new inputs, outputs, or data flows are introduced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| (none) | All claims verified via codebase grep and tool execution | — | — |

**All claims in this research were verified or cited -- no user confirmation needed.**

## Open Questions

None. The scope is fully defined by CONTEXT.md decisions and verified against the codebase.

## Sources

### Primary (HIGH confidence)
- Codebase grep across `src/` and `test/` -- verified all rename references
- Direct file reads of all 4 target files and 1 test file
- `npx vitest --version` -- confirmed Vitest 4.0.18

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, existing stack verified
- Architecture: HIGH - all code locations verified by grep and read
- Pitfalls: HIGH - exhaustive grep confirms no hidden references

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (stable -- pure removal, no external dependencies)
