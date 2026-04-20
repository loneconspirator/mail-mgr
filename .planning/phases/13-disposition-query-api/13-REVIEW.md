---
phase: 13-disposition-query-api
reviewed: 2026-04-20T05:08:13Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/web/routes/dispositions.ts
  - src/web/server.ts
  - test/unit/web/dispositions.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-04-20T05:08:13Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the disposition query API implementation: the route handler in `src/web/routes/dispositions.ts`, its registration in `src/web/server.ts`, and unit tests in `test/unit/web/dispositions.test.ts`.

The core logic is solid. `isSenderOnly` correctly checks all six `EmailMatch` fields (including the `readStatus: 'any'` equivalence). `isValidDispositionType` is tight. The route handles both the unfiltered and `?type=` filtered cases correctly, with a clean 400 for invalid type values. Registration follows the established project pattern. The test suite has good coverage including edge cases (disabled rules, `readStatus: 'any'`, multi-criteria exclusions).

One warning-level issue: the test uses an invalid enum value for `visibility` that TypeScript should reject at compile time. Two info-level items round out the findings.

## Warnings

### WR-01: Invalid enum value in test — TypeScript type error

**File:** `test/unit/web/dispositions.test.ts:121`
**Issue:** The `isSenderOnly` describe block constructs a rule with `visibility: 'personal'`, but the schema defines `VisibilityMatch` as `z.enum(['direct', 'cc', 'bcc', 'list'])`. The string `'personal'` is not assignable to that union. TypeScript should flag this as a compile error. The test passes at runtime (JS doesn't enforce types), but `tsc --noEmit` or `vitest --typecheck` will reject it. The test intent is valid — any real visibility value makes `isSenderOnly` return false — but the value used is not a valid production input.

**Fix:** Replace `'personal'` with any valid `VisibilityMatch` value:
```typescript
// Before (line 121)
const rule = makeRule({ match: { sender: '*@test.com', visibility: 'personal' } });

// After
const rule = makeRule({ match: { sender: '*@test.com', visibility: 'direct' } });
```

## Info

### IN-01: No Fastify querystring schema declared on the route

**File:** `src/web/routes/dispositions.ts:25-43`
**Issue:** The route manually extracts and type-guards the `type` query param via `as Record<string, unknown>` + `typeof` check. This is functionally correct — the `typeof raw === 'string'` guard on line 30 properly handles cases where Fastify parses `?type=a&type=b` as an array. However, the route declares no Fastify `querystring` schema, so Fastify's built-in validation, coercion, and OpenAPI documentation are bypassed. This is consistent with other routes in the project, so it is not an anomaly, but it is worth noting.

**Fix (optional):** Declare a querystring schema to get free validation and type-safe access:
```typescript
app.get('/api/dispositions', {
  schema: {
    querystring: {
      type: 'object',
      properties: { type: { type: 'string' } },
      additionalProperties: false,
    },
  },
}, async (request, reply) => {
  const { type } = request.query as { type?: string };
  // ...
});
```

### IN-02: `isSenderOnly` exported without a doc comment explaining business intent

**File:** `src/web/routes/dispositions.ts:8`
**Issue:** The function implements a non-obvious rule: sender must be set, all other fields must be absent, and `readStatus: 'any'` is treated as equivalent to absent. A brief JSDoc would make the intent clear without requiring readers to cross-reference the schema.

**Fix:**
```typescript
/**
 * Returns true if the rule matches on sender address only —
 * no recipient, subject, deliveredTo, visibility, or specific readStatus.
 * readStatus='any' is treated as equivalent to absent (matches all messages).
 */
export function isSenderOnly(rule: Rule): boolean {
```

---

_Reviewed: 2026-04-20T05:08:13Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
