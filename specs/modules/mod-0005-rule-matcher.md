---
id: MOD-0005
title: RuleMatcher
interface-schema: src/rules/matcher.ts
unit-test-path: test/unit/rules/
integrations: [IX-001, IX-006]
invariants-enforced: []
architecture-section: architecture.md#core-processing
---

## Responsibility

Tests a single rule's match fields against a message. All specified fields must match (AND logic). Uses glob patterns for sender, recipient, subject, and deliveredTo; exact matching for visibility and readStatus.

## Interface Summary

- `matchRule(rule, message)` — Returns true if all of the rule's specified match fields match the message.

## Dependencies

- picomatch (external) — Glob pattern matching for string fields.

## Notes

- At least one match field must be specified on a rule (enforced at config validation time, not here).
- Glob patterns support wildcards (e.g., `*@example.com`, `*newsletter*`).
- `readStatus` checks the IMAP `\Seen` flag: `read` = flag present, `unread` = flag absent, `any` = skip check.
- `visibility` is derived from envelope analysis: `direct` (in To), `cc` (in Cc), `bcc` (neither), `list` (mailing list headers present).
