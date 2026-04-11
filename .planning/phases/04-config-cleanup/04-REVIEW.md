---
phase: 04-config-cleanup
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/batch/index.ts
  - src/config/schema.ts
  - src/index.ts
  - src/monitor/index.ts
  - src/web/frontend/app.ts
  - src/web/frontend/rule-display.ts
  - src/web/frontend/styles.css
  - src/web/routes/review-config.ts
  - test/unit/config/config.test.ts
  - test/unit/monitor/monitor.test.ts
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-04-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

These files span the batch engine, config schema, entry point, monitor, frontend SPA, review config route, and test suite. The phase introduced optional rule names, sweep settings UI, cursor toggle, and stale sweeper fixes.

The code is generally well-structured and follows project conventions. No security vulnerabilities or data loss risks were found. Five warnings cover logic issues or unhandled edge cases that could cause silent failures or confusing behavior in production. Four info items flag minor quality issues.

---

## Warnings

### WR-01: `buildResult()` called with `completedAt` still null when execute() throws early

**File:** `src/batch/index.ts:302-309`

`buildResult()` at line 395 does a non-null assertion on `this.state.completedAt!`. Inside `execute()`, `completedAt` is only set in the `finally` block at line 309. However, `buildResult()` is also called inside the `catch` block at line 302, which runs *before* the `finally`. At the time `buildResult()` is called from `catch`, `completedAt` is still `null` (reset to `makeIdleState()` at line 168). The `!` assertion masks a guaranteed `null` here — the returned `BatchResult` will have `completedAt: null` coerced to a `null` string, violating the `BatchResult` type contract.

**Fix:** Move `buildResult()` call to after the `finally`, or set `completedAt` at the top of the `catch` block:
```typescript
} catch (err) {
  this.state.status = 'error';
  this.state.completedAt = new Date().toISOString(); // set before buildResult()
  this.logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Batch execute failed');
  return this.buildResult();
} finally {
  this.running = false;
  this.state.completedAt = this.state.completedAt ?? new Date().toISOString(); // guard for non-error path
}
```

---

### WR-02: IMAP config change handler does not restart `batchEngine` with the new `imapClient`

**File:** `src/index.ts:86-115`

When the IMAP config changes, `onImapConfigChange` creates `newClient` and rebuilds `monitor`, `sweeper`, and `batchEngine`. The new `batchEngine` is correctly wired to `newClient`. However, the `sweeper` was given `newClient` but the `batchEngine` dependency block at line 105 uses `newClient` correctly — this is fine for `batchEngine`.

The real issue is that the **`onReviewConfigChange` handler** (lines 68-83) rebuilds a new `ReviewSweeper` and calls `sweeper.start()`, but **never updates `batchEngine`** with the new `reviewConfig` or `trashFolder`. After a review config change, `batchEngine` will continue operating with stale `reviewConfig` and potentially the wrong `trashFolder`.

**Fix:** Call `batchEngine` update inside `onReviewConfigChange`:
```typescript
configRepo.onReviewConfigChange(async () => {
  const updatedConfig = configRepo.getConfig();
  // ... existing sweeper rebuild ...
  batchEngine = new BatchEngine({
    client: imapClient,
    activityLog,
    rules: updatedConfig.rules,
    trashFolder: reviewTrash,
    reviewFolder: updatedConfig.review.folder,
    reviewConfig: updatedConfig.review,
    logger,
  });
  sweeper.start();
});
```

---

### WR-03: `review-config.ts` PUT handler uses `as any` to bypass validation, swallows structured Zod errors

**File:** `src/web/routes/review-config.ts:12`

`body as any` is passed directly to `updateReviewConfig`. The `catch` block extracts `err.message` from whatever error is thrown, but Zod validation errors do not have a single `.message` that's user-readable — the first error message may be generic (e.g., `"Expected string, received number"`). The `as any` cast also violates the project's no-`any` convention and prevents TypeScript from catching shape mismatches.

Additionally there is no validation that the request body is actually an object before passing it to `updateReviewConfig` — a non-object body (e.g. `null`, a number) would produce a confusing error message.

**Fix:**
```typescript
app.put('/api/config/review', async (request, reply) => {
  const body = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return reply.status(400).send({ error: 'Invalid request body' });
  }
  try {
    const updated = await deps.configRepo.updateReviewConfig(body as Record<string, unknown>);
    return updated;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return reply.status(400).send({ error: 'Validation failed', details: [message] });
  }
});
```

---

### WR-04: `renderSettings` in `app.ts` injects user-controlled IMAP config values into `innerHTML` without escaping

**File:** `src/web/frontend/app.ts:356-368`

