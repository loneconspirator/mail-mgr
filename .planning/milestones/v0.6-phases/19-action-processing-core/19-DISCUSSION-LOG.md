# Phase 19: Action Processing Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 19-action-processing-core
**Areas discussed:** Processor architecture, Sender extraction, Rule conflict resolution, Message routing after processing
**Mode:** Auto (all areas auto-selected, recommended defaults chosen)

---

## Processor Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Class with dependency injection | Matches MoveTracker/BatchEngine pattern — constructor-injected deps | ✓ |
| Standalone functions | Functional approach, pass deps per call | |
| Module singleton | Single instance, initialized at import time | |

**User's choice:** Class with dependency injection (auto-selected: recommended default)
**Notes:** Aligns with established codebase patterns. MoveTracker and BatchEngine both use this approach.

---

## Sender Extraction

| Option | Description | Selected |
|--------|-------------|----------|
| Parse envelope + normalize to bare email | Use From header, strip display name, lowercase | ✓ |
| Use raw From string with regex | Simple regex extraction | |

**User's choice:** Parse envelope + normalize to bare email (auto-selected: recommended default)
**Notes:** PROC-05 requires lowercase bare email address. Dedicated utility function keeps parsing testable.

---

## Rule Conflict Resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Remove conflicting rule first, then create | Avoids coexistence window, log both separately | ✓ |
| Create first, then remove conflict | Could have brief dual-rule window | |
| Atomic swap (single operation) | Would need new ConfigRepository method | |

**User's choice:** Remove conflicting rule first, then create (auto-selected: recommended default)
**Notes:** Matches Phase 18 D-06 decision. Two separate activity entries with same message_id for auditability.

---

## Message Routing After Processing

| Option | Description | Selected |
|--------|-------------|----------|
| Use ImapClient.moveMessages(), resolve destinations from config | Abstract destinations resolved at runtime | ✓ |
| Hardcode INBOX/Trash paths | Simpler but brittle | |

**User's choice:** Use ImapClient.moveMessages(), resolve destinations from config (auto-selected: recommended default)
**Notes:** Matches Phase 18 D-10 registry pattern. Trash folder uses existing resolution logic.

---

## Claude's Discretion

- Internal type for processMessage return value
- Sender extraction implementation details (regex vs parser)
- Error message wording
- Test fixture structure

## Deferred Ideas

None — discussion stayed within phase scope
