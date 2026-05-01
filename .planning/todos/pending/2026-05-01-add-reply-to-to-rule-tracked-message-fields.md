---
created: 2026-05-01T22:21:18.475Z
title: Add Reply-To to rule-tracked message fields
area: general
files:
  - src/config/schema.ts:35-53
  - src/rules/matcher.ts
  - src/rules/evaluator.ts
  - src/rules/conflict-checker.ts
  - src/rules/sender-utils.ts
  - src/web/routes/proposed-rules.ts
  - src/web/frontend/app.ts
  - src/web/frontend/rule-display.ts
  - specs/modules/mod-0005-rule-matcher.md
---

## Problem

`emailMatchSchema` in `src/config/schema.ts:35-53` currently exposes these matchable fields: `sender`, `recipient`, `subject`, `deliveredTo`, `visibility`, `readStatus`. The `Reply-To` header is not among them.

Lots of bulk/marketing senders use `From` addresses that don't repeat across messages (e.g. randomized per-send) but route replies via a stable `Reply-To`. Without `Reply-To` as a tracked/matchable field, rules can't reliably target those senders, and proposed-rule generation can't suggest a `Reply-To`-based criterion when that's the only stable identifier on the message.

## Solution

Add `replyTo` as a first-class tracked field used by rules, mirroring the treatment of `deliveredTo`.

Touch points:
- `src/config/schema.ts` — add `replyTo: z.string().optional()` to `emailMatchSchema` and to the `.refine` "at least one field required" predicate.
- `src/rules/matcher.ts` / `src/rules/evaluator.ts` — extract `Reply-To` from message headers and compare against the matcher (likely the same string-match semantics as `sender`).
- `src/rules/sender-utils.ts` — extend address parsing helpers if needed to handle `Reply-To` cleanly.
- `src/rules/conflict-checker.ts` — include `replyTo` when comparing rule criteria for redundancy/shadowing.
- `src/web/routes/proposed-rules.ts` — when generating proposals, include `Reply-To` as a candidate matcher (especially when `From` looks unstable / per-send).
- `src/web/frontend/app.ts`, `src/web/frontend/rule-display.ts` — render and edit `Reply-To` in rule UI (New Rule modal, Modify modal, rule display).
- `specs/modules/mod-0005-rule-matcher.md` — document the new matcher field.

Open questions:
- Should `replyTo` matching default to substring/regex like `sender`, or normalized address-only? Likely match `sender` semantics for consistency.
- Backfill: do we need to capture `Reply-To` for already-tracked messages, or only flow it through for new arrivals? Probably new-arrivals-only is fine; rules apply going forward.
