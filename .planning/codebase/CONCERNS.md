# Codebase Concerns

**Analysis Date:** 2026-04-06

## Tech Debt

### Frontend Type Safety - HTMLElement Assertions

**Issue:** Unsafe type casting with `!` assertions and loose `any` types used throughout frontend code.

**Files:**
- `src/web/frontend/app.ts` (lines 14, 39, 77, 196, 197, 233, etc.)
- `src/web/routes/activity.ts` (line 25)
- `src/web/routes/imap-config.ts` (line 32)
- `src/web/routes/rules.ts` (lines 12, 23)
- `src/web/routes/review-config.ts` (line 12)

**Details:** Multiple use of `document.getElementById()!` without null checks, and unsafe `as any` casts when handling request bodies. Examples:
- Line 77: `document.getElementById('add-rule-btn')!` - will throw if element missing
- Line 14: `(el as any)[k] = v` - bypasses type checking for attribute assignment
- Line 32 in imap-config: `newImap as any` - unvalidated type cast on POST body

**Impact:** Runtime crashes if DOM changes, potential bugs from unvalidated API payloads slipping through to config repository.

**Fix approach:**
1. Validate DOM element existence with proper null checks or fallbacks
2. Add proper typed validation for API request bodies before casting (use Zod schemas)
3. Replace `any` assertions with properly typed interfaces matching expected API contracts

---

### XSS Vulnerability in Frontend Modal Forms

**Issue:** User input from rule names, senders, subjects, and folder names are directly interpolated into HTML via template literals.

**Files:**
- `src/web/frontend/app.ts` (lines 148-164)

**Details:** Lines 150-152, 159 contain unsanitized user input in `innerHTML`:
```typescript
modal.innerHTML = `
  ...
  <input id="m-name" value="${rule?.name || ''}" />
  <input id="m-sender" value="${rule?.match?.sender || ''}" />
  <input id="m-subject" value="${rule?.match?.subject || ''}" />
  ...
  <input id="m-folder" value="${rule?.action && 'folder' in rule.action ? rule.action.folder || '' : ''}" />
```

An attacker who crafts a rule with `name='"><script>alert("xss")</script>'` could execute arbitrary JavaScript when the modal renders.

**Impact:** High - Arbitrary JavaScript execution in user's browser when viewing/editing rules.

**Fix approach:**
1. Replace innerHTML-based templating with `textContent` + proper DOM element creation (already partially done with `h()` helper in other parts of file)
2. Use the existing `h()` helper function consistently for all dynamic content
3. HTML-encode all user-provided values if falling back to innerHTML

---

### Unvalidated Type Coercion in Activity Route

**Issue:** Activity log source field uses unsafe type assertion to extract optional property.

**Files:**
- `src/web/routes/activity.ts` (line 25)

**Details:** `(r as unknown as { source?: string }).source ?? 'arrival'` - This pattern works but relies on unvalidated cast and assumes the database query object structure. If database schema changes, this fails silently.

**Impact:** Medium - Could miss new activity entries with incorrect source attribution.

**Fix approach:** Properly type the database row response and validate the `source` field during ActivityLog initialization or query.

---

## Known Bugs

### Password Masking May Leak on Refresh

**Issue:** IMAP password configuration endpoint masks password as `****` when returned, but logic assumes any non-masked value is the existing password.

**Files:**
- `src/web/routes/imap-config.ts` (lines 5-8, 25-27)

**Details:** When updating IMAP config:
```typescript
const PASSWORD_MASK = '****';
...
pass: authBody?.pass === PASSWORD_MASK
  ? imap.auth.pass  // keep existing
  : authBody.pass   // use new
