---
created: 2026-05-01T22:14:39.591Z
title: Add Delayed Move rule type with INBOX sweep
area: general
files:
  - src/actions/index.ts
  - src/sweep/index.ts
  - src/config/repository.ts
  - src/web/routes/rules.ts
  - src/web/routes/proposed-rules.ts
  - src/web/frontend/app.ts
  - specs/modules/mod-0004-rule-evaluator.md
---

## Problem

Today rules support a "Review" action that moves a message to a Review folder, where the ReviewSweeper later acts on it after a configurable delay (separate durations for read vs unread). For some workflows the user wants the message to stay visible in INBOX during the delay period rather than being shunted to a separate folder — they want to see it sitting there, but still have it auto-cleared after the configured time elapses.

There is no current rule action that combines "leave in INBOX" + "deferred sweep" semantics. Users have to either:
- accept Review (which hides the message in another folder), or
- approve a normal Move (which acts immediately).

## Solution

Introduce a new rule action type: **Delayed Move**.

Behavior:
- Rule matches and is approved → message stays in INBOX (no immediate move).
- Sweeper picks it up later from INBOX (not from the Review folder) and performs the move once the delay elapses.
- Read vs unread durations configured separately, mirroring Review semantics.
- Reuse the same evaluation/sweep machinery as Review where possible — the ReviewSweeper today already implements the "delayed action with read/unread durations" pattern; generalize it so the source folder is configurable (INBOX for Delayed Move, Review folder for Review).

UI:
- On the proposed rules page, add a new button **"Approve as Delayed"** alongside the existing Review/Move approve actions.
- Approving as Delayed creates a rule with the new action type and the configured durations.

Touch points to investigate:
- `src/actions/index.ts` — register the new action type
- `src/sweep/index.ts` — generalize sweeper to handle INBOX-source delayed moves
- `src/config/repository.ts` — schema/storage for new action variant
- `src/web/routes/rules.ts`, `src/web/routes/proposed-rules.ts` — API support
- `src/web/frontend/app.ts` — new "Approve as Delayed" button + flow
- `specs/modules/mod-0004-rule-evaluator.md` — document new action semantics

Open questions:
- Should the delay durations be per-rule (like Review) or global defaults? Probably per-rule, matching Review.
- How does this interact with messages that get read/replied to during the delay window? Presumably same semantics as Review (read transition resets to "read" duration).
