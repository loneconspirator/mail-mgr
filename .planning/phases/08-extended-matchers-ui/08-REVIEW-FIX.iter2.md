---
phase: 08-extended-matchers-ui
fixed_at: 2026-04-12T12:09:00Z
review_path: .planning/phases/08-extended-matchers-ui/08-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-04-12T12:09:00Z
**Source review:** .planning/phases/08-extended-matchers-ui/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: XSS via Unescaped Rule Data in innerHTML

**Files modified:** `src/web/frontend/app.ts`
**Commit:** cc75b73
**Applied fix:** Added `esc()` HTML-escape helper function and applied it to all user-data interpolations in the rule modal (name, sender, subject, deliveredTo, folder) and settings page (host, port, username, password) innerHTML templates.

### CR-02: Stale Monitor Reference After IMAP Config Hot-Reload

**Files modified:** `src/web/server.ts`, `src/web/routes/status.ts`, `src/index.ts`, `test/unit/web/frontend.test.ts`, `test/unit/web/api.test.ts`
**Commit:** e324235
**Applied fix:** Changed `ServerDeps.monitor` from a direct value to a `getMonitor()` getter function. Updated `src/index.ts` to pass a closure that captures the mutable `monitor` variable, so route handlers always access the current Monitor instance after hot-reload. Updated status route and both test files to use the new getter pattern.

### WR-01: Internal Error Messages Leaked to Client in Discovery Route

**Files modified:** `src/web/routes/envelope.ts`
**Commit:** 3ef0101
**Applied fix:** Replaced `err: any` with `err: unknown`, added proper error normalization with `instanceof Error` check, logs full error server-side via `app.log.error()`, and returns a generic "Discovery failed. Check server logs for details." message to the client.

### WR-02: Discovery Fetches All INBOX Messages Before Slicing to 10

**Files modified:** `src/imap/discovery.ts`, `src/imap/client.ts`, `test/unit/imap/discovery.test.ts`
**Commit:** 95b8337, e9643d3
**Applied fix:** Replaced `fetch('1:*')` with a sequence-range query that first calls `flow.status('INBOX', { messages: true })` to get the message count, then fetches only the last 10 messages by sequence number (`${start}:*`). Added `status()` method to `ImapFlowLike` interface. Updated test mock to include `status` method.

### WR-03: Redundant Empty-Match Validation After Field Population

**Files modified:** `src/web/frontend/app.ts`
**Commit:** 0cd355d
**Applied fix:** Replaced the redundant field-by-field emptiness check (`!sender && !subject && !deliveredTo && !visibility && !readStatus`) with `Object.keys(match).length === 0`, which correctly handles all current and future match fields including `recipient`.

### IN-01: Unsafe Type Cast on match Parameter in renderRules

**Files modified:** `src/web/frontend/rule-display.ts`, `src/web/frontend/app.ts`
**Commit:** 7de7471
**Applied fix:** Changed `generateBehaviorDescription` parameter type from `Record<string, string>` to `EmailMatch` (imported from shared types). Removed the `as Record<string, string>` cast at the call site in `app.ts`.

### IN-02: `any` Type Usage in catch Blocks in Frontend

**Files modified:** `src/web/frontend/app.ts`
**Commit:** 6c07ab7
**Applied fix:** Replaced all 7 `catch (e: any)` blocks with `catch (e: unknown)` and applied the `e instanceof Error ? e.message : String(e)` pattern consistently, matching the existing correct pattern already used in the discovery button handler.

### IN-03: `ImapConfigResponse` Type Does Not Encode Password Masking

**Files modified:** `src/web/frontend/api.ts`, `src/web/frontend/app.ts`
**Commit:** 2d1a64c
**Applied fix:** Changed `getImap` return type and `updateImap` parameter/return type from `ImapConfig` to `ImapConfigResponse` in the API wrapper. Updated the `app.ts` import and settings save handler to use `ImapConfigResponse` instead of `ImapConfig`, correctly reflecting that the frontend works with masked credentials.

---

_Fixed: 2026-04-12T12:09:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
