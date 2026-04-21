---
phase: 25-action-folder-config-api-frontend-fix
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/shared/types.ts
  - src/web/frontend/api.ts
  - src/web/frontend/app.ts
  - src/web/routes/action-folder-config.ts
  - src/web/server.ts
  - test/unit/web/action-folder-config.test.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 25: Code Review Report

**Reviewed:** 2026-04-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

This phase introduces the `GET /api/config/action-folders` and `PUT /api/config/action-folders` API endpoints, wires them into the server, and hooks up frontend consumption in `app.ts` (specifically inside `renderFolderRenameCard` for action-folder protection logic). The shared types file re-exports `ActionFolderConfig` from the config schema. A unit test suite covers the new route.

The implementation is mostly clean and well-structured. One critical issue stands out: the PUT route handler passes the raw, unvalidated request body directly to `updateActionFolderConfig` without any content-type or body-parsing guard, allowing arbitrary non-object payloads to reach the Zod validation layer in unexpected ways. There are also a few warning-level gaps: a race condition in the frontend's action-folder prefix fetch, a missing `await` that silently swallows the result of `renderFolderPicker` in a fallback path, and a bare `catch` that hides validation error detail from the response. Several info-level items round out the review.

---

## Critical Issues

### CR-01: PUT route casts unvalidated body with `as any`, bypassing type safety entirely

**File:** `src/web/routes/action-folder-config.ts:10-12`
**Issue:** The handler reads `request.body as Record<string, unknown>` and immediately re-casts it `as any` before passing it to `updateActionFolderConfig`. Fastify does not parse JSON bodies by default unless `Content-Type: application/json` is present AND a body parser is registered. Without an explicit Fastify JSON body parser or schema, `request.body` is `null` when no `Content-Type` header is sent (e.g., a plain `curl -X PUT`). Passing `null as any` into `{ ...this.config.actionFolders, ...null }` produces the existing config unchanged with no error, making a destructive mis-send silently a no-op. The double-cast (`as Record<string, unknown>` then `as any`) also entirely surrenders TypeScript's protection at the boundary and prevents Fastify from schema-validating the input.

```ts
// Current — unsafe
const body = request.body as Record<string, unknown>;
try {
  const updated = await deps.configRepo.updateActionFolderConfig(body as any);
```

**Fix:** Add a null/object guard before the repository call so a missing or non-object body produces a clear 400 rather than a silent no-op:

```ts
app.put('/api/config/action-folders', async (request, reply) => {
  const body = request.body;
  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
    return reply.status(400).send({ error: 'Request body must be a JSON object' });
  }
  try {
    const updated = await deps.configRepo.updateActionFolderConfig(body as Partial<ActionFolderConfig>);
    return updated;
  } catch (err: any) {
    return reply.status(400).send({ error: 'Validation failed', details: [err.message] });
  }
});
```

---

## Warnings

### WR-01: Race condition — action-folder prefix fetch result may arrive after folder selection

**File:** `src/web/frontend/app.ts:1646-1648`
**Issue:** `getActionFolders()` is fired as a floating Promise (`.then(...).catch(...)`) — it is not awaited before `renderFolderPicker` is called on line 1651. If a user selects a folder in the picker before the async fetch completes, `actionFolderPrefix` is still `'Actions'` (the default) when `handleFolderSelection` runs. This means a non-default action-folder prefix won't protect system folders from rename attempts during that window.

```ts
// Line 1646 — floated, result may arrive too late
let actionFolderPrefix = 'Actions';
api.config.getActionFolders().then(cfg => {
  actionFolderPrefix = cfg.prefix;
}).catch(() => { /* keep default */ });

// Line 1651 — picker renders immediately, before fetch resolves
await renderFolderPicker({ ... });
```

**Fix:** Await both fetches before rendering the picker, with a fallback default:

```ts
let actionFolderPrefix = 'Actions';
try {
  const afCfg = await api.config.getActionFolders();
  actionFolderPrefix = afCfg.prefix;
} catch { /* keep default */ }

await renderFolderPicker({ ... });
```

### WR-02: `details` field in 400 response may expose internal Zod error paths

