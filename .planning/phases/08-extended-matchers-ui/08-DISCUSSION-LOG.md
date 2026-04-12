# Phase 8: Extended Matchers UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 08-extended-matchers-ui
**Areas discussed:** Rule editor layout, Visibility control, Discovery status UX, Disabled field states

---

## Rule Editor Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Below existing fields | Flat list: Name, Sender, Subject, Delivered-To, Visibility, Read Status, then Action/Folder | ✓ |
| Grouped with separator | Original fields in one group, new fields in labeled "Extended Matching" group | |
| Collapsible advanced section | New fields hidden behind "Advanced ▸" toggle | |

**User's choice:** Below existing fields — natural extension, no grouping needed
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Blank/unset like other fields | Consistent with sender/subject — empty means don't filter | ✓ |
| Default to 'Any' selected | Pre-populated dropdown showing three-value enum | |

**User's choice:** Blank/unset — consistency with existing field behavior
**Notes:** None

---

## Visibility Control

| Option | Description | Selected |
|--------|-------------|----------|
| Single dropdown | (blank), direct, cc, bcc, list. One rule = one visibility value | ✓ |
| Multi-select creating multiple rules | Checkboxes, selecting multiple creates duplicate rules behind the scenes | |
| Multi-select stored as array | Override Phase 7 D-04, store as array in config | |

**User's choice:** Single dropdown — matches Phase 7 single-value config decision
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Visibility | Matches config field name and Phase 6/7 terminology | |
| Header Type | Descriptive of what it checks | |
| Recipient Type | Frames from user's perspective | |
| Recipient Field | (Other — user's custom input) | ✓ |

**User's choice:** "Recipient Field" — user-provided custom label
**Notes:** User typed custom label rather than choosing from presented options

---

## Discovery Status UX

| Option | Description | Selected |
|--------|-------------|----------|
| Below IMAP form | New section below Save button with separator | ✓ |
| Separate card | Own settings card below IMAP card | |
| Inline with status badge | Compact display next to connection status line | |

**User's choice:** Below IMAP form with labeled separator
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Disable button + spinner | Button grays out, shows "Discovering..." | ✓ |
| Replace with progress text | Button disappears, replaced with updating text | |
| You decide | Claude picks | |

**User's choice:** Disable button + spinner
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Warning + run button | "⚠ No envelope header detected" with explanation of affected fields | ✓ |
| Neutral info + run button | "Not configured" in neutral text | |
| You decide | Claude picks | |

**User's choice:** Warning style with explanation of which fields are affected
**Notes:** None

---

## Disabled Field States

| Option | Description | Selected |
|--------|-------------|----------|
| Grayed out + tooltip | Fields visible but disabled, hover tooltip explains why | ✓ |
| Hidden entirely | Don't show fields when unavailable | |
| Visible with inline warning | Fields shown with warning icon and text below | |

**User's choice:** Grayed out with info icon tooltip pointing to IMAP settings discovery
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Show values but disabled | Saved values display grayed out, preserves context | ✓ |
| Show with warning banner | Values normal, banner at top about skipped rule | |
| You decide | Claude picks | |

**User's choice:** Show saved values but disabled — user sees what rule matches on
**Notes:** None

---

## Claude's Discretion

- Tooltip implementation approach (CSS vs title attribute vs custom)
- Spinner style for discovery
- API endpoint shape for discovery
- Form validation details for new fields
- "At least one match field" validation update

## Deferred Ideas

None — discussion stayed within phase scope
