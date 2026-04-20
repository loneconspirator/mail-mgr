---
created: 2026-04-20T16:46:02.420Z
title: Rename skip rule display to leave in place
area: ui
files: []
---

## Problem

The "skip" rule action is displayed as "skip" in the UI, which isn't the clearest label for users. "Leave in place" better communicates what the action actually does — the email stays where it is, untouched.

## Solution

Rename all user-facing instances of "skip" to "leave in place" in the UI layer only. The backend storage, API, and internal references should continue using "skip" as the canonical value. This is a display-only change.

Key areas to update:
- Rule action labels/badges in rule lists
- Rule creation/editing forms (dropdowns, selectors)
- Disposition views where skip rules appear
- Any tooltips or help text referencing "skip"
- All relevant documentation (user-facing docs, help text) should reflect the new "leave in place" terminology
