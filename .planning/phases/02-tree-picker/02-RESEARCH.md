# Phase 2: Tree Picker - Research

**Researched:** 2026-04-06
**Domain:** Frontend tree UI component, folder API integration, activity log querying
**Confidence:** HIGH

## Summary

Phase 2 replaces the plain text `<input>` for folder selection in the rule editor modal with an interactive tree picker component. The existing codebase is a vanilla TypeScript SPA (no React, no framework) using raw DOM manipulation via a helper `h()` function and `innerHTML` templates. The tree picker must be built from scratch using the same vanilla DOM patterns -- no component library is available or appropriate.

The backend infrastructure is already complete from Phase 1: `GET /api/folders` returns a `FolderTreeResponse` with nested `FolderNode[]` objects, each having `path`, `name`, `children`, `specialUse`, and `flags`. The frontend API layer (`api.ts`) needs a new method to fetch this endpoint. For recently-used folders (PICK-03), the activity log's `folder` column in SQLite can be queried with a `GROUP BY folder ORDER BY MAX(id) DESC` to derive recent destinations, exposed via a new API endpoint or a query parameter on the existing activity endpoint.

**Primary recommendation:** Build a `renderFolderPicker()` function in a new `src/web/frontend/folder-picker.ts` module that creates a collapsible tree widget, integrates with the existing modal via replacing the `#m-folder-group` div, and calls back with the selected folder path. Add a `GET /api/activity/recent-folders` endpoint to derive recently-used folders from the activity log.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PICK-01 | Tree picker component replaces text input for folder selection in rule editor | `openRuleModal()` in `app.ts` creates `#m-folder-group` with a text input at line 159. Replace this div's content with the tree picker when action type is `move` or `review`. The `FolderNode` type and `GET /api/folders` endpoint already exist from Phase 1. |
| PICK-02 | Tree supports expand/collapse for nested folder hierarchy | `FolderNode.children` provides nesting. Each node with children renders a disclosure toggle. CSS handles indentation via `padding-left` per depth level. |
| PICK-03 | Recently-used folders surfaced at top of picker | Activity log `activity` table has `folder TEXT` column. Query `SELECT folder, COUNT(*) as cnt FROM activity WHERE folder IS NOT NULL GROUP BY folder ORDER BY MAX(id) DESC LIMIT N` gives recent destinations. Expose via new endpoint. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| No new libraries | - | Vanilla TypeScript DOM manipulation | Frontend is a zero-dependency SPA; adding a framework for one component would be inconsistent |

### Supporting
No new dependencies. The tree picker is a DOM component built with the existing `h()` helper function pattern from `app.ts`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-built tree | A tree component library (e.g., `treejs`) | Would require bundling a third-party CSS/JS library into the existing esbuild IIFE build; overkill for a single component in a single-user app |
| Vanilla DOM | Lit, Preact, or similar micro-framework | Adding a framework for one widget creates an inconsistency in the codebase; the entire SPA is vanilla |

## Architecture Patterns

### Recommended Project Structure
```
src/web/frontend/
  app.ts              # Existing - modify openRuleModal() to use picker
  api.ts              # Existing - add folders.list() and activity.recentFolders()
  folder-picker.ts    # NEW - renderFolderPicker() component
src/web/routes/
  activity.ts         # Existing - add GET /api/activity/recent-folders endpoint
src/web/frontend/
  styles.css          # Existing - add tree picker CSS
```

### Pattern 1: Folder Picker as Replaceable Widget
**What:** A function that takes a container element, the current folder value, and a callback, then renders the full picker UI into that container.
**When to use:** Called from `openRuleModal()` when action type is `move` or `review`.
**Example:**
```typescript
// src/web/frontend/folder-picker.ts
export interface FolderPickerOptions {
  container: HTMLElement
  currentValue: string
  onSelect: (folderPath: string) => void
}

export async function renderFolderPicker(opts: FolderPickerOptions): Promise<void> {
  // 1. Fetch folder tree and recent folders in parallel
  // 2. Render "Recent" section at top if any
  // 3. Render full tree below with expand/collapse
  // 4. Highlight current selection
  // 5. Call opts.onSelect(path) when user clicks a folder
}
```

### Pattern 2: Tree Node Rendering with Depth-Based Indentation
**What:** Recursive function that renders each `FolderNode` as a clickable row with disclosure triangle for nodes that have children.
**When to use:** Core rendering logic for the tree.
**Example:**
```typescript
function renderTreeNode(node: FolderNode, depth: number, state: PickerState): HTMLElement {
  const row = h('div', { className: 'tree-node' })
  row.style.paddingLeft = `${depth * 16}px`

  // Disclosure toggle (only if has children)
  if (node.children.length > 0) {
    const toggle = h('span', { className: 'tree-toggle' },
      state.expanded.has(node.path) ? '\u25BE' : '\u25B8')
    toggle.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleExpanded(node.path, state)
    })
    row.append(toggle)
  } else {
    row.append(h('span', { className: 'tree-toggle tree-leaf' }))
  }

  row.append(h('span', { className: 'tree-label' }, node.name))
  row.addEventListener('click', () => state.onSelect(node.path))

  return row
}
```

