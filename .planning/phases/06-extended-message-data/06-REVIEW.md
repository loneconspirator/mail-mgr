---
phase: 06-extended-message-data
reviewed: 2026-04-11T14:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/config/schema.ts
  - src/imap/client.ts
  - src/imap/discovery.ts
  - src/imap/index.ts
  - src/imap/messages.ts
  - src/index.ts
  - src/log/index.ts
  - src/log/migrations.ts
  - src/monitor/index.ts
  - test/unit/imap/client.test.ts
  - test/unit/imap/discovery.test.ts
  - test/unit/imap/messages.test.ts
  - test/unit/log/migrations.test.ts
  - test/unit/monitor/monitor.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-04-11T14:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 06 adds envelope recipient header discovery, visibility classification, header parsing, and extended message data throughout the IMAP pipeline. The implementation is clean with solid separation of concerns, defensive null/undefined handling, and thorough test coverage across all new functions. The new `parseHeaderLines`, `classifyVisibility`, `probeEnvelopeHeaders`, and migration framework are well-designed. No critical security issues found.

Three warnings relate to: (1) direct mutation of shared config state bypassing the repository notification system, (2) discovery fetching all INBOX messages into memory before slicing, and (3) Monitor event listener accumulation on repeated `start()` calls. Three informational items flag minor improvements.

## Warnings

### WR-01: Direct mutation of ConfigRepository internal state bypasses change notifications

**File:** `src/index.ts:115` and `src/index.ts:167-169`
**Issue:** `configRepo.getConfig()` returns the raw internal config reference. Lines 115 and 168 directly mutate `cfg.imap.envelopeHeader` and `config.imap.envelopeHeader` respectively, then call `saveConfig()`. This bypasses the repository's change notification system (`onImapConfigChange`, `onRulesChange`, etc.), meaning any listeners registered for IMAP config changes will not fire when the envelope header is discovered or updated. If a future listener depends on being notified of `envelopeHeader` changes, it will silently miss them. Additionally, if `saveConfig` throws between mutation and save, the in-memory config becomes inconsistent with the persisted state.
**Fix:** Either use a dedicated repository method that handles both persistence and notification, or create a copy before mutating:
```typescript
// Option A: Add a method to ConfigRepository
configRepo.updateEnvelopeHeader(discoveredHeader ?? undefined);

// Option B: Immutable update
const updatedImap = { ...config.imap, envelopeHeader: initialHeader ?? undefined };
const updatedConfig = { ...config, imap: updatedImap };
saveConfig(configPath, updatedConfig);
```

### WR-02: Discovery fetches all INBOX messages into memory before slicing to last 10

**File:** `src/imap/discovery.ts:25-32`
**Issue:** `probeEnvelopeHeaders` fetches range `'1:*'` (all messages), collects them all into an array, then slices the last 10 via `msgs.slice(-10)`. For a mailbox with tens of thousands of messages, this allocates an array entry for every message before discarding all but 10. While the query only requests headers (lightweight per-message), iterating thousands of async results and buffering them is a reliability risk: for very large mailboxes, this could cause excessive memory usage and slow startup. This conflicts with the project constraint "must handle applying rules to folders with thousands of messages."
**Fix:** Use a bounded fetch range by querying mailbox status first:
```typescript
// Fetch only the last N messages by sequence number
const status = await flow.status('INBOX', { messages: true });
const total = status.messages ?? 0;
const start = Math.max(1, total - 9);
for await (const msg of flow.fetch(`${start}:*`, { ... })) {
  msgs.push(msg as { headers?: Buffer });
}
```

### WR-03: Monitor event listeners accumulate on repeated start() calls

**File:** `src/monitor/index.ts:78-91`
**Issue:** `Monitor.start()` registers event listeners on `this.client` for `newMail`, `connected`, and `error` without checking whether listeners are already attached. If `start()` is called multiple times without an intervening `stop()`, duplicate listeners accumulate, causing duplicate message processing on each `newMail` event. While `stop()` calls `removeAllListeners()`, there is no state guard in `start()` itself.
**Fix:** Add a started guard:
```typescript
private started = false;

async start(): Promise<void> {
  if (this.started) return;
  this.started = true;
  // ... register listeners
}
```

## Info

### IN-01: Non-null assertion on flow after lock release

**File:** `src/imap/client.ts:143`
**Issue:** `this.flow!.mailboxOpen('INBOX')` uses a non-null assertion in the `finally` block of `withMailboxSwitch`. While safe in practice due to Node.js single-threaded execution, the assertion masks a theoretical edge case if `cleanupFlow()` were called by an error handler between lock release and mailboxOpen.
**Fix:** Add a null guard:
```typescript
if (this.flow) {
  await this.flow.mailboxOpen('INBOX');
}
```

### IN-02: Header parser silently overwrites duplicate headers (last wins)

**File:** `src/imap/messages.ts:97-99`
**Issue:** `parseHeaderLines` stores headers in a `Map` keyed by lowercase name. If a message contains duplicate headers (e.g., multiple `Delivered-To` lines, which is valid per RFC 2822), only the last value is retained. For envelope recipient discovery, the first `Delivered-To` is typically the most relevant one, but the current "last wins" behavior discards it.
**Fix:** Keep the first value instead of overwriting:
```typescript
if (currentKey) {
  const key = currentKey.toLowerCase();
  if (!headers.has(key)) {
    headers.set(key, currentValue.trim());
  }
}
```

### IN-03: Unused variable in monitor test

**File:** `test/unit/monitor/monitor.test.ts:332`
**Issue:** `origLogActivity` is assigned via `activityLog.logActivity.bind(activityLog)` but never referenced. `vi.restoreAllMocks()` on line 346 handles restoration.
**Fix:** Remove the unused binding:
```typescript
// Remove this line:
// const origLogActivity = activityLog.logActivity.bind(activityLog);
vi.spyOn(activityLog, 'logActivity').mockImplementationOnce(() => {
  throw new Error('simulated DB failure');
});
```

---

_Reviewed: 2026-04-11T14:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
