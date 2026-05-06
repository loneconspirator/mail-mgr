# Deferred items — quick-260501-ov9

## Pre-existing flaky test (out of scope)

**Test:** `test/acceptance/uc_001_manual_move_to_rule_to_auto_filing.test.ts > UC-001.c: rule action is review, ReviewSweeper files after readMaxAgeDays`

**Symptom:** Fails in full `npm test` (`expected [469, 470] to have a length of 1 but got 2`), passes when run in isolation (`npx vitest run test/acceptance/uc_001_manual_move_to_rule_to_auto_filing.test.ts`).

**Verified independent of this plan:** Reverted the two src/web/frontend files to the pre-Task-2 state and re-ran the suite; the same UC-001.c failure surfaced. Touches no replyTo code paths — UC-001.c exercises ReviewSweeper / readMaxAgeDays / ReviewFolder via real GreenMail.

**Hypothesis:** Parallel test interference between acceptance specs (likely two suites racing on the GreenMail REVIEW folder; one's UID seed leaks into the other's expectation). Possibly fixed by serializing acceptance suites or by isolating the REVIEW mailbox per test.

**Disposition:** Out of scope for this quick task. Filed for follow-up.
