---
phase: 20-monitoring-startup-recovery
reviewed: 2026-04-20T12:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/action-folders/poller.ts
  - src/action-folders/index.ts
  - test/unit/action-folders/poller.test.ts
  - src/index.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-20T12:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

The action folder poller implementation is solid with good error isolation per folder, an overlap guard, and a retry mechanism for the always-empty invariant. The test file is thorough and covers edge cases well. Two warnings relate to potential issues in the poller logic and startup sequence in `src/index.ts`.

## Warnings

### WR-01: Unhandled config error propagates past overlap guard

**File:** `src/action-folders/poller.ts:30`
**Issue:** If `this.deps.configRepo.getActionFolderConfig()` throws, the error propagates out of `scanAll()` (the `finally` block resets `processing`, which is correct). However, in the `start()` method at line 73, the `.catch()` handler will log it — but in direct calls to `scanAll()` (e.g., the pre-scan at startup in `src/index.ts:301`), this is already wrapped in try/catch. The real issue is that the early-return at line 31 (`if (!config.enabled) return`) exits without reaching `finally` — wait, no, it does reach `finally` since it's inside the `try`. Actually on closer inspection the flow is correct. Let me revise:

The actual concern: if `getActionFolderConfig()` throws synchronously (line 30), the error bubbles up unhandled from the `start()` interval callback. The `.catch()` at line 73 handles this. However, if the config repo throws repeatedly on every poll tick, the logger will be spammed with error logs every `pollIntervalMs` with no backoff or circuit breaker.

**Fix:** Consider adding a consecutive-failure counter with exponential backoff or a maximum error count before self-stopping:
```typescript
// In scanAll, after catch in the try block:
// Track consecutive full-cycle failures and stop after threshold
```

### WR-02: Stale `config` reference used in IMAP reconnect handler

**File:** `src/index.ts:206`
**Issue:** In the `onImapConfigChange` handler (line 206), `newConfig.review.trashFolder` is used as the fallback trash folder. However, `newConfig` is the parameter passed to the callback which is typed as the IMAP config section — it may not have a `review` property depending on the callback signature. If the type allows it, this works, but if `newConfig` is only the IMAP portion of config, this would be a runtime error accessing `undefined.trashFolder`.

Looking more carefully at line 144: `configRepo.onImapConfigChange(async (newConfig) => {` — the parameter name `newConfig` suggests it receives the new IMAP-specific config. At line 206: `newConfig.review.trashFolder` — if this is only the IMAP config portion, accessing `.review` would be undefined.

**Fix:** Use `configRepo.getConfig().review.trashFolder` instead:
```typescript
const resolvedTrashAf2 = await newClient.getSpecialUseFolder('\\Trash') ?? configRepo.getConfig().review.trashFolder;
```

## Info

### IN-01: Potential undefined in folder path construction

**File:** `src/action-folders/poller.ts:88`
**Issue:** `config.folders[def.folderConfigKey]` could be `undefined` if the registry defines a `folderConfigKey` that doesn't exist in the config's `folders` record, resulting in a path like `Actions/undefined`. This is unlikely given the schema validation, but there's no runtime guard.

**Fix:** Add a filter or guard:
```typescript
.filter(([_, def]) => config.folders[def.folderConfigKey] != null)
```

---

_Reviewed: 2026-04-20T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
