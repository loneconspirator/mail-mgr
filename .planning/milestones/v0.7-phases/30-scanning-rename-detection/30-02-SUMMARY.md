---
phase: 30-scanning-rename-detection
plan: "02"
title: "Config Schema, Barrel Export & Startup Wiring"
subsystem: sentinel
tags: [config, wiring, scanner, startup]
dependency_graph:
  requires: [30-01]
  provides: [sentinel-scanner-operational, sentinel-config-schema]
  affects: [src/config/schema.ts, src/sentinel/index.ts, src/index.ts]
tech_stack:
  added: []
  patterns: [config-schema-extension, barrel-export, lifecycle-wiring]
key_files:
  created: []
  modified:
    - src/config/schema.ts
    - src/sentinel/index.ts
    - src/index.ts
decisions:
  - "Scanner placed after sentinel reconciliation, before monitor.start() — independent timer"
  - "Scanner rebuilt on IMAP reconnect only (not on rules/review config changes)"
metrics:
  duration_seconds: 98
  completed: "2026-04-22T18:09:40Z"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 30 Plan 02: Config Schema, Barrel Export & Startup Wiring Summary

Sentinel config schema with scanIntervalMs (5-minute default, positive int validation), barrel export of SentinelScanner, and full lifecycle wiring into application startup and IMAP reconnect flows.

## What Was Done

### Task 1: Add sentinel config schema and barrel export
- Added `sentinelConfigSchema` with `scanIntervalMs` field (zod: `.number().int().positive().default(300_000)`)
- Added `sentinel` field to `configSchema` with defaults
- Exported `SentinelConfig` type
- Exported `SentinelScanner` class and all scanner types from `src/sentinel/index.ts` barrel
- **Commit:** 7a15264

### Task 2: Wire SentinelScanner into application startup and reconnect
- Added `SentinelScanner` to sentinel barrel import in `src/index.ts`
- Declared `sentinelScanner` variable alongside other lifecycle variables
- Instantiated scanner after sentinel reconciliation with `config.sentinel.scanIntervalMs`
- Started scanner before `monitor.start()` (independent timer, non-blocking)
- Added scanner stop/cleanup in `onImapConfigChange` handler (alongside actionFolderPoller)
- Added scanner rebuild with new IMAP client after sentinel reconciliation in reconnect flow
- **Commit:** fd4ac36

## Threat Mitigations Applied

- T-30-03 (DoS via scanIntervalMs): Mitigated by zod `.int().positive()` validation — prevents zero or negative intervals

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. Scanner placed after sentinel reconciliation, before monitor.start() -- ensures sentinels are reconciled before first scan
2. Scanner rebuilt on IMAP reconnect only (not on rules/review config changes) -- scanner reads from sentinel store which is updated by reconcileSentinels

## Self-Check: PASSED
