---
created: 2026-04-19T20:52:23.042Z
title: Add approve as review button for proposed rules
area: ui
files:
  - src/components/proposed (proposal card components)
---

## Problem

On the Proposed rule page, when a simple move rule is being proposed, users can only approve it as a move rule. There's no option to approve the proposal but convert it to a review rule instead. Users may want to review messages from a sender before auto-moving them, using the same destination folder and sender criteria but with review semantics instead of auto-move.

## Solution

Add an "Approve as Review" button alongside the existing "Approve" button on proposal cards (at minimum for simple move rule proposals). The button should:
- Use the same destination folder and sender from the proposal
- Create a review rule instead of a move rule
- Use the same approve/markApproved endpoint pattern but with rule type set to review
- Card should fade out with toast confirmation, same as regular approve flow
