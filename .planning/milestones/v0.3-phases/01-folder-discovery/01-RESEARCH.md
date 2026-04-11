# Phase 1: Folder Discovery - Research

**Researched:** 2026-04-06
**Domain:** IMAP folder listing, server-side caching, Fastify route patterns
**Confidence:** HIGH

## Summary

Phase 1 adds three capabilities: exposing the IMAP folder hierarchy via a REST endpoint, caching that list server-side with TTL and manual refresh, and warning users when a rule references a nonexistent folder. The existing codebase already uses imapflow's `list()` method for special-use folder detection, so the primary new call is `listTree()` which returns folders in a nested tree structure ready for the API response. The caching layer is a simple in-memory store with timestamp-based TTL -- no external cache library needed.

The rule validation (FOLD-03) integrates with the existing rule save flow in `ConfigRepository.addRule()` and `updateRule()`. The requirement says "warn, not block" -- meaning the API should still accept the rule but include a warning in the response. This is a response-shape change, not a validation rejection.

**Primary recommendation:** Add `listTree()` to the `ImapFlowLike` interface, build a `FolderCache` class in `src/folders/`, expose it via a new route registrar, and hook folder validation into the existing rule save routes as a non-blocking warning.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOLD-01 | System discovers IMAP folder hierarchy via `listTree()` and exposes it at `GET /api/folders` | imapflow's `listTree()` returns `ListTreeResponse` with nested `folders` arrays -- maps directly to API response. Must add `listTree` to `ImapFlowLike` interface. |
| FOLD-02 | Folder list is cached server-side with configurable TTL and manual refresh endpoint | Simple in-memory cache with `lastFetched` timestamp. TTL from config, manual refresh via `POST /api/folders/refresh` or query param `?refresh=true`. |
| FOLD-03 | Rule save validates destination folder against cached folder list (warn, not block) | Rule save response gains optional `warnings` array. Validation checks `action.folder` against cached folder paths. If cache is empty/stale, skip validation rather than block. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 1.2.8 | IMAP `listTree()` for folder hierarchy | Already in use; `listTree()` is the built-in method for hierarchical folder listing |

### Supporting
No new dependencies needed. The cache is simple enough to implement with a class and a `Date.now()` timestamp.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory cache | node-cache, lru-cache | Overkill for single-value cache with simple TTL; adds dependency for no benefit |
| `listTree()` | `list()` + manual tree building | `listTree()` already does the work; `list()` returns flat array requiring manual nesting |

## Architecture Patterns

### Recommended Project Structure
```
src/
  folders/
    index.ts          # barrel exports
    cache.ts          # FolderCache class (in-memory cache with TTL)
  web/
    routes/
      folders.ts      # registerFolderRoutes (GET /api/folders, POST /api/folders/refresh)
  shared/
    types.ts          # Add FolderNode and FolderTreeResponse types
```

### Pattern 1: FolderCache Class
**What:** In-memory cache holding the folder tree with timestamp-based TTL and manual refresh
**When to use:** Any time we need the folder list (API response, rule validation)
**Example:**
```typescript
// Source: project conventions (dependency injection pattern from MonitorDeps, SweepDeps)
export interface FolderCacheDeps {
  imapClient: ImapClient
  ttlMs: number
}

export class FolderCache {
  private tree: FolderNode[] | null = null
  private lastFetched: number = 0
  private readonly deps: FolderCacheDeps

  constructor(deps: FolderCacheDeps) {
    this.deps = deps
  }

  async getTree(forceRefresh?: boolean): Promise<FolderNode[]> {
    if (!forceRefresh && this.tree && (Date.now() - this.lastFetched < this.deps.ttlMs)) {
      return this.tree
    }
    return this.refresh()
  }

  async refresh(): Promise<FolderNode[]> {
    // call listTree via ImapClient, transform to FolderNode[], update cache
  }

  hasFolder(path: string): boolean {
    // recursive search through cached tree for path match
  }
}
```

### Pattern 2: Non-Blocking Rule Validation Warning
**What:** Rule save returns `{ rule, warnings? }` instead of just `rule` when destination folder not found
**When to use:** POST/PUT `/api/rules` when action type is `move` or `review` with a folder
**Example:**
```typescript
// In rules route handler, after successful save:
const warnings: string[] = []
if (rule.action.type === 'move' || (rule.action.type === 'review' && rule.action.folder)) {
  const folder = rule.action.type === 'move' ? rule.action.folder : rule.action.folder
  if (folder && folderCache.tree && !folderCache.hasFolder(folder)) {
    warnings.push(`Destination folder "${folder}" not found on server`)
  }
}
return { ...rule, warnings: warnings.length > 0 ? warnings : undefined }
```

