# Phase 18: Safety Predicates & Activity Log - Research

**Researched:** 2026-04-20
**Domain:** TypeScript/Node.js — IMAP activity logging, registry patterns, utility extraction
**Confidence:** HIGH

## Summary

Phase 18 delivers four building blocks for the action folder system: (1) extending `isSystemMove()` to recognize action-folder source entries, (2) extending `logActivity()` to accept `'action-folder'` as a source with rule_id/rule_name fields, (3) a static action type registry mapping action types to their declarative config, and (4) a shared `findSenderRule()` predicate extracted to a new `src/rules/sender-utils.ts` module.

All four deliverables are pure code additions or minimal extensions to existing code. No new dependencies are needed. The existing codebase patterns (module-level constants, Zod-typed configs, vitest unit tests with temp SQLite DBs) provide clear templates for every deliverable.

**Primary recommendation:** Follow existing codebase patterns exactly — extend the source union type, add `'action-folder'` to the SQL IN clause, create a static `Record<string, ActionDefinition>` registry, and extract sender-matching utilities from `conflict-checker.ts` and `dispositions.ts`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Extend `isSystemMove()` IN clause to include `'action-folder'`. Single check covers all system-initiated moves.
- **D-02:** Activity log cross-reference only — no path awareness in MoveTracker.
- **D-03:** Rely on two-scan confirmation window for timing safety.
- **D-04:** Extend `logActivity()` source union type to include `'action-folder'`.
- **D-05:** Action values for undo operations use user-intent strings: `'vip'`, `'block'`, `'undo-vip'`, `'unblock'`.
- **D-06:** Conflicting rule removal produces two separate activity log entries linked by `message_id`.
- **D-07:** Static `Record<string, ActionDefinition>` keyed by action type string. Module-level constant, no class.
- **D-08:** Action type identifiers use camelCase: `'vip'`, `'block'`, `'undoVip'`, `'unblock'`.
- **D-09:** Registry entries use declarative config: `{ operation: 'create' | 'remove', ruleAction: 'skip' | 'delete' }`.
- **D-10:** Registry stores abstract destination references (`'inbox' | 'trash'`), resolved from config at runtime.
- **D-11:** New file `src/rules/sender-utils.ts`. Extract `isSenderOnly()` there too.
- **D-12:** `findSenderRule(sender, actionType, rules)` returns `Rule | undefined`.
- **D-13:** New directory `src/action-folders/` for all action folder code (already exists from Phase 17).
- **D-14:** Pure building blocks only — no processor skeleton.

