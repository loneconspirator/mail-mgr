---
created: 2026-04-19T20:55:00.000Z
title: Prevent redundant proposed rules and handle rule ordering conflicts
area: ui
files:
  - src/components/proposed (proposal card components)
  - src/api (rule creation/validation endpoints)
---

## Problem

When a proposed rule matches an existing rule's criteria, the system currently allows it to be approved as-is, creating a duplicate/redundant rule. Additionally, if a proposed rule would never be matched because a higher-priority existing rule already catches those messages, the user gets no warning.

Three scenarios need handling:

1. **Exact match**: Proposed rule criteria matches an existing rule — don't allow straight approval, require modification so criteria differs
2. **Shadowed rule**: Proposed rule would never fire because a higher-priority rule already matches — don't allow save as-is. Instead, show which existing rule shadows it and offer to save the new rule *ahead* of the conflicting rule in priority order
3. **Display**: In both cases, show the existing rule that causes the conflict/redundancy so the user understands why they can't just approve

## Solution

- Add rule conflict detection on the backend (or frontend) that checks proposed rule criteria against existing rules before allowing approval
- For exact matches: disable Approve button, show conflict, require Modify flow
- For shadowed rules: show warning with the blocking rule, offer "Save ahead of [rule]" option that reorders priority
- Display the conflicting rule inline on the proposal card or in a modal
