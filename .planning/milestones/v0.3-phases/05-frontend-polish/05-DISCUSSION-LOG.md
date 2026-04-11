# Phase 5: Frontend Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-11
**Phase:** 05-frontend-polish
**Areas discussed:** No-match display fix, Cursor toggle API migration, catch(e: any) replacement

---

## No-Match Display Fix

### Visual Separation

| Option | Description | Selected |
|--------|-------------|----------|
| Muted styling only (Recommended) | Keep current approach: lighter text, normal weight. Fix the filter bug so CSS applies. No separator needed. | |
| Muted styling + divider line | Add a subtle horizontal rule or extra spacing between the last match group and the no-match group. | ✓ |
| Muted + collapsed by default | No-match group starts collapsed. Users click to see which messages didn't match. | |

**User's choice:** Muted styling + divider line
**Notes:** None

### Fix Location

| Option | Description | Selected |
|--------|-------------|----------|
| Fix frontend filter (Recommended) | Change frontend to check for action='no-match'. Backend already returns correct value. | ✓ |
| Fix backend to use skip | Change BatchEngine to return action='skip' with empty destination. | |

**User's choice:** Fix frontend filter
**Notes:** None

---

## Cursor Toggle API Migration

### API Namespace

| Option | Description | Selected |
|--------|-------------|----------|
| api.settings.getCursor / setCursor (Recommended) | New 'settings' namespace. Clean semantic separation. | |
| api.config.getCursor / setCursor | Add to existing 'config' namespace. Fewer new abstractions. | ✓ |
| You decide | Claude picks the namespace. | |

**User's choice:** api.config.getCursor / setCursor
**Notes:** Keep it tight — no need for a new namespace for two methods.

---

## catch(e: any) Replacement

### Refactoring Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Inline instanceof check (Recommended) | Each catch block gets catch(e: unknown) with inline instanceof check. Matches existing pattern at line 242. | ✓ |
| Shared errorMessage() helper | Extract a tiny helper function. DRYer but adds an abstraction. | |
| You decide | Claude picks the approach. | |

**User's choice:** Inline instanceof check
**Notes:** Match the existing pattern, no unnecessary abstractions.

---

## Claude's Discretion

- Exact CSS for divider line (border, margin, or spacing)
- Whether `api.config.getCursor` returns `{ enabled: boolean }` or just `boolean`

## Deferred Ideas

None — discussion stayed within phase scope.
