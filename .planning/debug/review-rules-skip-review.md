---
status: diagnosed
trigger: "Review rules are being treated as move rules — mail goes straight to the destination folder instead of being routed through the review folder first."
created: 2026-04-23T00:00:00Z
updated: 2026-04-23T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — In actions/index.ts line 44, review action uses `action.folder ?? ctx.reviewFolder`, but action.folder is the POST-review destination, not the review folder. So when a review rule has a folder set (which most do in production config), mail goes straight to the destination folder, skipping the review folder entirely.
test: Code reading and config analysis confirms the mechanism
expecting: N/A — root cause found
next_action: Return diagnosis

## Symptoms

expected: When a rule has a "review" action type, incoming mail matching that rule should first be moved to a review folder, and only after human review should it end up in the final destination folder.
actual: Review rules are behaving identically to "move" rules — mail goes directly to the destination folder, completely skipping the review step.
errors: No explicit errors in server logs. Logs flooded with action folder processing (Block Sender, Undo VIP, Unblock Sender, VIP Sender) — each finding 1 message, failing to process, retrying, failing again, every 15 seconds. No log output visible about rule processing or review workflow at all.
reproduction: Real incoming mail on the production server (Soma/Portainer). Rules configured for a specific sender with review action — mail arrives and goes straight to the destination folder.
started: First deployment of this milestone. Review rules have never been tested on the server before — only local/dev testing.

## Eliminated

## Evidence

- timestamp: 2026-04-23T00:01:00Z
  checked: src/actions/index.ts lines 43-45 — review action handler
  found: "const folder = action.folder ?? ctx.reviewFolder" — uses action.folder (the post-review destination) as the immediate move target. Only falls back to ctx.reviewFolder when action.folder is undefined.
  implication: Any review rule with a folder set bypasses the review folder entirely.

- timestamp: 2026-04-23T00:02:00Z
  checked: data/config.yml — production rules
  found: All review rules in production config have action.folder set (e.g. "2_Mailing Lists/FB", "1_Activities/Health", "2_Mailing Lists"). The review.folder is "Review".
  implication: Every single review rule in production skips the review folder.

- timestamp: 2026-04-23T00:03:00Z
  checked: src/sweep/index.ts lines 42-45 — sweep destination resolver
  found: Sweep's resolveSweepDestination also reads action.folder to determine where to move messages FROM the review folder. This confirms action.folder is the POST-review destination, not the immediate target.
  implication: The design intent is clear — action.folder means "where to go after review". The monitor's action handler uses it wrong.

- timestamp: 2026-04-23T00:04:00Z
  checked: seed-data.yml line 30 — dev test rule
  found: Dev seed data has a review rule WITHOUT action.folder set. This would correctly go to the review folder via the fallback.
  implication: Dev testing likely only tested review rules without folder set, masking this bug.

## Resolution

root_cause: In src/actions/index.ts line 44, the review action handler uses `action.folder ?? ctx.reviewFolder` to determine the move destination. The `action.folder` field on a review rule represents the POST-review destination (where mail should go after human review during sweep), but the monitor's action handler uses it as the IMMEDIATE move target. Since all production review rules have action.folder set, every review rule behaves identically to a move rule — mail goes straight to the final destination folder, completely bypassing the Review folder. Dev testing missed this because the seed data only had a review rule WITHOUT action.folder set, which correctly fell back to ctx.reviewFolder.
fix:
verification:
files_changed: []