```

If a user's actual password happens to be `****`, the update will skip changing it and keep the old password.

**Impact:** Low - Very unlikely scenario, but creates unexpected behavior if someone uses `****` as password.

**Fix approach:** Use a more unique mask like `[EXISTING_PASSWORD]` or send password change as separate endpoint. Alternatively, return `null` instead of mask to indicate "unchanged".

---

### Activity Timer Not Cleared on Tab Visibility

**Issue:** Activity page auto-refresh timer continues even when tab becomes invisible, wasting resources.

**Files:**
- `src/web/frontend/app.ts` (lines 317-320, 447-449)

**Details:** The visibility change handler checks `currentPage === 'activity'` to trigger refresh when tab becomes visible, but the 30-second auto-refresh interval started at line 318 continues regardless of visibility:
```typescript
activityTimer = setInterval(() => {
  if (currentPage === 'activity') renderActivity();
}, 30000);
```

The handler at line 448 only triggers a refresh but doesn't stop/restart the interval.

**Impact:** Low - Battery drain on mobile, unnecessary API calls when user isn't viewing the page.

**Fix approach:** Clear and restart interval in visibility change handler instead of just triggering refresh.

---

## Security Considerations

### IMAP Credentials in Memory Without Explicit Cleanup

**Issue:** IMAP authentication credentials live in memory throughout application lifetime with no explicit secure cleanup.

**Files:**
- `src/imap/client.ts` (constructor, lines 52-56)
- `src/config/repository.ts` (stores config in memory)
- `src/index.ts` (lines 14-22, creates ImapFlow with credentials)

**Details:** The `ImapConfig` object containing `auth.user` and `auth.pass` is stored in multiple places:
1. In ConfigRepository as instance variable
2. In ImapClient's constructor
3. Passed to ImapFlow library (external library, no control over cleanup)

No overwrite or memory cleanup occurs before application exit.

**Impact:** Medium - If process memory is dumped (crash, forensics), credentials remain readable. If process is suspended, credentials accessible.

**Current mitigation:** `.env` file handling via Node's `--env-file` flag keeps secrets outside source.

**Recommendations:**
1. Never log IMAP config (already good - no logging of config observed)
2. Consider encrypting credentials at rest in YAML if stored on disk
3. Document that production deployments should run with locked-down filesystem
4. If credentials change frequently, consider OAuth/token-based auth in future

---

### Unencrypted SQLite Database

**Issue:** Activity log stored in plaintext SQLite database with no encryption.

**Files:**
- `src/log/index.ts` (lines 51-54)

**Details:** `better-sqlite3` database stores all email metadata (sender, subject, from/to addresses) in plaintext at `data/db.sqlite3`. No encryption at rest.

**Impact:** Medium - Email metadata exposure if disk is compromised. User emails indexed/searchable without protection.

**Current mitigation:** File permissions (assumed to be properly set).

**Recommendations:**
1. Document requirement for filesystem encryption (LUKS, FileVault, etc.)
2. Consider SQLCipher integration for application-level encryption (breaking change)
3. Implement automatic pruning of sensitive fields after activity retention period

---

### Configuration File Contains Sensitive Values

**Issue:** `config.yml` stored on disk contains IMAP credentials and folder paths.

**Files:**
- `src/config/loader.ts` (lines 47-59)

**Details:** Configuration YAML file may contain literal password values or environment variable references that expand to passwords. Even with env var substitution, the file path is predictable.

**Impact:** Medium - If deployed improperly (world-readable `/data` directory), credentials exposed.

**Recommendations:**
1. Enforce documentation that `data/` directory must have 700 permissions (user-read-only)
2. Consider supporting systemd secrets or similar for password injection
3. Validate file permissions at startup and warn/error if world-readable

---

## Performance Bottlenecks

### Activity Log Not Indexed

**Issue:** Activity queries scan entire table without indexes on frequently queried columns.

**Files:**
- `src/log/index.ts` (SCHEMA lines 7-26)

**Details:** The activity table has no indexes on:
- `timestamp` (queried in reverse order for recent activity)
- `message_uid` (checked for duplicates)
- `rule_id` (filtered in activity display)

With thousands of entries, `SELECT * ORDER BY timestamp DESC LIMIT X OFFSET Y` will perform full table scans.

**Impact:** Medium - Slow activity page load after 10k+ entries. SQLite can degrade noticeably.

**Fix approach:** Add indexes in next migration:
```sql
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_message_uid ON activity(message_uid);
CREATE INDEX IF NOT EXISTS idx_activity_rule_id ON activity(rule_id);
```

---

### No Connection Pooling / Single IMAP Connection

**Issue:** All operations run through a single ImapFlow connection with synchronization via mailbox locks.

**Files:**
- `src/imap/client.ts` (single `flow` instance)
- `src/sweep/index.ts` (line 195, uses `withMailboxLock`)

**Details:** The monitor and sweeper compete for the same IMAP connection. When sweep locks a mailbox, monitor blocks. If a lock times out or hangs, all operations freeze.

**Impact:** Medium - During sweep operations, monitor can't process new mail. If mailbox lock is slow, both systems pause.

**Current mitigation:** Sweeper checks client state before running (line 167 of sweep/index.ts).

**Fix approach:**
1. Monitor: Use separate IMAP connection for fetching (read-only mode)
2. Sweeper: Dedicated connection for moves
3. Requires IMAP provider support for multiple connections (most support)

---

### Frontend Activity Rendering DOM Inefficiency

**Issue:** Activity table recreation via `innerHTML` instead of incremental updates.

**Files:**
- `src/web/frontend/app.ts` (lines 265-300)

**Details:** Every 30 seconds (and on pagination), the entire activity table is recreated with `innerHTML`. With 25+ rows, this causes re-rendering and re-attachment of event listeners.

**Impact:** Low-Medium - Browser memory growth over time, noticeable lag on low-end devices during refresh. Battery impact on mobile.

**Fix approach:**
1. Implement incremental table updates using DOM APIs instead of innerHTML
2. Reuse table rows, update only changed data
3. Consider virtual scrolling for large result sets

---

## Fragile Areas

### Sweeper State Reconciliation with IMAP

**Issue:** Sweeper maintains in-memory state (total/read/unread counts) that may diverge from actual mailbox.

**Files:**
- `src/sweep/index.ts` (lines 97-114, 177-183)

**Details:** State is updated only during `runSweep()` execution. Between sweeps:
- Another client moves messages into Review folder → counts stale
- User manually deletes from Review in mail client → counts wrong
- Sweep fails partway → lastSweep data misleading

No reconciliation mechanism exists.

**Impact:** Medium - Activity page shows incorrect message counts for Review folder. User confusion about actual folder contents.

**Safe modification:** Always call `fetchAllMessages()` to recalculate before returning state in status endpoint (already done at line 178).

**Test coverage gap:** No tests verify state accuracy after manual mailbox modifications.

---

### Race Condition: Rule Updates During Message Processing

**Issue:** Rules can be updated (via config reload) while Monitor is evaluating rules on a message.

**Files:**
- `src/monitor/index.ts` (line 128)
- `src/index.ts` (line 47-49, rule update callback)

**Details:** When `processNewMessages()` evaluates rules at line 128, a concurrent rule update via `onRulesChange()` callback can modify `this.rules` array between evaluation start and action execution.

Example race:
1. Monitor reads first 10 rules from `this.rules` for evaluation
2. Config updates, callback sets `this.rules = newRules`
3. Monitor executes action for rule at index 5 from old array (now different rule)

**Impact:** Medium - Messages could be processed with wrong rule (old action applied to new rule name).

**Safe modification:** Copy rules array before evaluation: `const rules = [...this.rules];` at line 128.

**Test coverage gap:** No concurrency tests for rule updates during processing.

---

### Timer Cleanup Incomplete on Error

**Issue:** If Monitor/Sweeper encounters error during initialization, timers may not be properly cleaned.

**Files:**
- `src/sweep/index.ts` (lines 125-142)
- `src/monitor/index.ts` (lines 68-83)

**Details:** If `start()` is called but `connect()` fails partway, the initialTimer is set but subsequent cleanup may not be guaranteed in all error paths.

**Impact:** Low - Memory leak of small timer. Timers are cleaned in `stop()`, so next `start()` clears it. Not critical but untidy.

**Fix approach:** Wrap timers in try-finally or use AbortController to ensure cleanup.

---

## Scaling Limits

### SQLite not optimized for concurrent writes

**Issue:** `better-sqlite3` with WAL pragma can handle concurrent reads, but multiple writers contend on write.

**Files:**
- `src/log/index.ts` (line 53, WAL pragma enabled)

**Details:** Activity logging during high message volume could block sweep logging. WAL helps but doesn't solve write contention.

**Current capacity:** Reasonable for < 1000 messages/hour. Would struggle at 10k+ messages/hour.

**Scaling path:**
1. Short term: Batch write activity logs (write buffer, flush every 5 seconds)
2. Long term: Migrate to PostgreSQL or message queue (e.g., Redis) for activity

---

### Single-Threaded IMAP Processing

**Issue:** Monitor processes messages sequentially, one per `processNewMessages()` call. High-volume mailboxes will lag.

**Files:**
- `src/monitor/index.ts` (lines 121-160)

**Details:** Loop processes each message, evaluates rules, executes action, logs. Total time = sum of all message processing times. No parallelism.

**Current capacity:** Reasonable for < 100 new messages per minute. Would slow significantly at 500+/min.

**Scaling path:**
1. Process messages in parallel batches (limit concurrency to avoid IMAP overload)
2. Queue messages internally, process asynchronously
3. Requires careful lock management to avoid race conditions

---

## Dependencies at Risk

### ImapFlow Dependency Stability

**Issue:** `imapflow` is community-maintained library with limited adoption for production use-cases.

**Files:**
- `package.json` (line 23, `imapflow: ^1.2.8`)
- `src/index.ts` (lines 9, 14-21)

**Risk:** Library could be abandoned, security issues unpatched. Version pinned to ^1.x, may miss breaking changes.

**Impact:** Medium - If imapflow has critical security issue or stops working with IMAP servers, need to migrate (likely to node-imap or migrating to NodeMailer IMAP which has similar limitations).

**Migration plan:**
1. Abstract ImapFlowLike interface already exists (good!)
2. Could swap for node-imap with ~500 lines of adapter code
3. Test integration suite exists, validates behavior

---

## Test Coverage Gaps

### No Tests for Concurrent Rule Updates

**Issue:** Rule update during message processing is untested (see Fragile Areas above).

**Files:**
- `test/integration/pipeline.test.ts` — should test this scenario
- `src/monitor/index.ts` — no concurrency tests

**Risk:** Race condition could occur in production without detection.

**Priority:** High - race condition affects correctness.

---

### No Tests for IMAP Connection Failures

**Issue:** Reconnection logic and state transitions not fully tested.

**Files:**
- `src/imap/client.ts` (lines 66-91, 376-389) — reconnection backoff logic
- `test/unit/imap/client.test.ts` — minimal error handling tests

**Risk:** Connection failures could leave client in bad state indefinitely.

**Priority:** High - affects availability.

---

### No Tests for Activity Log Pruning

**Issue:** Automatic pruning of 30-day-old entries not covered.

**Files:**
- `src/log/index.ts` (lines 148-163)
- No dedicated prune tests

**Risk:** Pruning logic could silently fail, database grows unbounded.

**Priority:** Medium - data leak, not functional correctness.

---

### Missing Error Scenarios in Web Routes

**Issue:** Web API routes don't test partial failures, IMAP disconnection during config updates, etc.

**Files:**
- `test/unit/web/api.test.ts`
- `src/web/routes/*.ts`

**Risk:** Error responses not validated, frontend error handling untested.

**Priority:** Medium - poor UX if errors not handled properly.

---

## Missing Critical Features

### No Credential Rotation / Password Change UI

**Issue:** IMAP password can only be updated via direct YAML edit or API, no "change password" flow.

**Files:**
- `src/web/routes/imap-config.ts` (read-only-ish update)

**Blocks:** Users cannot regularly rotate credentials for security best practices.

---

### No Bulk Rule Operations

**Issue:** No UI for bulk enable/disable/delete rules, must edit one-by-one.

**Files:**
- `src/web/frontend/app.ts` (lines 110-121)

**Blocks:** Users cannot quickly enable/disable rule sets for different scenarios (work mode, vacation, etc.).

---

### No Rule Dry-Run / Preview

**Issue:** No way to test if a rule would match messages before applying.

**Files:**
- No test/preview endpoint exists

**Blocks:** Users cannot safely validate new rules without applying to production.

---

---

*Concerns audit: 2026-04-06*
