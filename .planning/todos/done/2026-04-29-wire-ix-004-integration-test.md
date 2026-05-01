---
created: 2026-04-29T06:43:51.149Z
title: Wire IX-004 integration test
area: testing
files:
  - specs/integrations/ix-004-signal-logging-and-proposal-creation.md
  - test/integration/
  - src/tracking/index.ts
  - src/tracking/proposals.ts
---

## Problem

IX-004 (Signal logging and proposal creation/update) declares 8 named interactions (IX-004.1–IX-004.8) but the spec frontmatter has `integration-test: null`. Surfaced by `/validate` sweep on 2026-04-28: validators emit `IX-INTEGRATION-TEST-UNSET` and `IX-NAMED-INTERACTIONS-WITHOUT-TEST`.

The proposal upsert paths (create / same-destination match / contradicting destination / dismissed-resurface / approved-noop) are exercised through UC-001 and UC-006 acceptance tests and through IX-012's resurfacing test, but no single integration test asserts each IX-004.N branch in isolation.

## Solution

Create `test/integration/ix-004-signal-logging-and-proposal-creation.test.ts` with one named `it('IX-004.N: ...')` block per interaction:

- **IX-004.1** — `MoveTracker` invokes `patternDetector.processSignal(moveSignal)`
- **IX-004.2** — `SignalStore.logSignal` persists raw metadata (this is the call MoveTracker makes directly — see the recently-fixed sequence diagram)
- **IX-004.3** — `PatternDetector` builds `{sender, envelopeRecipient, sourceFolder}` proposal key
- **IX-004.4** — No existing proposal → create with `status=active`, `matching_count=1`
- **IX-004.5** — Same-destination match → `matching_count` increments, strength label progresses
- **IX-004.6** — Different-destination match → `contradicting_count` increments, dominant may shift
- **IX-004.7** — Dismissed proposal → `signals_since_dismiss++`; reaches 5 → status flips to `active`
- **IX-004.8** — Approved proposal → no update

Use a real SQLite-backed `SignalStore` + `ProposalStore` + `PatternDetector`. Drive signals via `signalStore.logSignal` + `patternDetector.processSignal` (no IMAP needed — this integration is pure persistence + state-machine logic).

Then update `specs/integrations/ix-004-signal-logging-and-proposal-creation.md` frontmatter:
```yaml
integration-test: test/integration/ix-004-signal-logging-and-proposal-creation.test.ts
```

Re-run `/validate IX-004` to confirm WARN → PASS.
