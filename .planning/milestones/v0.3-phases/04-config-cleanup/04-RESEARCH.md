# Phase 4: Config & Cleanup - Research

**Researched:** 2026-04-10
**Domain:** Frontend form editing, Zod schema changes, config hot-reload bug fix, SQLite state toggle
**Confidence:** HIGH

## Summary

Phase 4 is a polish and cleanup phase — no new processing capabilities, no new libraries, no new architectural patterns. Every change works within the existing stack (Fastify routes, Zod schemas, vanilla TypeScript SPA, SQLite state table). The backend is already partially wired (`PUT /api/config/review` exists with `updateReviewConfig` doing merge + validate + persist + notify), so the work is primarily frontend form construction, a schema tweak for optional rule names, a behavior description generator, a state toggle for lastUid persistence, and investigation of a potential stale reference bug.

The tree picker component from Phase 2 is reusable for folder selection fields in the sweep settings form. The existing IMAP settings card already demonstrates the edit-in-place pattern with Save button. The sweep settings card currently renders as static `<dl>` elements and needs to be converted to input fields.

**Primary recommendation:** Follow the existing IMAP settings card pattern for sweep settings editing. Keep all changes within established patterns — no new dependencies, no architectural shifts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Edit in place on the existing Sweep Settings card — swap read-only `<dd>` elements for input fields with a Save button. No modal.
- **D-02:** Editable fields: review folder, archive folder, trash folder, sweep interval, read max age, unread max age — all fields currently displayed.
- **D-03:** Folder fields (archive folder, review folder, trash folder) use the Phase 2 tree picker component for selection. Consistent with rule editor UX.
- **D-04:** No per-stream archive split. CONF-02 reduces to making the existing `defaultArchiveFolder` editable in the sweep settings UI.
- **D-05:** The `PUT /api/config/review` route already accepts updates — backend is partially wired. Frontend needs the editable form.
- **D-06:** `ServerDeps.getSweeper` uses a closure over `let sweeper` which tracks reassignment — verify whether the reported bug is a real timing gap or already resolved by the getter pattern. Fix if real, close if not.
- **D-07:** Settings option to disable `lastUid` persistence. When disabled, Monitor does a full re-evaluation on restart instead of resuming from the last processed UID.
- **D-08:** Rule `name` field becomes optional in the Zod schema (change `z.string().min(1)` to `z.string().optional()`).
- **D-09:** Rules always display a generated behavior description built from populated match fields and action. Format: `sender:*@github.com, subject:*PR* → Notifications`. Only include match fields that have a value — skip empty ones.
- **D-10:** If a user-provided name exists, show it as secondary text alongside the behavior description. The behavior description is always primary.
- **D-11:** Generation is display-side only — no auto-generated name is stored in the config. The `name` field is either user-provided or absent.

### Claude's Discretion
- Save button behavior (inline save vs submit-all)
- Validation feedback style for sweep settings form
- Exact CSS/layout for the editable sweep card
- How the message cursor toggle is presented in the settings UI
- Investigation approach for the stale sweeper bug (CONF-03)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONF-01 | Sweep settings editable in UI (intervals, age thresholds, folder names) | Existing `PUT /api/config/review` route + `updateReviewConfig` handles backend. Frontend needs editable form replacing static `<dl>`. Tree picker reusable for folder fields. |
| CONF-02 | Default archive destination configurable per-stream (narrowed to single `defaultArchiveFolder`) | Reduced to making `defaultArchiveFolder` editable in sweep settings form — no per-stream split needed. Already part of `reviewConfigSchema`. |
| CONF-03 | Fix stale sweeper reference in ServerDeps after config reload | `ServerDeps.getSweeper` returns `() => ReviewSweeper \| undefined`. `onReviewConfigChange` reassigns local `sweeper` variable. Getter closure should track reassignment — needs investigation to confirm. |
| CONF-04 | Message cursor toggle — disable lastUid persistence for full re-evaluation | `activityLog.getState('lastUid')` / `setState('lastUid', ...)` in Monitor. New state key (e.g., `cursorEnabled`) in SQLite state table. Monitor constructor and `processNewMessages` need conditional behavior. |
| CONF-05 | Rule name optional — auto-generate description from match criteria + action | Schema change (`name: z.string().optional()`), display-side generation function, frontend table/modal updates, activity log `rule_name` column handles null gracefully already. |
</phase_requirements>

## Standard Stack

No new libraries needed. Phase 4 works entirely within the existing stack.

