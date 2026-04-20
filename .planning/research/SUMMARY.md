# Project Research Summary

**Project:** Mail Manager v0.6 Action Folders
**Domain:** IMAP email management — action-folder-driven rule management
**Researched:** 2026-04-20
**Confidence:** HIGH

## Executive Summary

Action folders are a well-scoped, mostly additive feature with direct prior art from SaneBox. The core mechanic: user drags a message into `Actions/VIP Sender` (or Block/Undo VIP/Unblock), the system extracts the sender, creates or removes a sender-only rule, moves the message to its destination, and the folder returns to empty. The v0.5 codebase already provides every building block — `ConfigRepository.addRule/deleteRule`, `executeMove`, `withMailboxLock`, `mailboxCreate`, `isSenderOnly`, and `logActivity` — which means v0.6 is new wiring, not new infrastructure. No new npm dependencies are required.

The recommended approach is a dedicated `ActionFolderProcessor` class (separate from Monitor and MoveTracker) that polls action folders using `status()` on a 15-second interval, switches into a folder only when `status.messages > 0`, processes each message sequentially, and returns. This sidesteps the IMAP IDLE single-folder limitation (RFC 2177 is a hard constraint), prevents duplicate IMAP connections, and leaves INBOX IDLE undisturbed during the 99%+ of polls where action folders are empty. An `ActionRegistry` plain object maps action type keys to behavior definitions, making future folder types additive.

The two highest-risk pitfalls are: MoveTracker misidentifying action folder moves as user-initiated moves (fix: add `'action-folder'` to `isSystemMove()` before any processing code ships, and log activity BEFORE the IMAP move), and split-brain state from crash between rule creation and message move (fix: idempotent check-before-create using `isSenderOnly()` + action type + sender match on every restart). Both have clear, low-effort preventions.

## Key Findings

### Recommended Stack

No new dependencies. imapflow already exposes every IMAP primitive needed for action folders.

**Core technologies:**
- **imapflow (existing ^1.2.8)**: `mailboxCreate` (array form for separator safety), `status()` (message count without selecting), `withMailboxLock` (temporary folder access) — all already proven in codebase
- **Zod (existing)**: Config schema extension for `actionFolders` section — follows established patterns
- **SQLite (existing)**: Activity logging with new `'action-folder'` source type

### Expected Features

**Must have (table stakes):**
- Folder auto-creation on startup (array-form `mailboxCreate`, handle already-exists gracefully)
- Always-empty-after-processing invariant (core UX promise)
- Restart recovery (pre-scan all action folders before poll timer starts)
- Correct sender extraction (lowercase bare address, validated)
- Idempotent rule creation/removal (check existing before creating)
- Message destination routing (VIP/Undo VIP → archive, Block → Trash, Unblock → INBOX)
- Activity logging with `'action-folder'` source
- Descriptive auto-generated rule names (`"VIP: sender@example.com"`)
- Error handling for malformed/missing From (move to INBOX, log, never leave in action folder)

**Should have (competitive):**
- Configurable folder names and prefix
- Extensible action type registry pattern

**Defer (v2+):**
- IDLE-based monitoring (15s poll is sufficient for v0.6)
- Nested action folders for folder-based filing
- Non-sender rule actions

### Architecture Approach

A dedicated `ActionFolderProcessor` with its own poll timer, separate from Monitor and MoveTracker, using STATUS pre-check before any mailbox switches.

**Major components:**
1. **ActionFolderProcessor** (`src/action-folders/processor.ts`) — poll timer, STATUS pre-check, sequential per-message processing, startup recovery
2. **ActionRegistry** (`src/action-folders/registry.ts`) — plain `Record<string, ActionDefinition>` with 4 entries; extensible by adding entries
3. **Config schema extension** (`src/config/schema.ts`) — `actionFolders` section with prefix, poll interval, folder names
4. **Shared predicates** — extract `isSenderOnly` for reuse, add `findSenderRule(sender, actionType)` to ConfigRepository

### Critical Pitfalls

