# Phase 4: Config & Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-10
**Phase:** 04-config-cleanup
**Areas discussed:** Per-stream archive defaults, Rule name auto-generation

---

## Per-stream Archive Defaults

### Question: How should per-stream archive defaults work?

| Option | Description | Selected |
|--------|-------------|----------|
| Two archive fields (Recommended) | Add a second archive folder field — one for inbox-sourced messages (monitor), one for review-sourced (sweep/batch). | |
| Archive map by source folder | A flexible mapping: any source folder can have its own default archive destination. | |
| You decide | Claude picks the approach based on codebase patterns and simplicity. | |

**User's choice:** None of the above — user asked for clarification on when inbox processing would use a default archive folder. After tracing the Monitor code, confirmed that inbox processing has no archive fallback (unmatched messages stay in INBOX). CONF-02 was narrowed to just making the existing `defaultArchiveFolder` editable in the UI.

**Notes:** The "per-stream" framing in CONF-02 was based on a false premise. Only the sweep/review path uses `defaultArchiveFolder`. No schema change needed for per-stream split.

### Question: Where should the editable sweep/archive settings appear in the UI?

| Option | Description | Selected |
|--------|-------------|----------|
| Edit in place (Recommended) | Turn existing read-only Sweep Settings card into editable form with Save button. | ✓ |
| Modal form | Keep card read-only, add Edit button that opens a modal. | |
| You decide | Claude picks the approach. | |

**User's choice:** Edit in place (Recommended)
**Notes:** Minimal UI change — swap static text for input fields.

### Question: Should folder destinations use the tree picker?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, reuse tree picker | Phase 2 tree picker component already built. Consistent UX. | ✓ |
| Keep as text input | Plain text input, simpler for rarely-changed settings. | |
| You decide | Claude picks based on effort vs consistency. | |

**User's choice:** Yes, reuse tree picker
**Notes:** None.

---

## Rule Name Auto-Generation

### Question: Where should rule name generation happen?

| Option | Description | Selected |
|--------|-------------|----------|
| Backend on save (Recommended) | Backend generates name if empty before persisting. | |
| Frontend before submit | UI generates preview name as user fills in fields. | |
| Both with preview | Frontend preview, backend authoritative. | |

**User's choice:** Remove the name field altogether.
**Notes:** User wanted to eliminate the name field as a required concept. After discussion, refined to: name is optional, behavior description (generated from match + action) is always the primary display, name shown as secondary label when present.

### Question: How should the generated behavior description read?

| Option | Description | Selected |
|--------|-------------|----------|
| Match → Destination | Primary match field and action target. Compact. | |
| Full match summary | All match fields. More complete but longer. | |
| You decide | Claude picks a format. | |

**User's choice:** Show all populated match fields, skip empty ones. Format: `sender:*@github.com, subject:*PR* → Notifications`
**Notes:** Only include match fields that have a value. Comma-separated fields, arrow to destination.

---

## Claude's Discretion

- Save button behavior for sweep settings form
- Validation feedback style
- CSS/layout for editable sweep card
- Message cursor toggle UI presentation
- Stale sweeper bug investigation approach

## Deferred Ideas

None — discussion stayed within phase scope.
