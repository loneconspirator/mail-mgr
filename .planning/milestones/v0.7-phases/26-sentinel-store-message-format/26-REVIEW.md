---
phase: 26-sentinel-store-message-format
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/log/migrations.ts
  - src/sentinel/format.ts
  - src/sentinel/index.ts
  - src/sentinel/store.ts
  - test/unit/sentinel/format.test.ts
  - test/unit/sentinel/store.test.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-04-21
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Six files covering the Sentinel message format, store, migrations, and their tests. The
overall shape is solid — the INBOX guard, the header injection guard, and the migration
idempotency are all handled correctly. Three issues are worth fixing before shipping:
`INSERT OR REPLACE` silently resets `created_at` on every upsert, the `folderPurpose`
type is widened to `string` across the store boundary (erasing the `FolderPurpose` union),
and the RFC 2822 Date header relies on `toUTCString()` whose output format is
implementation-defined. Two lower-priority notes round out the report.

---

## Warnings

### WR-01: `INSERT OR REPLACE` silently resets `created_at` on upsert

**File:** `src/sentinel/store.ts:25-27`

**Issue:** `INSERT OR REPLACE` works by deleting the existing row and inserting a new one.
Because `created_at` is populated by `DEFAULT (datetime('now'))` and is not supplied in
the INSERT column list, every upsert call resets `created_at` to the current time even
when only `folder_path` or `folder_purpose` is being updated. This is silent data loss —
the original sentinel creation timestamp is permanently destroyed on the first update.

The companion test (`store.test.ts:59-66`) verifies that `folderPath` and `folderPurpose`
are updated but never asserts that `createdAt` is preserved, so the bug goes undetected.

**Fix:** Use an explicit `INSERT … ON CONFLICT(message_id) DO UPDATE` statement that only
touches the mutable columns:

```sql
INSERT INTO sentinels (message_id, folder_path, folder_purpose)
VALUES (?, ?, ?)
ON CONFLICT(message_id) DO UPDATE SET
  folder_path = excluded.folder_path,
  folder_purpose = excluded.folder_purpose
```

In TypeScript:

```ts
upsert(messageId: string, folderPath: string, folderPurpose: string): void {
  this.db.prepare(`
    INSERT INTO sentinels (message_id, folder_path, folder_purpose)
    VALUES (?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      folder_path = excluded.folder_path,
      folder_purpose = excluded.folder_purpose
  `).run(messageId, folderPath, folderPurpose);
}
```

Add an assertion to the existing upsert test confirming `createdAt` is unchanged after
the second `upsert` call.

---

### WR-02: `folderPurpose` is typed as `string` across the store boundary — `FolderPurpose` union is unused

**File:** `src/sentinel/store.ts:10,14,24`

**Issue:** `Sentinel.folderPurpose` and `SentinelRow.folder_purpose` are both typed as
`string`. The `upsert` parameter is also `string`. The codebase already has the
`FolderPurpose` union type (`'rule-target' | 'action-folder' | 'review' | 'sweep-target'`)
exported from `format.ts`, but the store never imports or uses it. This means an invalid
purpose like `'archive'` (used throughout `store.test.ts` — e.g. lines 50, 61, 69) can
be persisted without any compile-time or runtime error, and will silently round-trip as an
opaque string. Note that `'archive'` is not a valid `FolderPurpose` value.

**Fix:** Import `FolderPurpose` and use it in the store interface and method signature:

```ts
import type { FolderPurpose } from './format.js';

export interface Sentinel {
  messageId: string;
  folderPath: string;
  folderPurpose: FolderPurpose;
  createdAt: string;
}

// upsert signature
upsert(messageId: string, folderPath: string, folderPurpose: FolderPurpose): void
```

Update `store.test.ts` to use valid `FolderPurpose` values (`'rule-target'`, `'review'`,
`'action-folder'`, `'sweep-target'`) instead of `'archive'` and `'action'`.

---

### WR-03: `Date` header uses `toUTCString()` — output format is implementation-defined

**File:** `src/sentinel/format.ts:39`

**Issue:** `new Date().toUTCString()` is specified by the ECMAScript spec to return a
"human-readable" string, but the exact format is left to the implementation. In practice
Node.js/V8 returns `"Mon, 21 Apr 2026 12:00:00 GMT"` which is RFC 2822-compatible, but
this is not guaranteed across JS engines or future runtime versions. An IMAP server that
strictly parses RFC 2822 dates could reject a message whose `Date:` header doesn't conform.

**Fix:** Produce a fixed RFC 2822 date string directly:

```ts
function toRfc2822(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}
// usage
const date = toRfc2822(new Date());
```

---

## Info

### IN-01: `bodyText` parameter has no header injection guard — inconsistent with `folderPath` guard

**File:** `src/sentinel/format.ts:40`

**Issue:** The function guards `folderPath` against `\r` and `\n` (line 33-35) because it
is interpolated into a header. `bodyText` is interpolated into the message body (not a
header), so injection into headers is not possible from that path. However, if a caller
passes a `bodyText` containing `\r\n\r\n`, it could produce unexpected additional "header"
blocks that an IMAP server might misparse as a multipart boundary. The risk is low since
this is an internal API, but the inconsistency is worth documenting or guarding if
`bodyText` is ever exposed to external input.

**Fix:** Either document that `bodyText` is internal-only and not sanitized, or add a
check mirroring the `folderPath` guard if the API surface widens.

---

### IN-02: Test file uses `'archive'` and `'action'` as `folderPurpose` values which are not valid `FolderPurpose` members

**File:** `test/unit/sentinel/store.test.ts:50,55,61,65,69,88,89,100`

**Issue:** The store tests consistently use `'archive'`, `'review'`, and `'action'` as
`folderPurpose` values. `'archive'` and `'action'` do not exist in the `FolderPurpose`
union. While this doesn't break the tests today (because the store types `folderPurpose`
as `string`), it means the tests are exercising paths with data that would be rejected if
WR-02 is addressed. This is an inconsistency that will need to be resolved together with
WR-02.

**Fix:** Replace `'archive'` with `'rule-target'` and `'action'` with `'action-folder'`
throughout the test file. This requires no other test logic changes.

---

_Reviewed: 2026-04-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
