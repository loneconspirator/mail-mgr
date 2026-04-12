# Phase 8: Extended Matchers UI - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Rule editor exposes three new match fields (envelope recipient, header visibility, read status) with appropriate controls, and the IMAP settings page shows auto-discovery status with manual re-trigger. This phase delivers UI changes only — the backend schema (Phase 7) and data layer (Phase 6) are upstream dependencies.

</domain>

<decisions>
## Implementation Decisions

### Rule Editor Layout
- **D-01:** New match fields placed below existing fields in a flat list. Field order: Name → Match Sender → Match Subject → Delivered-To → Recipient Field → Read Status → Action → Folder. No grouping, no separators, no collapsible sections.
- **D-02:** All new fields default to blank/unset, consistent with existing sender and subject fields. Empty means "don't filter on this field."
- **D-03:** Delivered-To is a text input with glob syntax, identical to existing sender input. Placeholder follows same pattern.

### Visibility Control
- **D-04:** Visibility rendered as a single `<select>` dropdown, not multi-select. Options: (blank/none), direct, cc, bcc, list. Matches Phase 7 D-04 single-value config schema — one rule = one visibility value.
- **D-05:** Dropdown labeled "Recipient Field" (user's chosen label, not "Visibility" or "Header Type").

### Read Status Control
- **D-06:** Read Status rendered as a `<select>` dropdown. Options: (blank/none), read, unread. No "any" option in UI — blank/unset is equivalent to "any" per Phase 7 D-06.

### Discovery Status UX
- **D-07:** Discovery status section appears below the IMAP form within the same settings card, separated by a labeled divider ("Envelope Discovery").
- **D-08:** When a header is discovered: displays header name (e.g., "Delivered-To") with a success indicator and a "Re-run Discovery" button.
- **D-09:** When no header discovered: warning style — "⚠ No envelope header detected" with explanation that rules using Delivered-To and Recipient Field will be skipped, plus a "Run Discovery" button.
- **D-10:** Re-run button disables and shows "Discovering..." with a spinner while the API call is in progress. Prevents double-clicks.

### Disabled Field States
- **D-11:** When envelope header is unavailable (not discovered), Delivered-To input and Recipient Field dropdown are visible but disabled/grayed out. An info icon (ⓘ) with tooltip explains: "Envelope header not discovered — run discovery in IMAP settings."
- **D-12:** Read Status is always available regardless of envelope header status (IMAP flags always present per Phase 7 D-09).
- **D-13:** When editing an existing rule that has deliveredTo/visibility values but envelope header is currently unavailable, the saved values display in the disabled fields so the user can see what the rule matches on. Values are preserved, just not editable.

### Behavior Description Updates
- **D-14:** `generateBehaviorDescription()` in rule-display.ts extended to include new fields in the rule summary shown in the rule list table.

### Claude's Discretion
- Specific tooltip implementation (CSS tooltip vs title attribute vs custom component)
- Spinner style for discovery re-run (CSS animation, text-only, etc.)
- API endpoint shape for discovery trigger and status retrieval
- Form validation messaging for new fields
- How the "at least one match field" validation in the modal accounts for the three new fields

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01 (rule editor new fields), UI-03 (IMAP settings discovery controls)

### Upstream Phase Context
- `.planning/phases/06-extended-message-data/06-CONTEXT.md` — D-01 through D-04 define auto-discovery trigger behavior, D-04 defines `envelopeHeader` config field name, D-07/D-08 define visibility classification
- `.planning/phases/07-extended-matchers/07-CONTEXT.md` — D-01 through D-03 define config field names (`deliveredTo`, `visibility`, `readStatus`), D-04 confirms single-value visibility, D-06 defines three-value readStatus enum, D-08/D-09 define unavailable field skip behavior

### Existing Code
- `src/web/frontend/app.ts` — Rule modal (`openRuleModal()` at line 143), IMAP settings (`renderSettings()` at line 340), form submission logic
- `src/web/frontend/rule-display.ts` — `generateBehaviorDescription()` to extend with new fields
- `src/web/frontend/api.ts` — API wrapper, needs discovery trigger endpoint
- `src/web/frontend/styles.css` — Existing styles for form groups, modals, settings cards
- `src/web/routes/imap-config.ts` — Backend IMAP config routes, may need discovery trigger endpoint
- `src/shared/types.ts` — Shared API types between frontend and backend
- `src/config/schema.ts` — `emailMatchSchema` with current match fields (Phase 7 will add `deliveredTo`, `visibility`, `readStatus`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `openRuleModal()` in app.ts — HTML template-based modal with form groups, folder picker integration. New fields add to the same template string.
- `renderFolderPicker()` — Tree picker pattern for folder selection, reusable approach for complex inputs
- `h()` helper — DOM element factory used throughout for dynamic rendering
- `toast()` — Notification pattern for success/error feedback, reuse for discovery status
- `updateFolderVisibility()` — Pattern for conditional field visibility based on another field's value, reuse for disabled state logic

### Established Patterns
- Settings page uses `Promise.all()` to load multiple API endpoints in parallel
- Form inputs use `document.getElementById()` with type casts for value extraction
- Settings cards are `<div class="settings-card">` containers with consistent styling
- Status badges use CSS classes: `connected`, `connecting`, `disconnected`
- API wrapper uses generic `request<T>()` function — new endpoints follow same pattern

### Integration Points
- Rule modal save handler (app.ts ~200-230) — needs to collect and validate new fields
- `api.config` namespace — needs discovery trigger method
- Settings render function — needs to fetch and display envelope header status
- Rule list table headers — may need columns or updated behavior descriptions for new fields

</code_context>

<specifics>
## Specific Ideas

- User chose "Recipient Field" as the label for visibility — not matching the internal field name, prioritizing user-facing clarity over technical consistency
- Warning state for undiscovered header should explicitly name which UI fields are affected ("Delivered-To and Recipient Field") so users understand the impact
- Flat field layout chosen over grouped/collapsible — user wants simplicity, all fields visible at once

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-extended-matchers-ui*
*Context gathered: 2026-04-12*