### Pattern 3: Recent Folders from Activity Log
**What:** A new backend endpoint that queries the activity log for distinct folder destinations, ordered by most recently used.
**When to use:** Picker loads this data to show a "Recent" section above the tree.
**Example:**
```typescript
// In src/log/index.ts or via a raw query in the route handler
getRecentFolders(limit: number = 5): string[] {
  const rows = this.db.prepare(
    `SELECT folder FROM activity
     WHERE folder IS NOT NULL AND folder != '' AND success = 1
     GROUP BY folder
     ORDER BY MAX(id) DESC
     LIMIT ?`
  ).all(limit) as Array<{ folder: string }>
  return rows.map(r => r.folder)
}
```

### Pattern 4: Integration with Existing Modal
**What:** The `openRuleModal()` function in `app.ts` currently creates `#m-folder-group` with an `<input>`. Replace this with a picker container, but keep a hidden input or state variable that holds the selected path for form submission.
**When to use:** Whenever the action type is `move` or `review`.
**Example:**
```typescript
// In openRuleModal(), replace the folder input innerHTML with:
const folderGroup = document.getElementById('m-folder-group')!
folderGroup.innerHTML = ''
folderGroup.append(
  h('label', {}, 'Folder'),
  h('div', { id: 'm-folder-picker' })
)

let selectedFolder = rule?.action && 'folder' in rule.action ? rule.action.folder || '' : ''

await renderFolderPicker({
  container: document.getElementById('m-folder-picker')!,
  currentValue: selectedFolder,
  onSelect: (path) => { selectedFolder = path }
})

// In save handler, use selectedFolder instead of reading input value
```

### Anti-Patterns to Avoid
- **Fetching folders on every modal open without caching:** The backend `FolderCache` handles caching, but the frontend should also avoid re-fetching if the data was fetched recently in the same session. A simple module-level variable is sufficient.
- **Building the tree with innerHTML:** Use the `h()` helper for all DOM construction to match existing patterns and avoid XSS from folder names containing HTML characters.
- **Blocking modal render on folder fetch:** Show the modal immediately with a loading state in the picker area; fetch folders asynchronously.
- **Deeply nested recursion without limits:** Real IMAP hierarchies can be 5-8 levels deep. No practical concern, but set a max-depth of 10 as a safety guard.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Folder tree data structure | Manual IMAP queries from frontend | `GET /api/folders` (Phase 1) | Backend already caches and transforms imapflow `listTree()` |
| Recently-used folder tracking | Client-side localStorage tracking | SQLite query on activity log | Activity log already records every move with folder destination; server-side is the source of truth |
| CSS tree layout framework | Custom grid/flexbox tree layout | Simple `padding-left` per depth level | Trees are inherently simple to indent; no layout library needed |

**Key insight:** Phase 1 already built all the backend infrastructure. Phase 2 is purely a frontend phase (tree picker component + recent folders API endpoint) plus minor backend work (one new query on the existing activity log).

## Common Pitfalls

### Pitfall 1: Folder Names Containing Special Characters
**What goes wrong:** Folder names with `<`, `>`, `&`, or quotes break rendering if inserted via `innerHTML`.
**Why it happens:** Real IMAP folder names can contain special characters.
**How to avoid:** Always use `h()` helper or `document.createTextNode()` for folder name display -- never `innerHTML` with user data.
**Warning signs:** XSS or rendering glitches when testing with folders like `Bills & Receipts`.

### Pitfall 2: Empty Folder Tree on First Load
**What goes wrong:** Picker shows empty tree because IMAP is not connected or cache is cold.
**Why it happens:** `GET /api/folders` returns 503 when IMAP is disconnected, or returns empty `folders: []` if cache was never populated.
**How to avoid:** Show a clear "Unable to load folders" message with a retry button. Allow the user to fall back to typing a folder path manually.
**Warning signs:** Test passes with mock data but fails when IMAP is unavailable.

### Pitfall 3: Selected Folder State Lost on Action Type Toggle
**What goes wrong:** User selects a folder via picker, switches action type to "skip", switches back to "move", and the selection is gone.
**Why it happens:** `updateFolderVisibility()` currently hides/shows the folder group div. If the picker is destroyed and re-rendered, state is lost.
**How to avoid:** Keep the selected folder path in a variable that persists across visibility toggles. Only re-render the picker when the container becomes visible if it hasn't been rendered yet.