### Claude's Discretion
- Internal naming of ActionDefinition type fields
- Whether findSenderRule uses exact string match or picomatch for sender comparison
- Test file organization within test/unit/ for new modules
- Whether isSenderOnly re-export uses `export { isSenderOnly } from` or a wrapper function

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOG-01 | Action folder operations logged with `source = 'action-folder'` and standard message fields | Extend `logActivity()` source union type (D-04); extend `isSystemMove()` IN clause (D-01). Existing `logActivity` signature already accepts all standard message fields. |
| LOG-02 | Activity log entries include rule_id/rule_name for created or removed rules | Already supported — `logActivity()` takes `Rule | null` parameter; rule_id and rule_name columns exist in schema. Action folder processor passes Rule object. |
| EXT-01 | Action types defined in a registry pattern with folder name, processing function, and message destination | Static `Record<string, ActionDefinition>` registry (D-07 through D-10) in `src/action-folders/registry.ts`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | (project version) | Type-safe building blocks | Already in use [VERIFIED: codebase] |
| better-sqlite3 | ^12.6.2 | Activity log storage | Already in use for ActivityLog [VERIFIED: package.json] |
| picomatch | ^4.0.3 | Glob matching for sender patterns | Already in use in conflict-checker.ts [VERIFIED: codebase] |
| zod | ^4.3.6 | Schema validation | Already in use for config schema [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | (devDep) | Unit testing | All new modules need tests [VERIFIED: vitest.config.ts] |

No new dependencies needed. All work uses existing project libraries.

## Architecture Patterns

### Project Structure (New/Modified Files)
```
src/
  action-folders/
    index.ts           # Re-exports (already exists, extend)
    folders.ts         # Folder lifecycle (Phase 17, no changes)
    registry.ts        # NEW: ActionDefinition type + ACTION_REGISTRY constant
  rules/
    sender-utils.ts    # NEW: findSenderRule(), isSenderOnly() extraction
    conflict-checker.ts # Existing (reference for senderMatches pattern)
  log/
    index.ts           # MODIFY: extend source union, extend isSystemMove IN clause
  web/routes/
    dispositions.ts    # MODIFY: import isSenderOnly from sender-utils, re-export for compat

test/unit/
  action-folders/
    registry.test.ts   # NEW: registry shape and completeness tests
  rules/
    sender-utils.test.ts # NEW: findSenderRule tests
  log/
    activity.test.ts   # EXTEND: action-folder source tests
```

### Pattern 1: Module-Level Constant Registry (D-07)
**What:** Static `Record<string, ActionDefinition>` as a module-level constant
**When to use:** When all entries are known at compile time and the set is small/fixed
**Example:**
```typescript
// Source: existing pattern in src/web/routes/dispositions.ts (DISPOSITION_TYPES)
// and D-07/D-08/D-09/D-10 decisions

export interface ActionDefinition {
  operation: 'create' | 'remove';
  ruleAction: 'skip' | 'delete';
  destination: 'inbox' | 'trash';
  folderConfigKey: 'vip' | 'block' | 'undoVip' | 'unblock';
}

export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  vip:     { operation: 'create', ruleAction: 'skip',   destination: 'inbox', folderConfigKey: 'vip' },
  block:   { operation: 'create', ruleAction: 'delete', destination: 'trash', folderConfigKey: 'block' },
  undoVip: { operation: 'remove', ruleAction: 'skip',   destination: 'inbox', folderConfigKey: 'undoVip' },
  unblock: { operation: 'remove', ruleAction: 'delete', destination: 'inbox', folderConfigKey: 'unblock' },
};
```
[VERIFIED: pattern matches codebase conventions; field values from D-05/D-09/D-10]

### Pattern 2: Source Union Extension (D-01, D-04)
**What:** Add `'action-folder'` to the source parameter's string literal union
**When to use:** Extending existing discriminated type
**Example:**
```typescript
// Current (src/log/index.ts line 87):
logActivity(result: ActionResult, message: EmailMessage, rule: Rule | null, source: 'arrival' | 'sweep' | 'batch' = 'arrival'): void

// Extended:
logActivity(result: ActionResult, message: EmailMessage, rule: Rule | null, source: 'arrival' | 'sweep' | 'batch' | 'action-folder' = 'arrival'): void
```
[VERIFIED: src/log/index.ts line 87]

### Pattern 3: isSystemMove SQL Extension (D-01)
**What:** Add `'action-folder'` to the IN clause
**Example:**
```typescript
// Current (src/log/index.ts line 172):
AND source IN ('arrival', 'sweep', 'batch')

// Extended:
AND source IN ('arrival', 'sweep', 'batch', 'action-folder')
```
[VERIFIED: src/log/index.ts line 172]

### Pattern 4: Utility Extraction with Re-export (D-11)
**What:** Move `isSenderOnly()` to shared module, re-export from original location
**When to use:** Function needed by multiple modules
**Example:**
```typescript
// src/rules/sender-utils.ts (new file)
import type { Rule } from '../config/schema.js';

export function isSenderOnly(rule: Rule): boolean {
  const m = rule.match;
  return (
    m.sender !== undefined &&
    m.recipient === undefined &&
    m.subject === undefined &&
    m.deliveredTo === undefined &&
    m.visibility === undefined &&
    (m.readStatus === undefined || m.readStatus === 'any')
  );
}

// src/web/routes/dispositions.ts — replace local impl with re-export
export { isSenderOnly } from '../../rules/sender-utils.js';
```
[VERIFIED: isSenderOnly at dispositions.ts line 8-18]

### Anti-Patterns to Avoid
- **Class-based registry:** D-07 explicitly says module-level constant, no class. Don't create a Registry class.
- **Callback functions in registry:** D-09 says declarative config, not callbacks. Two fields (`operation`, `ruleAction`) describe all action types.
- **Path awareness in MoveTracker:** D-02 explicitly forbids giving MoveTracker a list of action folder paths. It relies solely on activity log cross-reference.
- **Processor skeleton:** D-14 says no processor code. Phase 19 builds the processor from scratch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sender matching | Custom string comparison | Reuse `senderMatches()` pattern from conflict-checker.ts | Case-insensitive comparison already solved [VERIFIED: conflict-checker.ts line 21] |
| Sender-only detection | New predicate | Extract existing `isSenderOnly()` from dispositions.ts | Exact logic already exists and is tested [VERIFIED: dispositions.ts line 8] |
| Glob matching | RegExp-based matching | picomatch (already a dependency) | Handles edge cases, already proven in codebase [VERIFIED: conflict-checker.ts line 1] |

## Common Pitfalls

### Pitfall 1: Breaking Existing Imports of isSenderOnly
**What goes wrong:** Moving `isSenderOnly` to a new module without re-exporting breaks existing import in dispositions.ts route registration.
**Why it happens:** The function is currently defined in `dispositions.ts` and used locally there.
**How to avoid:** Re-export from the original location: `export { isSenderOnly } from '../../rules/sender-utils.js';`
**Warning signs:** TypeScript compilation errors in dispositions.ts or its tests.

### Pitfall 2: Registry folderConfigKey Mismatch with Config Schema
**What goes wrong:** Registry keys don't match the config schema's `actionFolders.folders` keys, causing runtime lookup failures in Phase 19.
**Why it happens:** Config uses `undoVip` (camelCase) while action values use `'undo-vip'` (kebab-case per D-05).
**How to avoid:** Registry keys are camelCase (`undoVip`) per D-08, matching config schema. Action _values_ (for logging) are user-intent strings per D-05. These are different fields.
**Warning signs:** Test that verifies registry keys match `Object.keys(defaultConfig.actionFolders.folders)`.

### Pitfall 3: Source Default Parameter Masking action-folder
**What goes wrong:** Callers forget to pass `'action-folder'` source and get the default `'arrival'`, making isSystemMove miss the entry.
**Why it happens:** The source parameter defaults to `'arrival'`.
**How to avoid:** This is a Phase 19 concern (when the processor calls logActivity), but the type system will help — TypeScript will show the union type in autocomplete. Tests in Phase 18 should verify `'action-folder'` source is accepted and returned.

### Pitfall 4: findSenderRule Not Filtering by Action Type
**What goes wrong:** findSenderRule returns any sender-only rule, not just ones matching the relevant action type (skip vs delete).
**Why it happens:** Misunderstanding D-12 — the function takes `actionType` to find conflicting rules.
**How to avoid:** Per D-12, `findSenderRule(sender, actionType, rules)` should find sender-only rules where the rule's action type matches the given actionType. Caller uses this for conflict detection (PROC-09).

## Code Examples

### findSenderRule Implementation
```typescript
// Source: D-12, conflict-checker.ts patterns
import type { Rule } from '../config/schema.js';

export function findSenderRule(
  sender: string,
  actionType: 'skip' | 'delete',
  rules: Rule[],
): Rule | undefined {
  return rules.find(
    (r) =>
      r.enabled &&
      isSenderOnly(r) &&
      r.action.type === actionType &&
      r.match.sender?.toLowerCase() === sender.toLowerCase(),
  );
}
```
[VERIFIED: matches senderMatches pattern from conflict-checker.ts line 21; D-12 signature]

**Discretion note on picomatch vs exact match:** The existing `senderMatches()` in conflict-checker uses exact case-insensitive comparison (line 21-22). For `findSenderRule`, exact match is the right choice because action folder rules are created with exact email addresses (PROC-05: "lowercase bare email address"). Glob matching would be needed only if searching for rules that _glob-match_ the sender, but that's the conflict-checker's shadow detection — a different use case.

### Registry with folderConfigKey for Config Lookup
```typescript
// Source: D-07 through D-10, config schema (schema.ts lines 131-153)
export type ActionType = 'vip' | 'block' | 'undoVip' | 'unblock';
export type FolderConfigKey = keyof import('../config/schema.js').ActionFolderConfig['folders'];

export interface ActionDefinition {
  /** Whether this action creates or removes a rule */
  operation: 'create' | 'remove';
  /** The rule action type this operates on */
  ruleAction: 'skip' | 'delete';
  /** Abstract destination — resolved to real folder path from config at runtime */
  destination: 'inbox' | 'trash';
  /** Key into actionFolders.folders config for the IMAP folder name */
  folderConfigKey: FolderConfigKey;
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (via package.json scripts) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOG-01 | logActivity accepts 'action-folder' source; isSystemMove recognizes it | unit | `npx vitest run test/unit/log/activity.test.ts -t "action-folder"` | Extend existing |
| LOG-02 | Activity log entries include rule_id/rule_name | unit | `npx vitest run test/unit/log/activity.test.ts -t "rule_id"` | Partially covered (existing test checks rule_id/rule_name) |
| EXT-01 | Registry has all 4 action types with correct shape | unit | `npx vitest run test/unit/action-folders/registry.test.ts` | Wave 0 |

### Additional Test Coverage
| Feature | Test Type | Automated Command | File Exists? |
|---------|-----------|-------------------|-------------|
| findSenderRule finds matching rule | unit | `npx vitest run test/unit/rules/sender-utils.test.ts` | Wave 0 |
| findSenderRule returns undefined for no match | unit | same | Wave 0 |
| isSenderOnly re-export works | unit | `npx vitest run test/unit/rules/sender-utils.test.ts` | Wave 0 |
| Registry keys match config schema keys | unit | `npx vitest run test/unit/action-folders/registry.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/log/ test/unit/action-folders/ test/unit/rules/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/action-folders/registry.test.ts` — covers EXT-01
- [ ] `test/unit/rules/sender-utils.test.ts` — covers findSenderRule and isSenderOnly extraction

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A — building blocks only, no user input |
| V5 Input Validation | yes | Zod schema validates config; sender comparison is case-insensitive exact match on pre-parsed email addresses |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection in isSystemMove | Tampering | Parameterized queries (already used — `?` placeholders) [VERIFIED: src/log/index.ts line 172] |
| Registry key injection | Tampering | Static compile-time constant — no user input touches registry keys |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `findSenderRule` should use exact case-insensitive match (not picomatch) for sender comparison | Code Examples | Low — if glob matching needed, easy to swap; but action folder rules use exact addresses per PROC-05 |
| A2 | `folderConfigKey` field name in ActionDefinition is appropriate for linking registry to config | Architecture Patterns | Low — naming is Claude's discretion per CONTEXT.md |

## Open Questions

1. **Should findSenderRule also filter by `enabled` status?**
   - What we know: conflict-checker.ts filters by `r.enabled` (line 50). Action folder processor should probably also only find enabled rules.
   - Recommendation: Yes, filter by enabled. Matches existing pattern. [Included in code example above]

## Sources

### Primary (HIGH confidence)
- `src/log/index.ts` — ActivityLog class, logActivity signature, isSystemMove SQL
- `src/rules/conflict-checker.ts` — senderMatches, hasNarrowingFields patterns
- `src/web/routes/dispositions.ts` — isSenderOnly implementation
- `src/config/schema.ts` — ActionFolderConfig type, folder config keys
- `src/action-folders/` — Phase 17 deliverables (folders.ts, index.ts)
- `src/actions/index.ts` — ActionResult interface
- `test/unit/log/activity.test.ts` — Existing test patterns for ActivityLog
- `test/unit/action-folders/folders.test.ts` — Existing test patterns for action folders

### Secondary (MEDIUM confidence)
- `.planning/phases/18-safety-predicates-activity-log/18-CONTEXT.md` — All decisions D-01 through D-14

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all existing libraries [VERIFIED: codebase]
- Architecture: HIGH — all patterns follow existing codebase conventions [VERIFIED: codebase]
- Pitfalls: HIGH — identified from direct code analysis of integration points [VERIFIED: codebase]

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable — internal codebase patterns)
