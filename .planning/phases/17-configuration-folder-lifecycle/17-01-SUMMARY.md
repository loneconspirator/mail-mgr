---
phase: 17-configuration-folder-lifecycle
plan: "01"
title: Action Folder Config Schema and Repository
subsystem: config
tags: [config, schema, zod, action-folders]
dependency_graph:
  requires: []
  provides: [actionFolderConfigSchema, ActionFolderConfig, getActionFolderConfig, updateActionFolderConfig, onActionFolderConfigChange]
  affects: [src/config/schema.ts, src/config/repository.ts, src/config/index.ts, config/default.yml]
tech_stack:
  added: []
  patterns: [Zod schema with defaults, ConfigRepository getter/setter/callback pattern]
key_files:
  created:
    - test/unit/config/action-folders.test.ts
  modified:
    - src/config/schema.ts
    - src/config/repository.ts
    - src/config/index.ts
    - config/default.yml
decisions:
  - Used actionFolderDefaults.folders for Zod .default() instead of empty {} to ensure nested defaults propagate correctly
metrics:
  duration: 218s
  completed: "2026-04-20T20:29:15Z"
  tasks: 2
  files: 5
---

# Phase 17 Plan 01: Action Folder Config Schema and Repository Summary

Zod config schema for action folders with sensible emoji-prefixed defaults, ConfigRepository getter/setter/callback, and backward-compatible configSchema extension.

## Task Results

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add actionFolderConfigSchema to schema.ts and update configSchema | acb8a13 | src/config/schema.ts, src/config/index.ts, config/default.yml, test/unit/config/action-folders.test.ts |
| 2 | Add ConfigRepository methods for action folder config | 6aecdb0 | src/config/repository.ts, test/unit/config/action-folders.test.ts |

## What Was Built

- **actionFolderConfigSchema**: Zod schema with enabled (boolean, default true), prefix (string min(1), default 'Actions'), pollInterval (int positive, default 15), and folders sub-object with 4 configurable folder names (emoji-prefixed defaults)
- **configSchema extension**: actionFolders field at top level parallel to imap/server/rules/review with full defaults for backward compatibility
- **ActionFolderConfig type**: Exported from schema.ts and index.ts
- **ConfigRepository methods**: getActionFolderConfig(), updateActionFolderConfig() with Zod validation + persistence, onActionFolderConfigChange() callback for hot-reload
- **default.yml**: actionFolders section with all defaults documented
- **15 unit tests**: 10 schema tests (defaults, validation, backward compat) + 5 repository tests (get, update, validation error, callback invocation, persistence)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod nested default propagation**
- **Found during:** Task 1 GREEN phase
- **Issue:** Using `.default({})` on the folders sub-object caused Zod to use the literal `{}` without applying inner field defaults when parsing the schema directly
- **Fix:** Changed to `.default(actionFolderDefaults.folders)` so the full defaults object is used
- **Files modified:** src/config/schema.ts
- **Commit:** acb8a13

## Verification Results

- `npx vitest run test/unit/config/action-folders.test.ts` -- 15/15 passed
- `npx vitest run test/unit/config/` -- 75/75 passed (full backward compatibility)
- `npx vitest run` -- 486/493 passed (7 pre-existing frontend static file test failures, unrelated to config changes)

## Self-Check: PASSED