The settings card HTML at line 356 is built with `card.innerHTML = \`...\`` and interpolates `imapCfg.host`, `imapCfg.port`, `imapCfg.auth.user`, and `imapCfg.auth.pass` directly into attribute `value="..."` strings (lines 359-365). These values come from the backend API. If the stored config contains a double-quote or `>` character (e.g., a username containing `"`), the injected HTML can break attribute boundaries.

This is an application-internal single-user app, so the practical risk is low — the attacker would need to have already written a malicious value to the config. But it is still a correctness issue: a hostname or username containing `"` will produce malformed HTML and broken inputs.

**Fix:** Use the DOM builder `h()` / `document.createElement` + `.value =` assignment pattern already used elsewhere in the file, rather than `innerHTML` for inputs that display user-supplied data:
```typescript
const hostInput = document.createElement('input');
hostInput.id = 's-host';
hostInput.value = imapCfg.host; // safe — sets property, not innerHTML
```
Or at minimum HTML-encode the interpolated values before injection.

---

### WR-05: `renderBatchPreview` no-match group filter logic misidentifies groups

**File:** `src/web/frontend/app.ts:600-601`

The filter at line 600:
```typescript
const matchGroups = groups.filter(g => g.action !== 'skip' || g.destination !== '');
const noMatchGroup = groups.find(g => g.action === 'skip' && g.destination === '');
```

The no-match group from `BatchEngine.dryRun()` is keyed as `key = 'no-match'` with `action = 'no-match'` and `destination = 'No match'` (lines 121-124 of `src/batch/index.ts`). The frontend filter looks for `action === 'skip' && destination === ''`, which will never match the actual no-match group produced by the engine. The "no-match" group will therefore always appear in `matchGroups`, not as a `noMatchGroup`, so it will never receive the `no-match` CSS class and will always appear in the main group list rather than last.

**Fix:** Align the sentinel values. Either change `BatchEngine.dryRun()` to use `action: 'skip'` and `destination: ''` for no-match, or change the frontend filter to match the actual sentinel:
```typescript
const noMatchGroup = groups.find(g => g.action === 'no-match');
const matchGroups = groups.filter(g => g.action !== 'no-match');
```

---

## Info

### IN-01: `origLogActivity` assigned but never used in test

**File:** `test/unit/monitor/monitor.test.ts:330`

```typescript
const origLogActivity = activityLog.logActivity.bind(activityLog);
```
This variable is assigned but never read. It appears to be leftover from an earlier draft of the test that intended to restore the mock manually instead of using `vi.restoreAllMocks()`.

**Fix:** Remove the unused assignment.

---

### IN-02: `h()` helper uses `(el as any)[k] = v` for attribute assignment

**File:** `src/web/frontend/app.ts:17`

The `h()` DOM helper casts the element to `any` to set property values, bypassing TypeScript's DOM typing. This means typos in property names (e.g., `classname` instead of `className`) will silently produce no-ops at runtime. The project convention is no `any`.

**Fix:** Use a typed property setter or narrow the assignment:
```typescript
(el as HTMLElement & Record<string, string>)[k] = v;
```
Or use `el.setAttribute(k, v)` for all non-`data-*` keys, which is safe and type-clean for string HTML attributes.

---

### IN-03: Sweep settings card uses `<dt>`/`<dd>` elements inside a `<p>` tag

**File:** `src/web/frontend/app.ts:416`

```html
<p class="sweep-info"><dt>Next sweep:</dt><dd>${nextSweep}</dd></p>
```
`<dt>` and `<dd>` are definition list elements and are not valid children of `<p>`. Browsers will close the `<p>` implicitly when they encounter block-level elements, which may cause layout issues depending on browser behavior.

**Fix:** Use a `<dl>` wrapper (as is done correctly for `lastSweepHtml` at line 402) or a `<div>` / `<span>` pair:
```html
<p class="sweep-info">Next sweep: <strong>${nextSweep}</strong></p>
```

---

### IN-04: Magic sentinel string `'Skip'` used as destination in `BatchEngine`

**File:** `src/batch/index.ts:250` and `src/batch/index.ts:362`

The string `'Skip'` is used as a magic destination value to signal that a message should not be moved (lines 250, 344, 362). This sentinel is tested with `=== 'Skip'` at line 250, but is not defined as a named constant, making it fragile if the value ever needs to change. The parallel `'Unknown'` sentinel at lines 354/368 has the same issue.

**Fix:** Define module-level constants:
```typescript
const DEST_SKIP = 'Skip';
const DEST_UNKNOWN = 'Unknown';
```

---

_Reviewed: 2026-04-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