### Pattern 3: ImapFlowLike Extension
**What:** Add `listTree()` to the existing `ImapFlowLike` interface
**When to use:** Required for type-safe folder listing through ImapClient
**Example:**
```typescript
// Add to ImapFlowLike interface in src/imap/client.ts
listTree(options?: Record<string, unknown>): Promise<unknown>
```

### Anti-Patterns to Avoid
- **Fetching folder list on every request:** Always serve from cache; IMAP LIST is slow on large accounts with hundreds of folders
- **Blocking rule save on IMAP errors:** If folder cache is unavailable (disconnected, never fetched), skip validation entirely rather than failing the save
- **Storing folder cache in SQLite:** This data is ephemeral, changes with server state; in-memory is correct
- **Using `list()` instead of `listTree()`:** The flat list requires manual tree construction; `listTree()` does it natively

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Folder tree construction | Manual parent-child linking from flat list | imapflow `listTree()` | Handles delimiter differences, special-use detection, sorting |
| IMAP connection management | New connection for folder listing | Existing `ImapClient` | Already handles reconnect, backoff, lifecycle |

**Key insight:** The folder list does not require a mailbox lock -- `listTree()` operates at the connection level (like `list()` already used in `getSpecialUseFolder()`), so no `withMailboxLock` needed.

## Common Pitfalls

### Pitfall 1: listTree Requires Active Connection
**What goes wrong:** Calling `listTree()` when ImapClient is disconnected throws "Not connected"
**Why it happens:** ImapClient may be in reconnect backoff or not yet connected at startup
**How to avoid:** Return cached data if available; if no cache and disconnected, return 503 with clear error message
**Warning signs:** Test passes with mock but fails in integration

### Pitfall 2: ImapFlowLike Interface Missing listTree
**What goes wrong:** TypeScript compilation fails because `listTree` not on `ImapFlowLike`
**Why it happens:** The interface was built for the original feature set; needs extension
**How to avoid:** Add `listTree` to `ImapFlowLike` interface and update all mock factories in tests

### Pitfall 3: Flags are Sets, Not Arrays
**What goes wrong:** JSON serialization of `Set` produces `{}` instead of array
**Why it happens:** `ListTreeResponse.flags` is a `Set<string>` in imapflow; `JSON.stringify(new Set())` returns `{}`
**How to avoid:** Convert `Set` to `Array` when transforming `ListTreeResponse` to API response type
**Warning signs:** Empty `flags` object in API response instead of array

### Pitfall 4: Warning Response Shape Breaks Frontend
**What goes wrong:** Frontend expects `Rule` object from POST/PUT, gets `{ rule, warnings }` wrapper
**Why it happens:** Changing the response shape is a breaking change
**How to avoid:** Two options: (a) return warnings as a response header, or (b) add optional `warnings` field directly on the rule response object. Option (b) is simpler and matches the "warn" requirement. The frontend can check for and display warnings without breaking existing parsing.

### Pitfall 5: Folder Path Case Sensitivity
**What goes wrong:** User types "inbox" but server has "INBOX"; validation warns incorrectly
**Why it happens:** IMAP folder names are case-insensitive for INBOX but case-sensitive for everything else (per RFC 3501)
**How to avoid:** Use case-insensitive comparison for INBOX only; exact match for all other folders

## Code Examples

### Listing Folders via ImapClient
```typescript
// Source: imapflow TypeScript definitions (node_modules/imapflow/lib/imap-flow.d.ts lines 205-228)
// ListTreeResponse structure from imapflow:
interface ListTreeResponse {
  root?: boolean        // true for root node
  path?: string         // "INBOX", "Archive/2024", etc.
  name?: string         // "2024" (last path component)
  delimiter?: string    // "/" or "."
  flags?: Set<string>   // e.g. Set(["\\HasChildren"])
  specialUse?: string   // "\\Inbox", "\\Trash", "\\Sent", etc.
  listed?: boolean
  subscribed?: boolean
  disabled?: boolean    // true = can't be selected
  folders?: ListTreeResponse[]  // children
}
```

### API Response Type
```typescript
// For src/shared/types.ts
export interface FolderNode {
  path: string
  name: string
  delimiter: string
  flags: string[]          // converted from Set
  specialUse?: string
  disabled?: boolean
  children: FolderNode[]   // renamed from "folders" for clarity
}

export interface FolderTreeResponse {
  folders: FolderNode[]
  cachedAt: string         // ISO timestamp of when cache was populated
  stale: boolean           // true if cache is past TTL
}
```