### Core (already installed)
| Library | Version | Purpose | Role in Phase 4 |
|---------|---------|---------|-----------------|
| zod | 4.3.6 | Schema validation | Rule schema `name` field change, sweep config validation |
| Fastify | 5.7.4 | HTTP server | Existing `PUT /api/config/review` route |
| better-sqlite3 | 12.6.2 | SQLite database | State table for cursor toggle setting |
| esbuild | 0.27.2 | Frontend bundling | Rebuilds after frontend changes |

[VERIFIED: package.json in codebase]

## Architecture Patterns

### Existing Pattern: IMAP Settings Edit Card
The IMAP settings card at `app.ts:354-394` demonstrates the established pattern:
1. Render a `settings-card` div with form inputs pre-filled from current config
2. "Save Settings" button collects values, calls API, shows toast, re-renders page
3. Validation happens server-side via Zod; 400 errors shown via toast

**This is the pattern for sweep settings editing (CONF-01, CONF-02).**

### Existing Pattern: Tree Picker Integration
The rule modal at `app.ts:183-193` shows how to embed the tree picker:
```typescript
// Source: src/web/frontend/app.ts lines 183-193
renderFolderPicker({
  container: document.getElementById('m-folder-picker')!,
  currentValue: selectedFolder,
  onSelect: (path) => { selectedFolder = path; },
});
```
[VERIFIED: codebase inspection]

**Reuse this for the three folder fields (review folder, archive folder, trash folder) in sweep settings.**

### Existing Pattern: Config Update Flow
```
Frontend → PUT /api/config/review (partial body)
  → ConfigRepository.updateReviewConfig(input)
    → Merges with existing: { ...this.config.review, ...input }
    → Validates merged result with reviewConfigSchema.safeParse()
    → Persists to YAML file
    → Notifies reviewListeners (triggers sweeper rebuild)
```
[VERIFIED: src/config/repository.ts lines 104-117]

**Important:** `updateReviewConfig` accepts `Partial<ReviewConfig>` and merges, so frontend can send only changed fields. However, for sweep sub-object, the merge is shallow — `{ ...this.config.review, ...input }` will replace the entire `sweep` object if provided. Frontend should send the complete `sweep` sub-object.

### Existing Pattern: State Table Key-Value Store
```typescript
// Source: src/log/index.ts lines 122-132
getState(key: string): string | undefined
setState(key: string, value: string): void
```
Simple key-value in SQLite. Used for `lastUid`. Same pattern for `cursorEnabled` toggle (CONF-04).
[VERIFIED: codebase inspection]

### Behavior Description Generation (CONF-05)
New pattern — display-side only function. Format per D-09:
```typescript
// Proposed: pure function, no side effects
function generateBehaviorDescription(rule: Rule): string {
  const parts: string[] = []
  if (rule.match.sender) parts.push(`sender:${rule.match.sender}`)
  if (rule.match.recipient) parts.push(`recipient:${rule.match.recipient}`)
  if (rule.match.subject) parts.push(`subject:${rule.match.subject}`)
  const matchStr = parts.join(', ')
  const dest = formatRuleAction(rule.action)  // reuse existing function
  return `${matchStr} ${dest}`
}
```
[ASSUMED — proposed implementation pattern]

### Anti-Patterns to Avoid
- **Don't create a new API route for sweep settings** — `PUT /api/config/review` already handles this
- **Don't store generated behavior descriptions** — D-11 says display-side only
- **Don't deep-merge sweep sub-object** — `updateReviewConfig` does shallow merge; send complete `sweep` object

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Folder selection | Text input for folder paths | Phase 2 tree picker (`renderFolderPicker`) | D-03 mandates picker; consistent UX |
| Config validation | Manual field checks | Zod `reviewConfigSchema.safeParse()` | Already validates on backend |
| Config persistence | Direct YAML write | `configRepo.updateReviewConfig()` | Handles merge, validate, persist, notify |

## Common Pitfalls

### Pitfall 1: Shallow Merge Replacing Sweep Sub-Object
**What goes wrong:** Sending `{ sweep: { intervalHours: 12 } }` to `updateReviewConfig` replaces the entire `sweep` object, losing `readMaxAgeDays` and `unreadMaxAgeDays`.
**Why it happens:** `{ ...this.config.review, ...input }` is a shallow merge. Nested `sweep` object gets replaced, not merged.
**How to avoid:** Frontend must always send the complete `sweep` sub-object with all three fields populated.
**Warning signs:** After saving one sweep field, other sweep fields revert to defaults.
[VERIFIED: src/config/repository.ts line 105 — shallow spread]