### Pitfall 4: Click Event Propagation in Tree
**What goes wrong:** Clicking the expand/collapse toggle also triggers the folder selection.
**Why it happens:** Event bubbling from toggle `<span>` to parent row `<div>`.
**How to avoid:** Use `e.stopPropagation()` on the toggle click handler.

### Pitfall 5: Modal Height Overflow with Large Tree
**What goes wrong:** A deep folder hierarchy makes the picker taller than the viewport, and the modal becomes unscrollable.
**Why it happens:** The existing `.modal` class has no max-height or overflow handling.
**How to avoid:** Add `max-height` and `overflow-y: auto` to the picker container. The picker area should scroll independently from the rest of the modal form.

### Pitfall 6: esbuild IIFE Bundle and Module Exports
**What goes wrong:** New `folder-picker.ts` module exports not available in `app.ts`.
**Why it happens:** esbuild bundles `app.ts` as entry point with `format: 'iife'`. Imports from other files in the same directory work fine -- esbuild resolves and bundles them.
**How to avoid:** Just use standard `import { renderFolderPicker } from './folder-picker.js'` in `app.ts`. esbuild handles the bundling.

## Code Examples

### Fetching Folders from Frontend API
```typescript
// Addition to src/web/frontend/api.ts
folders: {
  list: () => request<FolderTreeResponse>('/api/folders'),
},
activity: {
  // existing...
  recentFolders: (limit = 5) => request<string[]>(`/api/activity/recent-folders?limit=${limit}`),
},
```

### Recent Folders Endpoint
```typescript
// Addition to src/web/routes/activity.ts (or new route file)
app.get('/api/activity/recent-folders', async (request) => {
  const query = request.query as { limit?: string }
  const limit = Math.min(Math.max(parseInt(query.limit || '5', 10) || 5, 1), 20)
  return deps.activityLog.getRecentFolders(limit)
})
```

### ActivityLog.getRecentFolders() Method
```typescript
// Addition to src/log/index.ts
getRecentFolders(limit: number = 5): string[] {
  const rows = this.db.prepare(
    `SELECT folder FROM activity
     WHERE folder IS NOT NULL AND folder != '' AND success = 1
     GROUP BY folder
     ORDER BY MAX(id) DESC
     LIMIT ?`
  ).all(limit) as Array<{ folder: string }>
  return rows.map(r => r.folder)
}
```

### Tree Picker CSS
```css
/* Addition to styles.css */
.folder-picker {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
}

.folder-picker-section {
  padding: 0.25rem 0;
  border-bottom: 1px solid #eee;
}

.folder-picker-section:last-child {
  border-bottom: none;
}

.folder-picker-heading {
  font-size: 0.75rem;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  padding: 0.25rem 0.5rem;
}

.tree-node {
  display: flex;
  align-items: center;
  padding: 0.3rem 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  border-radius: 3px;
}

.tree-node:hover {
  background: #f0f4ff;
}

.tree-node.selected {
  background: #dbeafe;
  font-weight: 600;
}

.tree-toggle {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
  font-size: 0.75rem;
  color: #888;
  cursor: pointer;
  user-select: none;
}

.tree-leaf {
  visibility: hidden;
}

.tree-label {
  margin-left: 0.25rem;
}

.folder-picker-selected {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  color: #444;
}

.folder-picker-selected strong {
  color: #222;
}
```

