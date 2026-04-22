---
phase: 17-configuration-folder-lifecycle
reviewed: 2026-04-20T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - config/default.yml
  - src/action-folders/folders.ts
  - src/action-folders/index.ts
  - src/config/index.ts
  - src/config/repository.ts
  - src/config/schema.ts
  - src/imap/client.ts
  - src/index.ts
  - test/unit/action-folders/folders.test.ts
  - test/unit/config/action-folders.test.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-04-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the action folder configuration lifecycle implementation: schema definition, config repository CRUD, folder provisioning logic, IMAP client surface, and startup/reconnect wiring in `src/index.ts`.

The schema and repository work is solid — Zod defaults are correctly layered, validation is applied before mutation, and listeners are notified asynchronously. The `ensureActionFolders` function is clean and well-tested.

Three correctness issues were found, one of which is a real runtime bug (orphaned monitor on startup), one a portability defect (hardcoded IMAP path separator), and one a silent type gap in the IMAP client.

---

## Warnings

### WR-01: Orphaned monitor instance when envelope header differs on startup

**File:** `src/index.ts:229-243`

**Issue:** On initial startup, `monitor.start()` is called at line 247 (via the flow below it). But before that, between lines 229 and 243, if the discovered envelope header differs from what was stored in config, a **new** `Monitor` instance is created at line 242 and assigned to `monitor` — without calling `monitor.stop()` on the old instance first. The old monitor was already created at line 53 but `start()` hasn't been called yet at that point, so in the current code order no actual leak occurs at the initial-start path. However, if this ordering ever shifts (e.g., `monitor.start()` moves above the header-probe block), or if the old monitor object holds open resources on construction, this silently orphans the first instance.

More concretely: after line 242, the old `Monitor` instance (line 53) is dropped without cleanup. Any constructor-time resource acquisition in `Monitor` would leak. The pattern is fragile and inconsistent with the IMAP reconnect handler (line 128-129) which explicitly stops before rebuilding.

**Fix:**
```typescript
// Before reassigning monitor, stop the existing one
await monitor.stop();
monitor = new Monitor(config, { imapClient, activityLog, logger });
```

Add this explicit stop even if `monitor.start()` hasn't been called yet — defensive cleanup is cheaper than debugging a leaked timer or listener.

---

### WR-02: Hardcoded `/` separator in `folderExists` path construction

**File:** `src/action-folders/folders.ts:39`

**Issue:** The path passed to `client.status()` is constructed as:
```typescript
const fullPath = `${config.prefix}/${entry.name}`;
```
IMAP folder path separators are server-specific (Gmail uses `/`, some servers use `.`). `createMailbox` correctly uses the array form at line 46, letting imapflow resolve the delimiter. But `status()` receives a pre-joined string with a hardcoded `/`. On servers using a different delimiter, `status()` will fail (folder not found) for every check, causing `ensureActionFolders` to attempt creation every time it runs — even when folders already exist.

**Fix:** Either expose the delimiter from the IMAP tree data and thread it through, or derive the full path the same way imapflow would join the array form. A pragmatic short-term fix is to call `status()` with the array form if the client interface supports it, or accept the `/` limitation and document it. At minimum, use the same path that imapflow would produce:

```typescript
// Option A: match imapflow's default delimiter assumption
// (acceptable if only Gmail/standard servers are targeted)

// Option B: store the resolved path from mailboxCreate and use it
// for future status checks (requires API surface change)

// Option C: derive path from array join using known delimiter
// (requires threading delimiter through ActionFolderConfig)
```

For now, adding a comment acknowledging the hardcoded delimiter assumption would prevent future confusion:
```typescript
// NOTE: uses '/' as path separator — matches Gmail/most providers.
// Servers using '.' as delimiter will fail the status() check and
// trigger repeated (harmless but noisy) creation attempts.
const fullPath = `${config.prefix}/${entry.name}`;
```

---

### WR-03: `status()` return values accessed without null guards

**File:** `src/imap/client.ts:174`

**Issue:** The `ImapFlowLike.status()` interface returns `Promise<Record<string, number>>`. The `ImapClient.status()` wrapper directly reads `result.messages` and `result.unseen` without checking if these keys exist:

```typescript
return { messages: result.messages, unseen: result.unseen };
```

If the IMAP server omits either field from the STATUS response (which is legal per RFC 3501 — STATUS only returns requested items, and some servers may return partial responses on error), both values will be `undefined`, silently typed as `number`. Callers that treat these as counts would get `NaN` in arithmetic.

In the current code, `folderExists` in `folders.ts` discards the return value entirely (only uses try/catch), so there's no immediate crash path. But future callers of `client.status()` who use the returned counts could hit silent `undefined` coercion.

**Fix:**
```typescript
async status(path: string): Promise<{ messages: number; unseen: number }> {
  if (!this.flow) throw new Error('Not connected');
  const result = await this.flow.status(path, { messages: true, unseen: true });
  return {
    messages: result.messages ?? 0,
    unseen: result.unseen ?? 0,
  };
}
```

---

## Info

### IN-01: `pollInterval` in `actionFolderConfigSchema` is defined but never consumed

**File:** `src/config/schema.ts:146` / `src/action-folders/folders.ts` (entire file)

**Issue:** `ActionFolderConfig` includes a `pollInterval` field (default: 15 seconds), and it is validated and persisted correctly. However, no code in the reviewed files actually reads `config.pollInterval` to drive a polling loop — `ensureActionFolders` is called imperatively on startup and config-change events, not on a timer. The field appears to be scaffolding for a future monitoring loop that scans action folders for new messages.

This is not a bug (the field is harmless), but it may confuse maintainers who expect the interval to be wired up, or users who configure it expecting an effect.

**Fix:** Either add a TODO comment to `actionFolderConfigSchema` noting that `pollInterval` is reserved for future use, or implement the polling loop if it was intended for this phase.

---

### IN-02: `updateActionFolderConfig` shallow merge silently drops partial `folders` overrides

**File:** `src/config/repository.ts:134-136`

**Issue:** The merge strategy is:
```typescript
const merged = { ...this.config.actionFolders, ...input };
```

If a caller passes `{ folders: { vip: 'My VIP' } }` (intending to override only the VIP folder name), the spread replaces the entire `folders` object with `{ vip: 'My VIP' }`. Zod fills in the missing defaults (`block`, `undoVip`, `unblock`) because the inner fields all have `.default()` on the schema, so the result is technically correct. But the caller's intent (partial update of `folders`) only works by accident due to Zod defaults — it would silently fail for any custom values the user had previously set on the other folder names.

The same pattern on `updateReviewConfig` (line 111-112) has the same characteristic.

**Fix:** Consider deep-merging the `folders` sub-object explicitly:
```typescript
const merged: Partial<ActionFolderConfig> = {
  ...this.config.actionFolders,
  ...input,
  folders: input.folders
    ? { ...this.config.actionFolders.folders, ...input.folders }
    : this.config.actionFolders.folders,
};
```

---

_Reviewed: 2026-04-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