### Pitfall 2: Rule Name Null in Activity Log
**What goes wrong:** Activity log stores `rule_name` — making name optional means some rows have null `rule_name`.
**Why it happens:** `logActivity` passes `rule?.name ?? null` — already handles null correctly.
**How to avoid:** Verify activity log display code uses `e.ruleName ?? ''` fallback (it already does at app.ts lines 285-289). Verify DryRunMessage `ruleName` field in batch results also handles null/undefined rules gracefully.
**Warning signs:** "null" or "undefined" text appearing in activity table.
[VERIFIED: src/log/index.ts line 110 uses `rule?.name ?? null`; frontend uses `e.ruleName ?? ''`]

### Pitfall 3: Frontend Name Validation Blocking Save
**What goes wrong:** The rule modal currently checks `if (!name) { toast('Name is required', true); return; }` at app.ts line 211. After making name optional (CONF-05), this check will block saving rules without names.
**Why it happens:** Frontend validation is more restrictive than the schema.
**How to avoid:** Remove or adjust the frontend name-required check to allow blank names.
**Warning signs:** Users can't save rules without names despite schema allowing it.
[VERIFIED: src/web/frontend/app.ts line 211]

### Pitfall 4: Three Folder Pickers on One Page
**What goes wrong:** Rendering three tree picker instances on the sweep settings card could cause performance issues or event conflicts.
**Why it happens:** Each `renderFolderPicker` call fetches folders (though cached after first), creates its own DOM tree.
**How to avoid:** The folder picker already has a 60-second cache (`CACHE_TTL = 60_000`), so the second and third pickers will use cached data. However, each picker creates its own full DOM tree. Consider whether all three need to be expanded simultaneously or if a shared picker with a "which field" context works better.
**Warning signs:** Page feels slow on render; three identical folder trees visible simultaneously.
[VERIFIED: folder-picker.ts lines 21-24 — cache mechanism]

### Pitfall 5: Stale Sweeper May Not Be a Bug
**What goes wrong:** Developer wastes time investigating a non-bug.
**Why it happens:** `ServerDeps.getSweeper` is `() => sweeper` where `sweeper` is a `let` variable in the closure scope of `main()`. When `onReviewConfigChange` runs `sweeper = new ReviewSweeper(...)`, the getter function returns the new instance on next call because closures capture the variable binding, not the value.
**How to avoid:** Test the actual behavior: save review config, then check if routes use the new sweeper instance. The getter pattern _should_ work correctly. D-06 says "verify and fix if real, close if not."
**Warning signs:** After config save, review status API returns stale data from old sweeper.
[VERIFIED: src/index.ts lines 68-82, src/web/server.ts lines 23-24]

## Code Examples

### Sweep Settings Editable Form (CONF-01, CONF-02)
Based on the existing IMAP settings card pattern:
```typescript
// Source: Pattern derived from app.ts:354-394 (IMAP card)
// Sweep card replaces static <dl> at app.ts:430-445

const sweepCard = h('div', { className: 'settings-card' });
// Render form fields for: folder, defaultArchiveFolder, trashFolder,
// sweep.intervalHours, sweep.readMaxAgeDays, sweep.unreadMaxAgeDays
// Folder fields use renderFolderPicker()
// Numeric fields use <input type="number">
// Save button calls api.config.updateReview(payload)
```
[ASSUMED — pattern extrapolation from existing IMAP card]

### State Toggle Pattern (CONF-04)
```typescript
// In Monitor constructor — read setting from state table
const cursorEnabled = this.activityLog.getState('cursorEnabled');
if (cursorEnabled !== 'false') {
  const saved = this.activityLog.getState('lastUid');
  this.lastUid = saved ? parseInt(saved, 10) : 0;
} else {
  this.lastUid = 0;  // Full re-evaluation on restart
}

// In processNewMessages — conditional persistence
if (message.uid > this.lastUid) {
  this.lastUid = message.uid;
  if (this.activityLog.getState('cursorEnabled') !== 'false') {
    this.activityLog.setState('lastUid', String(this.lastUid));
  }
}
```
[ASSUMED — proposed implementation]