1. **MoveTracker false move signals** — Add `'action-folder'` to `isSystemMove()` BEFORE processor ships. Log activity BEFORE IMAP move. Exclude action folder paths from destination tracking.
2. **Split-brain crash state** — Check-before-create on every startup. Rule write is sync, message move is async — idempotency is the only fix.
3. **IMAP hierarchy separator** — Use `mailboxCreate(['Actions', 'VIP Sender'])` array form always. Read back actual paths from server.
4. **IDLE disruption from mailbox switches** — STATUS pre-check before every `withMailboxLock`. Typical: 4 STATUS commands, zero mailbox switches, zero IDLE disruption.
5. **Undo deletes wrong rule** — Filter with `isSenderOnly()` always. If multiple match, delete highest-order. If none found, still move message.

## Implications for Roadmap

### Phase 1: Config Schema + Folder Lifecycle
**Rationale:** Config is the pure prerequisite for everything; folder creation must precede monitoring
**Delivers:** Zod schema for actionFolders config, IMAP folder creation on startup, separator-safe paths
**Addresses:** Config, folder auto-creation table stakes
**Avoids:** Hierarchy separator pitfall (array-form from day one)

### Phase 2: Shared Predicates + ActivityLog Extension
**Rationale:** MoveTracker safety MUST ship before any processing code — non-negotiable ordering
**Delivers:** Extracted `isSenderOnly`, `findSenderRule()`, `'action-folder'` in `isSystemMove()`
**Addresses:** MoveTracker interference prevention
**Avoids:** False move signals pitfall

### Phase 3: ActionRegistry + Processor Core
**Rationale:** With foundations in place, build the actual processing pipeline
**Delivers:** ActionRegistry, ActionFolderProcessor with STATUS pre-check, sender extraction, rule CRUD, message routing
**Addresses:** Core action folder processing, sender extraction, duplicate prevention
**Avoids:** IDLE disruption pitfall (STATUS pre-check pattern)

### Phase 4: Startup Recovery + Wiring
**Rationale:** Can't wire what isn't handling recovery; crash recovery must be baked in before production use
**Delivers:** Pre-scan on startup, wiring into main application lifecycle, config change propagation
**Addresses:** Restart recovery, always-empty invariant
**Avoids:** Split-brain crash state pitfall

### Phase 5: Idempotency Hardening + Edge Cases
**Rationale:** Validates everything built; no new system components, just targeted tests and edge case handling
**Delivers:** Comprehensive tests for duplicate prevention, undo-with-no-match, malformed From, crash-recovery scenarios
**Addresses:** Idempotent processing, error handling table stakes

### Phase Ordering Rationale

- Config first (pure dependency, no prerequisites)
- Predicates/ActivityLog second (MoveTracker safety before Processor ships — non-negotiable)
- Registry + Processor third (needs all prior foundations)
- Recovery + wiring fourth (can't wire what isn't handling recovery)
- Hardening last (validates what's built, no new system components)

### Research Flags

Phases with standard patterns (skip research-phase for all):
- **All phases:** CONFIG extension (known Zod pattern), predicate extraction (pure refactoring), ActivityLog type extension (one-line change), polling pattern (already in Monitor), `withMailboxLock` (already used by Sweep and BatchEngine)

Watch during implementation (Phase 3): Verify `status()` can be called while INBOX is selected and IDLEing.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All imapflow APIs verified; no new dependencies |
| Features | HIGH | PRD well-specified; SaneBox validates UX model |
| Architecture | HIGH | Deep codebase analysis; all patterns proven in existing components |
| Pitfalls | HIGH | Codebase-specific risks with real mitigations |

**Overall confidence:** HIGH

### Gaps to Address

- **`status()` non-selecting behavior**: Verify live against Fastmail during Phase 3 — HIGH confidence but worth a live check
- **`isSystemMove()` timing**: Enforce activity-log-before-IMAP-move ordering in Processor — critical correctness
- **Folder rename limitation**: Produce startup warning log when old paths contain messages; document as known limitation

## Sources

### Primary (HIGH confidence)
- imapflow official documentation — mailboxCreate, status(), withMailboxLock APIs
- RFC 2177 — IDLE single-folder limitation
- Existing codebase analysis — all integration points verified against source

### Secondary (MEDIUM confidence)
- SaneBox UX patterns — competitive analysis for action folder behavior expectations

---
*Research completed: 2026-04-20*
*Ready for roadmap: yes*