### Picker Component Structure
```typescript
// src/web/frontend/folder-picker.ts
import { api } from './api.js'
import type { FolderNode } from '../../shared/types.js'

interface PickerState {
  expanded: Set<string>
  selected: string
  onSelect: (path: string) => void
  container: HTMLElement
}

export interface FolderPickerOptions {
  container: HTMLElement
  currentValue: string
  onSelect: (folderPath: string) => void
}

export async function renderFolderPicker(opts: FolderPickerOptions): Promise<void> {
  const container = opts.container
  container.innerHTML = '<span style="color:#888;font-size:0.85rem">Loading folders...</span>'

  const state: PickerState = {
    expanded: new Set<string>(),
    selected: opts.currentValue,
    onSelect: (path: string) => {
      state.selected = path
      opts.onSelect(path)
      renderPickerContent(state, folders, recentFolders)
    },
    container,
  }

  let folders: FolderNode[] = []
  let recentFolders: string[] = []

  try {
    const [treeRes, recent] = await Promise.all([
      api.folders.list(),
      api.activity.recentFolders(),
    ])
    folders = treeRes.folders
    recentFolders = recent

    // Auto-expand to show selected folder
    if (state.selected) {
      expandPathTo(folders, state.selected, state.expanded)
    }

    renderPickerContent(state, folders, recentFolders)
  } catch {
    container.innerHTML = ''
    container.append(h('div', { className: 'folder-picker' },
      h('div', { style: 'padding:1rem;color:#888;text-align:center' },
        'Unable to load folders. ',
        (() => {
          const btn = h('button', { className: 'btn btn-sm' }, 'Retry')
          btn.addEventListener('click', () => renderFolderPicker(opts))
          return btn
        })(),
      ),
    ))
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Text input for folder path | Tree picker with expand/collapse | This phase | Users see real folder hierarchy instead of guessing paths |
| No folder validation feedback | Phase 1 warns on save; Phase 2 eliminates bad paths | Phase 1-2 | Wrong folder paths become nearly impossible |

**Deprecated/outdated:**
- Nothing relevant -- the SPA is vanilla TypeScript with no framework churn concerns.

## Open Questions

1. **Should typing still be allowed as fallback?**
   - What we know: Some users prefer typing, especially for deep paths they know by heart. Also needed when IMAP is disconnected.
   - What's unclear: Whether to keep the text input alongside the tree, or only show it as fallback.
   - Recommendation: Show the tree picker as primary, but include a small "type path manually" link that reveals the original text input. This handles the disconnected case gracefully.

2. **How many recent folders to show?**
   - What we know: The user has 20 years of email with many folders. Recent destinations are a small subset.
   - What's unclear: Optimal count.
   - Recommendation: Default to 5 recent folders. Enough for quick access without cluttering the picker.

3. **Should the picker auto-expand to the currently selected folder?**
   - What we know: When editing an existing rule with a deep folder like `Archive/2024/Receipts`, the user needs to see it selected.
   - What's unclear: Whether to expand the full path or just highlight it.
   - Recommendation: Auto-expand all ancestor nodes of the currently selected folder on open. This is standard UX for tree pickers.

4. **Frontend caching of folder tree**
   - What we know: Backend caches with TTL, but each `openRuleModal()` call would still make an HTTP request.
   - What's unclear: Whether to cache client-side.
   - Recommendation: Cache the folder tree in a module-level variable with a 60-second TTL. The data changes rarely. This avoids a network round-trip on every modal open.

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
| PICK-01 | Folder picker renders inside rule modal and replaces text input | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 |
| PICK-01 | Selected folder path is used in rule save payload | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 |
| PICK-02 | Tree nodes expand/collapse on toggle click | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 |
| PICK-02 | Nested children visible when parent expanded, hidden when collapsed | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 |
| PICK-03 | GET /api/activity/recent-folders returns recently-used folder paths | unit | `npx vitest run test/unit/web/api.test.ts -x` | Exists but needs new tests |
| PICK-03 | ActivityLog.getRecentFolders() queries activity table correctly | unit | `npx vitest run test/unit/log/activity.test.ts -x` | Exists but needs new tests |
| PICK-03 | Recent folders displayed above tree in picker | unit | `npx vitest run test/unit/web/folder-picker.test.ts -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/unit/web/folder-picker.test.ts` -- covers PICK-01, PICK-02, PICK-03 (tree rendering, expand/collapse, selection, recent folders display)
- [ ] New test cases in `test/unit/web/api.test.ts` -- covers PICK-03 (recent-folders endpoint)
- [ ] New test cases in `test/unit/log/activity.test.ts` -- covers PICK-03 (getRecentFolders query)

**Note:** Frontend DOM tests in this codebase use Vitest with Fastify's `inject()` for API testing. For the picker component, tests will need to verify the DOM output of `renderFolderPicker()` using JSDOM (Vitest's default environment) or test the logic functions (expand/collapse state, path matching) as pure unit tests without DOM. Recommend testing the logic separately from DOM rendering.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/web/frontend/app.ts` (lines 143-243) -- `openRuleModal()` function, current folder input implementation
- Existing codebase: `src/web/frontend/api.ts` -- API wrapper pattern, `request<T>()` helper
- Existing codebase: `src/shared/types.ts` (lines 67-83) -- `FolderNode` and `FolderTreeResponse` types from Phase 1
- Existing codebase: `src/web/routes/folders.ts` -- Phase 1 folder endpoint already working
- Existing codebase: `src/log/index.ts` (lines 7-26) -- Activity table schema with `folder TEXT` column
- Existing codebase: `src/folders/cache.ts` -- `FolderCache` class from Phase 1
- Existing codebase: `src/web/frontend/styles.css` -- Current CSS patterns for modal, forms, buttons
- Existing codebase: `esbuild.mjs` -- Build configuration (single entry point `app.ts`, IIFE format)

### Secondary (MEDIUM confidence)
- Phase 1 Research: `.planning/phases/01-folder-discovery/01-RESEARCH.md` -- FolderNode structure, API response shape

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all patterns verified in existing codebase
- Architecture: HIGH - directly extends existing modal/API patterns; folder data types already defined
- Pitfalls: HIGH - verified DOM patterns, event propagation, CSS overflow behavior in existing code

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (stable domain -- vanilla DOM patterns don't change)
