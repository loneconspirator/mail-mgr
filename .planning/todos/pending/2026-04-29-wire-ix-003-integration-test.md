---
created: 2026-04-29T06:43:51.149Z
title: Wire IX-003 integration test
area: testing
files:
  - specs/integrations/ix-003-user-move-detection-and-destination-resolution.md
  - test/integration/
  - src/tracking/index.ts
---

## Problem

IX-003 (User move detection and destination resolution) declares 7 named interactions (IX-003.1–IX-003.7) but the spec frontmatter has `integration-test: null`. The behavior is exercised end-to-end by UC-001 and UC-006 acceptance tests, but no dedicated integration test asserts each named interaction in isolation.

Surfaced by `/validate` sweep on 2026-04-28: validators emit `IX-INTEGRATION-TEST-UNSET` and `IX-NAMED-INTERACTIONS-WITHOUT-TEST` warnings. As long as those warnings persist, future `/validate` runs will keep flagging IX-003 as WARN.

## Solution

Create `test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts` with one named `it('IX-003.N: ...')` block per interaction:

- **IX-003.1** — UID snapshot diff detects disappearance
- **IX-003.2** — Two-scan confirmation prevents false positive
- **IX-003.3** — `ActivityLog.isSystemMove` filters system-initiated moves
- **IX-003.4** — DestinationResolver fast-pass resolves via recent + common folders
- **IX-003.5** — Fast-pass miss enqueues for deep scan
- **IX-003.6** — Confirmed move emits signal with full metadata
- **IX-003.7** — Deep-scan miss drops the pending entry without erroring

Use real GreenMail + real `MoveTracker` + real `DestinationResolver` + real `SignalStore`. Pattern after `test/integration/ix-001-arrival-detection-and-rule-evaluation.test.ts`.

Then update `specs/integrations/ix-003-user-move-detection-and-destination-resolution.md` frontmatter:
```yaml
integration-test: test/integration/ix-003-user-move-detection-and-destination-resolution.test.ts
```

Re-run `/validate IX-003` to confirm WARN → PASS.
