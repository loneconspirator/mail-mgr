# Phase 28: Sentinel Planting & Lifecycle - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 28-sentinel-planting-lifecycle
**Areas discussed:** Tracked Folder Discovery, Planting Trigger Points, Cleanup Trigger & Orphan Detection, Self-Test Gate Integration
**Mode:** --auto (all areas auto-selected, recommended defaults chosen)

---

## Tracked Folder Discovery

| Option | Description | Selected |
|--------|-------------|----------|
| Single collector function | Scans config + rules, returns Map<string, FolderPurpose> excluding INBOX | ✓ |
| Per-source discovery | Each subsystem (rules, action folders, sweeper) exposes its own folder list | |
| Store-driven | Query SentinelStore and only reconcile on explicit events | |

**User's choice:** [auto] Single collector function (recommended default)
**Notes:** Cleanest approach — one function that takes config as input, callable from any context. Avoids coupling to subsystem internals.

---

## Planting Trigger Points

| Option | Description | Selected |
|--------|-------------|----------|
| Startup + all config change handlers | Plant at startup, re-reconcile on every config change event | ✓ |
| Startup only | Plant once, rely on restart for changes | |
| Event-driven per-change | Each config handler plants/removes individually without full reconciliation | |

**User's choice:** [auto] Startup + all config change handlers (recommended default)
**Notes:** Matches existing patterns — config change handlers already stop/rebuild subsystems. Adding sentinel reconciliation is consistent.

---

## Cleanup Trigger & Orphan Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Diff-based reconciliation | Compare tracked set vs store, clean up orphans at same trigger points as planting | ✓ |
| Per-event cleanup | Each config change handler specifically tracks what was removed and cleans up | |
| Periodic sweep | Timer-based scan for orphans independent of config changes | |

**User's choice:** [auto] Diff-based reconciliation (recommended default)
**Notes:** Stateless and idempotent. Handles edge cases (manual config file edits, multiple simultaneous changes) that per-event cleanup would miss.

---

## Self-Test Gate Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Run before planting, disable on failure | Self-test in main() after connect, set sentinelEnabled flag, graceful degradation | ✓ |
| Run before planting, crash on failure | Self-test failure is fatal — app won't start without sentinel support | |
| Run async after startup | Non-blocking self-test, planting waits for result | |

**User's choice:** [auto] Run before planting, disable on failure (recommended default)
**Notes:** Matches Phase 27 D-05 decision: "log a warning and disable the sentinel system gracefully — do not crash the app."

---

## Claude's Discretion

- Internal naming of reconciliation orchestrator
- Debounce strategy for config change handlers
- Error handling granularity for individual folder failures
- Test organization and mocking strategy

## Deferred Ideas

None — discussion stayed within phase scope
