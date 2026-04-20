# Phase 18: Safety Predicates & Activity Log - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 18-safety-predicates-activity-log
**Areas discussed:** MoveTracker Safety, Activity Logging Extension, Action Type Registry, Shared findSenderRule Predicate, File Organization
**Mode:** Started in power mode (questions generated), switched to interactive for answers

---

## MoveTracker Safety

### isSystemMove extension strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Extend isSystemMove to include 'action-folder' | Single check covers all system-initiated moves. Simple, minimal change. | ✓ |
| Separate isActionFolderMove predicate | Keep arrival/sweep/batch separate from action-folder. More explicit. | |

**User's choice:** Extend isSystemMove
**Notes:** Discussed in depth via explain Q-01. User explored whether MoveTracker should have path awareness of action folders, walked through the architecture of two independent polling loops, and concluded the activity log cross-reference is the clean solution.

### Action folder path awareness in MoveTracker

| Option | Description | Selected |
|--------|-------------|----------|
| Activity log cross-reference only (no path awareness) | Relies on timing — action processor logs before MoveTracker confirms. | ✓ |
| Add action folder paths to MoveTracker exclusion list | Belt-and-suspenders with activity log. | |

**User's choice:** Activity log cross-reference only
**Notes:** User initially considered making MoveTracker skip action folder paths during deep scan, then realized this leaves unresolved disappearances from INBOX. Activity log is cleaner.

### Timing race between action processor and MoveTracker

| Option | Description | Selected |
|--------|-------------|----------|
| Rely on two-scan confirmation window | Natural timing safety — by second scan, action processor has logged. | ✓ |
| Add explicit coordination | Action processor notifies MoveTracker to suppress message IDs. | |

**User's choice:** Rely on two-scan confirmation window
**Notes:** Confirmed after walking through the full timing sequence: disappearance detected → pending confirmation → action processor runs and logs → confirmation scan checks isSystemMove → filtered out.

---

## Activity Logging Extension

### logActivity signature for action-folder source

| Option | Description | Selected |
|--------|-------------|----------|
| Extend source union type, add 'action-folder' | Widen literal union. Action folder builds ActionResult-shaped objects. | ✓ |
| New logActionFolderActivity method | Separate method with cleaner signature for action folder ops. | |

**User's choice:** Extend source union type
**Notes:** None

### What action value for undo operations

| Option | Description | Selected |
|--------|-------------|----------|
| User intent: 'vip', 'block', 'undo-vip', 'unblock' | Describes user intent, clear in UI. Four distinct values. | ✓ |
| Rule ops: 'skip-create', 'skip-remove', 'delete-create', 'delete-remove' | Structured, query-friendly. Harder to read in UI. | |

**User's choice:** User intent strings
**Notes:** None

### Conflicting rule removal logging

| Option | Description | Selected |
|--------|-------------|----------|
| Two separate log entries (remove + create) | Each operation its own row. Same message_id links them. | ✓ |
| Single entry with conflict details | One row, needs new column or overloaded field. | |

**User's choice:** Two separate entries
**Notes:** None

---

## Action Type Registry

### Registry data structure

| Option | Description | Selected |
|--------|-------------|----------|
| Static Map/Record with typed entries | Simple Record keyed by action type. Module-level constant. | ✓ |
| Class-based registry with register/lookup | More ceremony, supports runtime registration. | |

**User's choice:** Static Map/Record
**Notes:** None

### Action type identifiers

| Option | Description | Selected |
|--------|-------------|----------|
| camelCase: vip, block, undoVip, unblock | Matches config schema keys from Phase 17. | ✓ |
| kebab-case: vip, block, undo-vip, unblock | More readable in logs. Mismatches config. | |

**User's choice:** camelCase
**Notes:** None

### Processing function shape

| Option | Description | Selected |
|--------|-------------|----------|
| Declarative: { operation, ruleAction } | Two fields describe all four types. Single code path. | ✓ |
| Callback: (sender, deps) => Result | Per-type functions. More flexible. More code. | |

**User's choice:** Declarative config
**Notes:** None

### Message destination resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Abstract refs: 'inbox' \| 'trash' | Resolved from config at runtime. Survives config changes. | ✓ |
| Resolved folder paths | Less indirection. Needs re-registration on config change. | |

**User's choice:** Abstract refs
**Notes:** None

---

## Shared findSenderRule Predicate

### findSenderRule location

| Option | Description | Selected |
|--------|-------------|----------|
| New src/rules/sender-utils.ts | Extract isSenderOnly there too. Clean rules-domain home. | ✓ |
| Add to src/rules/conflict-checker.ts | Related logic but file gets bigger. | |

**User's choice:** New sender-utils.ts
**Notes:** None

### findSenderRule return shape

| Option | Description | Selected |
|--------|-------------|----------|
| Rule \| undefined | Simple. Caller checks action type. Matches existing patterns. | ✓ |
| { rule, isConflict } \| undefined | Bundles conflict info. Couples concerns. | |

**User's choice:** Rule | undefined
**Notes:** None

---

## File Organization

### Where does the action registry live

| Option | Description | Selected |
|--------|-------------|----------|
| src/action-folders/ | Dedicated directory. Isolated from existing src/actions/. | ✓ |
| src/actions/registry.ts | Fits in existing dir but mixes concepts. | |

**User's choice:** src/action-folders/
**Notes:** None

### Phase 18 scope boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Pure building blocks — no processor skeleton | isSystemMove ext, logActivity ext, registry, findSenderRule. | ✓ |
| Include processor skeleton with stub methods | Also creates ActionFolderProcessor class. | |

**User's choice:** Pure building blocks
**Notes:** None

---

## Claude's Discretion

- Internal naming of ActionDefinition type fields
- Whether findSenderRule uses exact string match or picomatch for sender comparison
- Test file organization within test/unit/ for new modules
- Whether isSenderOnly re-export uses re-export or wrapper function

## Deferred Ideas

None — discussion stayed within phase scope
