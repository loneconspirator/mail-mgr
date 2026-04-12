---
phase: 06-extended-message-data
reviewed: 2026-04-11T12:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/config/schema.ts
  - src/imap/client.ts
  - src/imap/discovery.ts
  - src/imap/index.ts
  - src/imap/messages.ts
  - src/index.ts
  - src/log/index.ts
  - src/log/migrations.ts
  - test/unit/imap/client.test.ts
  - test/unit/imap/discovery.test.ts
  - test/unit/imap/messages.test.ts
  - test/unit/log/migrations.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-04-11T12:00:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

The phase 06 changes introduce envelope recipient discovery, header parsing, and visibility classification across the IMAP layer, with supporting schema changes, database migrations, and orchestration in the main entry point. Code quality is generally high with thorough test coverage. No critical security issues found. Two warnings relate to direct mutation of shared config state and a potential race in the discovery fetch approach. Two informational items flag minor improvements.

## Warnings

### WR-01: Direct mutation of ConfigRepository internal state

**File:** `src/index.ts:115` and `src/index.ts:168`
**Issue:** `configRepo.getConfig()` returns the raw internal config reference (not a copy). Lines 115 and 168 directly mutate `cfg.imap.envelopeHeader` and `config.imap.envelopeHeader` respectively, then call `saveConfig()`. This bypasses the repository's change notification system (`onImapConfigChange`, `onRulesChange`, etc.), meaning any listeners registered for IMAP config changes will not fire when the envelope header is discovered or updated. If a future listener depends on being notified of `envelopeHeader` changes, it will silently miss them.
**Fix:** Either (a) use a dedicated repository method like `updateImapConfig(patch)` that handles both persistence and notification, or (b) at minimum, reload after save so the repository's internal state is consistent:
```typescript
// Option A: Add a method to ConfigRepository
configRepo.updateEnvelopeHeader(discoveredHeader ?? undefined);

// Option B: Reload after save (less ideal but safer than current)
saveConfig(configPath, cfg);
configRepo.reload(); // if such a method exists
```

### WR-02: Discovery fetches all INBOX messages into memory before slicing

**File:** `src/imap/discovery.ts:25-32`
**Issue:** `probeEnvelopeHeaders` fetches range `'1:*'` (all messages), collects them all into an array, then slices the last 10 via `msgs.slice(-10)`. For a mailbox with tens of thousands of messages, this allocates an array entry for every message in the INBOX before discarding all but 10. While this is partly a performance concern, it is also a correctness risk: for very large mailboxes, this could cause the Node.js process to run out of heap memory and crash, which is a reliability/availability issue rather than pure performance.
**Fix:** Use a reverse UID range or IMAP SORT/SEARCH to fetch only the most recent messages. If the IMAP server supports it, fetch a high UID range instead:
```typescript
// Fetch only the last N messages by sequence number
const status = await flow.status('INBOX', { messages: true });
const total = status.messages ?? 0;
const start = Math.max(1, total - 9);
for await (const msg of flow.fetch(`${start}:*`, { ... })) {
  msgs.push(msg as { headers?: Buffer });
}
```

## Info

### IN-01: Non-null assertion on flow after lock release

**File:** `src/imap/client.ts:143`
**Issue:** `this.flow!.mailboxOpen('INBOX')` uses a non-null assertion in the `finally` block of `withMailboxSwitch`. While safe in practice due to Node.js single-threaded execution (the flow cannot be nulled between the lock release and mailboxOpen call within the same microtask), the assertion masks a theoretical edge case if `cleanupFlow()` were called by an error handler between these operations.
**Fix:** Add a null guard for defensive clarity:
```typescript
if (this.flow) {
  await this.flow.mailboxOpen('INBOX');
}
```

### IN-02: Header parser silently overwrites duplicate headers

**File:** `src/imap/messages.ts:98`
**Issue:** `parseHeaderLines` stores headers in a `Map` keyed by lowercase name. If a message contains duplicate headers (e.g., multiple `Delivered-To` lines, which is valid per RFC 2822), only the last value is retained. For the current use case (envelope recipient discovery), this is likely acceptable since the first `Delivered-To` is typically the relevant one. However, the "last wins" behavior means the first (most relevant) value is discarded.
**Fix:** If duplicate handling matters, keep the first value instead of overwriting:
```typescript
if (currentKey && !headers.has(currentKey.toLowerCase())) {
  headers.set(currentKey.toLowerCase(), currentValue.trim());
}
```

---

_Reviewed: 2026-04-11T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