### Route Registration Pattern
```typescript
// Source: existing pattern from src/web/routes/status.ts
export function registerFolderRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/folders', async (request): Promise<FolderTreeResponse> => {
    const query = request.query as { refresh?: string }
    const forceRefresh = query.refresh === 'true'
    return deps.getFolderCache().getTree(forceRefresh)
  })
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `list()` flat array | `listTree()` hierarchical | Available since imapflow 1.x | Returns ready-to-use tree structure |

**Deprecated/outdated:**
- Nothing relevant -- imapflow API is stable

## Open Questions

1. **TTL default value**
   - What we know: Folder structure rarely changes (user has 20 years of email, structure is stable)
   - What's unclear: Optimal TTL -- 5 minutes? 15 minutes? 1 hour?
   - Recommendation: Default to 5 minutes (`300_000` ms). Fast enough to pick up new folders created in mail client without hammering IMAP. Make configurable.

2. **ServerDeps extension**
   - What we know: `ServerDeps` interface needs `getFolderCache()` or similar accessor
   - What's unclear: Whether to pass `FolderCache` directly or via a getter (like `getMonitor()`)
   - Recommendation: Use getter pattern (`getFolderCache()`) consistent with `getMonitor()` and `getSweeper()` -- allows lazy initialization

3. **Cache population timing**
   - What we know: First API call will be slow if cache is cold
   - What's unclear: Should we populate cache at startup?
   - Recommendation: Populate eagerly after IMAP connection established (listen for `connected` event). This means the first API call is fast.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOLD-01 | GET /api/folders returns nested folder hierarchy | unit | `npx vitest run test/unit/web/folders.test.ts -x` | No - Wave 0 |
| FOLD-01 | ImapClient.listFolders() calls flow.listTree() and transforms result | unit | `npx vitest run test/unit/imap/client.test.ts -x` | Exists but needs new tests |
| FOLD-02 | FolderCache serves from cache when fresh, refreshes when stale | unit | `npx vitest run test/unit/folders/cache.test.ts -x` | No - Wave 0 |
| FOLD-02 | GET /api/folders?refresh=true forces cache refresh | unit | `npx vitest run test/unit/web/folders.test.ts -x` | No - Wave 0 |
| FOLD-03 | Rule save with nonexistent folder returns warning | unit | `npx vitest run test/unit/web/api.test.ts -x` | Exists but needs new tests |
| FOLD-03 | Rule save with valid folder returns no warning | unit | `npx vitest run test/unit/web/api.test.ts -x` | Exists but needs new tests |
| FOLD-03 | Rule save with empty cache skips validation | unit | `npx vitest run test/unit/web/api.test.ts -x` | Exists but needs new tests |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/unit/folders/cache.test.ts` -- covers FOLD-02 (cache TTL, refresh, stale detection)
- [ ] `test/unit/web/folders.test.ts` -- covers FOLD-01, FOLD-02 (route handler, response shape)
- [ ] New test cases in `test/unit/web/api.test.ts` -- covers FOLD-03 (warning on rule save)
- [ ] New test cases in `test/unit/imap/client.test.ts` -- covers FOLD-01 (listTree call)

## Sources

### Primary (HIGH confidence)
- imapflow TypeScript definitions (`node_modules/imapflow/lib/imap-flow.d.ts` lines 205-228) - `ListTreeResponse` type definition
- imapflow source (`node_modules/imapflow/lib/imap-flow.js` lines 1934-1964) - `listTree()` implementation details
- Existing codebase (`src/imap/client.ts`) - `ImapFlowLike` interface, `getSpecialUseFolder()` using `list()`
- Existing codebase (`src/web/routes/rules.ts`, `src/web/server.ts`) - route registration pattern, ServerDeps interface
- Existing codebase (`src/config/repository.ts`) - rule save validation pattern

### Secondary (MEDIUM confidence)
- [ImapFlow official docs](https://imapflow.com/docs/api/imapflow-client/) - API method signatures
- [DeepWiki ImapFlow mailbox listing](https://deepwiki.com/postalsys/imapflow/4.1-mailbox-listing) - special-use detection details

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - imapflow already in use, `listTree()` verified in source and type defs
- Architecture: HIGH - follows existing patterns exactly (route registrar, ServerDeps, ImapFlowLike)
- Pitfalls: HIGH - verified Set serialization behavior, reviewed RFC 3501 case rules, checked connection requirements

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (stable domain -- IMAP protocol and imapflow API unlikely to change)
