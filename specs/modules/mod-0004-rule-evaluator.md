---
id: MOD-0004
title: RuleEvaluator
interface-schema: src/rules/evaluator.ts
unit-test-path: test/unit/rules/
integrations: [IX-001, IX-006]
invariants-enforced: []
architecture-section: architecture.md#core-processing
---

## Responsibility

Evaluates an ordered list of rules against a message using first-match-wins semantics. Filters out disabled rules and rules requiring unavailable envelope data before matching. Returns the first matching rule or null.

## Interface Summary

- `evaluateRules(rules, message)` — Iterate enabled rules sorted by order, return the first match or null.

## Dependencies

- MOD-0005 — Tests individual rules against messages.

## Notes

- Rules requiring `deliveredTo` or `visibility` match fields are silently skipped when the IMAP server does not support envelope header discovery. This prevents rules from being created that can never fire.
- The same function is used by Monitor (arrival), ReviewSweeper (sweep), and BatchEngine (batch), ensuring consistent evaluation semantics across all processing paths.
