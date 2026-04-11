# Phase 3: Batch Filing Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 03-batch-filing-engine
**Areas discussed:** Rule selection UX, Dry-run output, Cancellation behavior, Job lifecycle

---

## Rule Selection UX

| Option | Description | Selected |
|--------|-------------|----------|
| All rules | Apply entire ruleset to source folder — simplest UX, matches Monitor | ✓ |
| Multi-select rules | Checkbox list of rules — more control but adds UI complexity | |
| Single rule only | One rule at a time — simplest but tedious for diverse folders | |

**User's choice:** All rules
**Notes:** Matches how Monitor already works. User picks a folder, hits go.

| Option | Description | Selected |
|--------|-------------|----------|
| Leave in place | Unmatched messages stay in source folder | ✓ |
| Move to default folder | Unmatched go to configurable catchall | |
| You decide | Claude picks | |

**User's choice:** Leave in place
**Notes:** Safe default — user can review what's left and create new rules.

| Option | Description | Selected |
|--------|-------------|----------|
| All messages | Process every message in the folder | ✓ |
| Date range filter | Scope to messages within a time window | |
| You decide | Claude picks | |

**User's choice:** All messages
**Notes:** Dry-run is the safety valve for large folders.

| Option | Description | Selected |
|--------|-------------|----------|
| Tree picker | Reuse Phase 2 folder tree picker | ✓ |
| Dropdown list | Flat dropdown of folder names | |
| You decide | Claude picks | |

**User's choice:** Tree picker
**Notes:** Consistent UX, already built, shows hierarchy.

---

## Dry-Run Output

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped by destination | Messages grouped under target folder with counts | ✓ |
| Flat message list | Every message listed with matched rule and destination | |
| Counts-only summary | Just folder names with counts | |

**User's choice:** Grouped by destination
**Notes:** Shows the reorganization at a glance.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, expandable | Click a group to see messages for sanity-checking | ✓ |
| No, counts only | Groups show counts but no message details | |
| You decide | Claude picks | |

**User's choice:** Yes, expandable
**Notes:** Lets user verify before committing.

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm from preview | Dry-run shows results, then 'Run batch' button to execute | ✓ |
| Separate action | Dry-run is view-only, user starts real batch separately | |
| You decide | Claude picks | |

**User's choice:** Confirm from preview
**Notes:** Smooth two-step flow: preview then execute.

---

## Cancellation Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Cancel button | Visible button while batch is running | ✓ |
| Close the batch panel | Navigating away cancels the job | |
| You decide | Claude picks | |

**User's choice:** Cancel button
**Notes:** Simple, discoverable, standard pattern.

| Option | Description | Selected |
|--------|-------------|----------|
| Partial results summary | Show moved/skipped/remaining counts | ✓ |
| Just a cancelled message | Simple confirmation that it stopped | |
| You decide | Claude picks | |

**User's choice:** Partial results summary
**Notes:** User knows exactly where things stand.

| Option | Description | Selected |
|--------|-------------|----------|
| Stay moved | Already-moved messages remain in destinations | ✓ |
| Offer undo | Option to move messages back to source | |
| You decide | Claude picks | |

**User's choice:** Stay moved
**Notes:** IMAP moves are committed. Undo is v2 (BATC-08).

---

## Job Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Shared connection, serialize | Batch and monitor share IMAP connection, batch yields between chunks | ✓ |
| Pause monitor during batch | Stop monitor while batch runs | |
| You decide | Claude picks | |

**User's choice:** Shared connection, serialize
**Notes:** Simple, no connection conflicts. Batch yields so monitor can process new mail.

| Option | Description | Selected |
|--------|-------------|----------|
| One at a time | Only one batch can run, UI disables start | ✓ |
| Queue up to N | Allow queuing additional batches | |
| You decide | Claude picks | |

**User's choice:** One at a time
**Notes:** Avoids IMAP contention. Simple.

| Option | Description | Selected |
|--------|-------------|----------|
| Job continues server-side | Batch runs regardless of browser state | ✓ |
| Job cancels on disconnect | Leaving the page cancels the batch | |
| You decide | Claude picks | |

**User's choice:** Job continues server-side
**Notes:** User can return and see progress or final results.

| Option | Description | Selected |
|--------|-------------|----------|
| Persisted in activity log | Each move logged with source='batch' | ✓ |
| Separate batch history | Dedicated batch job table | |
| Ephemeral only | Results shown once, not stored | |

**User's choice:** Persisted in activity log
**Notes:** Consistent with monitor and sweep logging patterns.

## Claude's Discretion

- Chunk size selection (25-50 messages)
- Yield mechanism between chunks
- Internal batch state machine design
- API endpoint structure

## Deferred Ideas

None — discussion stayed within phase scope.