### Schema Change for Optional Name (CONF-05)
```typescript
// Source: src/config/schema.ts line 47
// Before:
name: z.string().min(1),
// After:
name: z.string().optional(),
```
[VERIFIED: src/config/schema.ts line 47 — exact line to change]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run && npx vitest run --config vitest.integration.config.ts` |

[VERIFIED: vitest.config.ts and package.json scripts]

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | Sweep settings update via PUT /api/config/review | unit | `npx vitest run test/unit/config/repository.test.ts -t "updateReviewConfig"` | Partial (repository.test.ts exists) |
| CONF-02 | defaultArchiveFolder editable (subset of CONF-01) | unit | Same as CONF-01 | Partial |
| CONF-03 | getSweeper returns fresh instance after config reload | unit | `npx vitest run test/unit/web/api.test.ts` | Exists but likely needs new test |
| CONF-04 | Monitor respects cursorEnabled state toggle | unit | `npx vitest run test/unit/monitor/monitor.test.ts` | Exists — needs new test cases |
| CONF-05 | Rule schema accepts optional name, behavior description generates correctly | unit | `npx vitest run test/unit/config/config.test.ts` | Exists — needs schema test update |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run && npx vitest run --config vitest.integration.config.ts`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Test for `updateReviewConfig` with partial sweep object (verifies shallow merge behavior)
- [ ] Test for Monitor with `cursorEnabled = 'false'` — verifies lastUid not loaded/persisted
- [ ] Test for rule schema accepting `name: undefined` (schema validation test)
- [ ] Test for behavior description generation function (new pure function)
- [ ] Test for stale sweeper scenario (config reload → getSweeper returns new instance)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Single-user, no auth |
| V3 Session Management | No | No sessions |
| V4 Access Control | No | No auth |
| V5 Input Validation | Yes | Zod schema validation on all PUT routes |
| V6 Cryptography | No | No crypto operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious config values via PUT /api/config/review | Tampering | Zod validation rejects invalid shapes; `z.string().min(1)` prevents empty folder paths |
| Path traversal in folder names | Tampering | Folder names come from IMAP server via tree picker; no filesystem path construction from user input |

[ASSUMED — standard web input validation concerns; Zod validation is already in place]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Three simultaneous tree pickers on sweep card is acceptable UX | Pitfalls | May need a different UX pattern if three pickers are too heavy; could use single shared picker |
| A2 | `cursorEnabled` state key name is appropriate | Code Examples | Low risk — just a naming choice for the state table key |
| A3 | Shallow merge pitfall is real (sweep sub-object replaced entirely) | Pitfalls | HIGH risk — if merge is actually deep, frontend could send partial sweep objects. Verified it IS shallow from code. |

## Open Questions (RESOLVED)

1. **Is the stale sweeper reference (CONF-03) actually a bug?** (RESOLVED)
   - What we know: `getSweeper: () => sweeper` captures the `let sweeper` binding. Reassignment in `onReviewConfigChange` should be visible to the getter.
   - Resolution: YES, it is a real bug. The getter closure tracks the binding correctly, but there is an async gap between `sweeper.stop()` (line 70) and `sweeper = new ReviewSweeper(...)` (line 73) where `getSpecialUseFolder` awaits. During this window, `getSweeper()` returns the STOPPED old sweeper instance. Fix: set `sweeper = undefined` before the async gap so routes see undefined (which they already handle) instead of a stopped instance.

2. **How should the cursor toggle be exposed in the UI?** (RESOLVED)
   - What we know: It's a boolean setting stored in SQLite state table.
   - Resolution: Add as a checkbox on the Sweep Settings card with label "Enable message cursor (resume from last UID)". Per Claude's discretion in CONTEXT.md, keeping it on the same card avoids a separate "Advanced" section for a single toggle.

## Sources

### Primary (HIGH confidence)
- Codebase inspection — all source files referenced in canonical refs
- `src/config/schema.ts` — Zod schemas, rule schema line 47
- `src/config/repository.ts` — `updateReviewConfig` merge behavior
- `src/web/frontend/app.ts` — existing settings card patterns, rule table rendering
- `src/web/frontend/folder-picker.ts` — tree picker API and cache
- `src/web/routes/review-config.ts` — existing PUT route
- `src/index.ts` — config reload handlers, sweeper reassignment
- `src/monitor/index.ts` — lastUid persistence logic
- `src/log/index.ts` — state table, activity logging with nullable rule_name

### Secondary (MEDIUM confidence)
- None needed — entirely codebase-driven research

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all existing
- Architecture: HIGH — follows established patterns visible in codebase
- Pitfalls: HIGH — all verified from actual code inspection
- CONF-03 bug status: HIGH — confirmed as real timing gap bug, resolution defined

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable — internal codebase patterns unlikely to change)
