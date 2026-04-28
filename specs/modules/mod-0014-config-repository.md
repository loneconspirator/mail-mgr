---
id: MOD-0014
title: ConfigRepository
interface-schema: src/config/repository.ts
unit-test-path: test/unit/config/
integrations: [IX-005, IX-007, IX-008]
invariants-enforced: []
architecture-section: architecture.md#configuration--state
---

## Responsibility

Manages the YAML configuration file. Provides CRUD operations for rules and update operations for IMAP, review, and action-folder config sections. Maintains change listeners that notify subsystems when configuration changes, triggering hot-reloads without restart.

## Interface Summary

- `getConfig()` — Return the full parsed config object.
- `getRules()` — Return the current rule list.
- `getImapConfig()` — Return the IMAP config section.
- `addRule(input)` — Create a new rule with auto-generated UUID, persist to YAML, notify listeners. Returns the created rule.
- `updateRule(id, input)` — Update an existing rule by ID.
- `deleteRule(id)` — Delete a rule by ID.
- `nextOrder()` — Return the next available order value for new rules.
- `reorderRules(pairs)` — Bulk reorder rules by ID/order pairs.
- `onRulesChange(fn)` — Register a callback for rule changes.
- `onImapConfigChange(fn)` — Register a callback for IMAP config changes.
- `updateImapConfig(input)` — Update IMAP config, persist, notify listeners.
- `getReviewConfig()` / `updateReviewConfig(input)` / `onReviewConfigChange(fn)` — Review config CRUD and listeners.
- `getActionFolderConfig()` / `updateActionFolderConfig(input)` / `onActionFolderConfigChange(fn)` — Action folder config CRUD and listeners.

## Dependencies

- Zod (external) — Schema validation for config sections.
- File I/O — YAML read/write.

## Notes

- All write operations persist to the YAML file immediately and fire the appropriate change listeners synchronously.
- Rule IDs are UUIDs generated at creation time and are immutable.
- The rules change listener triggers hot-reloads in Monitor, ReviewSweeper, BatchEngine, and SentinelLifecycle.
- IMAP config changes trigger a full reconnection cycle across all IMAP-dependent subsystems.