**File:** `src/web/routes/action-folder-config.ts:14-16`
**Issue:** The catch block includes `details: [err.message]` in the 400 response. `err.message` from `updateActionFolderConfig` is constructed as `"Validation failed: fieldPath: message, ..."` — the full Zod path and message string. This leaks internal config field names and schema structure to any caller. The test at line 137 only asserts `body.error === 'Validation failed'` and does not validate whether `details` is safe to expose. For a self-hosted personal tool this is low-risk, but the `details` array contains dot-path field names from the config schema that could guide an attacker enumerating config structure in a multi-user deployment.

**Fix:** Either omit `details` entirely or strip paths before responding:

```ts
return reply.status(400).send({ error: 'Validation failed' });
```

### WR-03: Missing `await` on re-render `renderFolderPicker` inside rename error handler

**File:** `src/web/frontend/app.ts:1788-1792`
**Issue:** Inside the rename error handler, `renderFolderPicker` is called with `await`, but the returned Promise is not stored or handled if the function rejects. However more specifically: the `finally` block at line 1793 runs `renameBtn.removeAttribute('disabled')` synchronously — it does not wait for `renderFolderPicker` to complete. If `renderFolderPicker` is asynchronous (it is, given the `await` on line 1651 for the success path), the input may be re-enabled before the picker has finished re-rendering, creating a brief state where the user can interact with stale UI.

```ts
// Line 1787-1797 — finally does not wait for picker re-render
await renderFolderPicker({ ... });   // async
} finally {
  renameBtn.removeAttribute('disabled');  // runs immediately, not after picker
  input.removeAttribute('disabled');
  renameBtn.textContent = 'Rename Folder';
}
```

**Fix:** Move the `finally` cleanup to run after the `renderFolderPicker` call, or handle the picker re-render outside the try/catch/finally so the button state is restored only after the picker is ready:

```ts
try {
  await api.folders.rename(selectedPath, newPath);
  // ... success path
} catch (err) {
  // ... error handling
  await renderFolderPicker({ ... });
} finally {
  renameBtn.removeAttribute('disabled');
  input.removeAttribute('disabled');
  renameBtn.textContent = 'Rename Folder';
}
```

_(The current code already does this structurally — the issue is that `finally` fires before the `await renderFolderPicker` inside catch resolves, because `finally` runs synchronously after the `await` expression is started but the `await` doesn't propagate to `finally`. Wrapping the catch body's picker call in `await` within an `async` IIFE or restructuring the try/catch to not use `finally` for UI cleanup would fix this.)_

---

## Info

### IN-01: `body as any` double-cast pattern is a recurring anti-pattern in route handlers

**File:** `src/web/routes/action-folder-config.ts:10-12`
**Issue:** Beyond the critical safety concern, the `as Record<string, unknown>` followed immediately by `as any` is a code smell — the first cast is pointless if the second discards it. This pattern has appeared in other route handlers in this codebase and should be standardized.

**Fix:** Use a single typed cast after a guard check (see CR-01 fix above).

### IN-02: Test suite does not cover `Content-Type` missing body edge case

**File:** `test/unit/web/action-folder-config.test.ts:93-149`
**Issue:** All PUT test cases pass a `payload` object, which Fastify's `inject` helper automatically serializes with `Content-Type: application/json`. There is no test for a PUT with no body or a non-JSON body, so the silent no-op described in CR-01 is not caught by the test suite.

**Fix:** Add a test case:

```ts
it('returns 400 when no body is provided', async () => {
  const app = buildServer(makeDeps(makeConfig()));
  const res = await app.inject({ method: 'PUT', url: '/api/config/action-folders' });
  expect(res.statusCode).toBe(400);
});
```

### IN-03: `api.config.updateActionFolders` is defined in `api.ts` but not called anywhere in the reviewed frontend code

**File:** `src/web/frontend/api.ts:75-78`
**Issue:** `updateActionFolders` is exported but `app.ts` only calls `getActionFolders`. If the settings UI for action folder configuration is not yet built, this is expected. If it was supposed to be part of this phase, it may be an incomplete implementation. Dead API wrapper code is low risk but worth flagging.

**Fix:** Either wire up the settings UI for action folder configuration or add a comment noting that this will be used in a future phase.

---

_Reviewed: 2026-04-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
