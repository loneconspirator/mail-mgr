---
created: 2026-04-19T20:57:00.000Z
title: Populate delivered-to field in proposed rules and modify form
area: ui
files:
  - src/components/proposed (proposal card / modify modal)
  - src/api (proposal generation / rule creation)
---

## Problem

When proposed rules are generated from move tracking data, the "delivered to" field is not being populated as part of the matching criteria. This means approved rules lack a delivered-to matcher, making them less precise. Additionally, when opening the Modify form for a proposed rule, the delivered-to field should be prepopulated with the value from the proposal so users can see and adjust it.

## Solution

- Extract the delivered-to header from tracked messages when generating proposals
- Include delivered-to as a matcher in proposed rules
- Prepopulate the delivered-to field in the Modify modal when editing a proposed rule
- Ensure the approve flow also includes the delivered-to matcher in the created rule
