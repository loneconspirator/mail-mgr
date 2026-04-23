---
phase: 31-auto-healing-failure-handling
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/sentinel/healer.ts
  - test/unit/sentinel/healer.test.ts
  - src/log/index.ts
  - src/sentinel/index.ts
  - src/index.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 31: Code Review Report

**Reviewed:** 2026-04-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This phase introduces `SentinelHealer` (`src/sentinel/healer.ts`) for automated recovery of renamed and lost IMAP folders. The implementation covers three healing paths: rename propagation into config, sentinel replanting when the folder still exists, and folder-loss handling with rule disabling and user notification.

The test suite in `test/unit/sentinel/healer.test.ts` is thorough and covers all major branches including dedup, error isolation, and the notification contract. `src/log/index.ts`, `src/sentinel/index.ts`, and `src/index.ts` are clean plumbing — the wiring in `src/index.ts` is correct.

Three warnings were found. None are crashes or data-loss bugs in the happy path, but one ordering issue (WR-01) means rules can be disabled silently if the INBOX notification append fails. The other two are type-safety and state-mutation issues.

---

## Warnings

### WR-01: Config persisted before INBOX notification — silent rule-disable on notification failure

**File:** `src/sentinel/healer.ts:199-203`

`handleFolderLoss` calls `saveConfig` (step 3) before `appendMessage` (step 4). If `appendMessage` rejects — for example due to a transient IMAP error — the config is already written with the affected rules marked `enabled: false`, but the user never receives an INBOX notification. On the next scanner tick, `getByMessageId` returns null (mapping was deleted at step 6 which also never runs), so the dedup guard exits early and no notification is ever sent. The user ends up with silently disabled rules and no idea why.

The config write should happen after the notification append succeeds, or the notification failure should be caught and retried without affecting the config write order.

**Fix:** Swap steps 3 and 4, or wrap the notification in a try/catch that reverts or re-queues on failure:

```typescript
// Option A: append notification first, then persist
const notification = buildNotificationMessage(result.expectedFolder, disabledRules);
await deps.client.appendMessage('INBOX', notification, ['\\Seen']); // step 4 first

saveConfig(deps.configPath, config);                                 // step 3 after
```

Alternatively, keep the current order but ensure notification failure is logged loudly and does not prevent the dedup state write.

---

### WR-02: In-place mutation of ConfigRepository's live config object

**File:** `src/sentinel/healer.ts:57-101` and `src/sentinel/healer.ts:170-179`

Both `handleRename` and `handleFolderLoss` call `deps.configRepo.getConfig()` and mutate the returned object directly (`rule.action.folder = newPath`, `rule.enabled = false`, etc.) before passing it to `saveConfig`. If `ConfigRepository.getConfig()` returns a reference to an internally cached object rather than a deep clone, this silently mutates the repository's live state without going through any repository update path.

This creates a hidden coupling: any other concurrent reader of `configRepo.getConfig()` (e.g., the rules-change handler in `src/index.ts:83`) sees partially-mutated config mid-operation, with no way to distinguish a deliberate update from an in-flight heal.

**Fix:** Either clone the config before mutating, or confirm `ConfigRepository.getConfig()` already returns a deep clone. A defensive clone is cheap and makes intent explicit:

```typescript
const config = structuredClone(deps.configRepo.getConfig());
// ... mutate config ...
saveConfig(deps.configPath, config);
```

---

### WR-03: Unsafe type cast `as FolderPurpose` silently accepts invalid purpose strings

**File:** `src/sentinel/healer.ts:153`

```typescript
await appendSentinel(
  deps.client,
  result.expectedFolder,
  result.folderPurpose as FolderPurpose,  // ← unsafe
  deps.sentinelStore,
);
```

`ScanResultBase.folderPurpose` is typed as `string`. `FolderPurpose` is a narrower union type (defined in `src/sentinel/format.ts`). The cast suppresses the TypeScript error without any runtime validation. If a sentinel was stored with an unrecognised purpose string (e.g. from a future schema change or a manual edit), `appendSentinel` will receive an invalid value and the resulting sentinel message body may be malformed.

**Fix:** Add a runtime guard before the cast, or narrow the source type:

```typescript
import { FOLDER_PURPOSES } from './format.js'; // export the union members as a const array

function isFolderPurpose(v: string): v is FolderPurpose {
  return (FOLDER_PURPOSES as readonly string[]).includes(v);
}

if (!isFolderPurpose(result.folderPurpose)) {
  deps.logger.warn({ folderPurpose: result.folderPurpose }, 'Unknown folder purpose; skipping replant');
  return;
}
await appendSentinel(deps.client, result.expectedFolder, result.folderPurpose, deps.sentinelStore);
```

---

## Info

### IN-01: Sequential `if` blocks instead of `else if` in main dispatch loop

**File:** `src/sentinel/healer.ts:31-45`

The three status branches are written as independent `if` checks rather than `if / else if / else`:

```typescript
if (result.status === 'found-in-place') { continue; }
if (result.status === 'found-in-different-folder') { handleRename(...); }
if (result.status === 'not-found') { ... }
```

This is currently correct because the discriminated union ensures `status` has exactly one value, and the `continue` on `found-in-place` prevents fall-through. However, if `continue` were accidentally removed or a future status added before the guard, both the rename and not-found handlers could execute. Using `else if` communicates the mutual-exclusion intent and is idiomatic for discriminated-union dispatch.

**Fix:**

```typescript
if (result.status === 'found-in-place') {
  continue;
} else if (result.status === 'found-in-different-folder') {
  handleRename(result, deps);
} else if (result.status === 'not-found') {
  // ...
}
```

---

### IN-02: `logSentinelEvent` stores `details` in `message_subject` column

**File:** `src/log/index.ts:90-96`

The SQL in `logSentinelEvent` maps `event.details` to the `message_subject` column:

```sql
INSERT INTO activity (
  timestamp, message_uid, message_subject, action, folder, success, source
) VALUES (datetime('now'), 0, ?, ?, ?, 1, 'sentinel')
```

The positional `?` bindings are `[event.details, event.action, event.folder]`, so `event.details` lands in `message_subject`. This is functional (the data is persisted) but semantically misleading when querying the `activity` table — `message_subject` for sentinel rows will contain JSON blobs like `{"oldPath":"...","newPath":"..."}`. If the activity log UI or any reporting query filters or displays `message_subject`, sentinel rows will appear corrupt.

**Fix:** Add a dedicated `details` column to the activity table (behind a migration guard like the existing `source` column migration), or repurpose an appropriate existing nullable column such as `error` for the details payload, with a comment explaining the reuse.

---

_Reviewed: 2026-04-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
