---
phase: 13-disposition-query-api
reviewed: 2026-04-19T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/web/routes/dispositions.ts
  - test/unit/web/dispositions.test.ts
  - src/web/server.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-04-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

This phase adds `GET /api/dispositions` — a filtered view of sender-only rules. The route implementation and test suite are clean and well-structured overall. Two correctness issues need attention: `isSenderOnly` has an incomplete field check that will silently include non-sender-only rules if `deliveredTo`, `visibility`, or `readStatus` are set, and the test mock is missing two required `ServerDeps` fields which will fail TypeScript compilation. Two lower-priority quality notes round out the findings.

## Warnings

### WR-01: `isSenderOnly` ignores three valid `EmailMatch` fields

**File:** `src/web/routes/dispositions.ts:9-14`

**Issue:** `isSenderOnly` only checks that `recipient` and `subject` are undefined, but `EmailMatch` has three additional match fields: `deliveredTo`, `visibility`, and `readStatus`. A rule with `match: { sender: 'x@y.com', deliveredTo: 'list@z.com' }` has two criteria and should NOT be considered sender-only, but the current predicate returns `true` for it. This will cause those rules to appear in the dispositions API response incorrectly.

**Fix:**
```typescript
export function isSenderOnly(rule: Rule): boolean {
  const m = rule.match;
  return (
    m.sender !== undefined &&
    m.recipient === undefined &&
    m.subject === undefined &&
    m.deliveredTo === undefined &&
    m.visibility === undefined &&
    m.readStatus === undefined
  );
}
```

---

### WR-02: Test mock `makeDeps` is missing required `ServerDeps` fields

**File:** `test/unit/web/dispositions.test.ts:51-76`

**Issue:** `ServerDeps` (defined in `src/web/server.ts:33-34`) requires `getMoveTracker: () => MoveTracker | undefined` and `getProposalStore: () => ProposalStore`. The `makeDeps` helper in the test omits both. TypeScript will reject this at compile time (`tsc` / `vitest --typecheck`), and depending on any route that accesses those deps at runtime, it could also panic.

**Fix:**
```typescript
function makeDeps(config: Config): ServerDeps {
  writeConfig(config);
  const configRepo = new ConfigRepository(configPath);

  return {
    configRepo,
    activityLog,
    getMonitor: () => ({ ... } as any),
    getSweeper: () => undefined,
    getFolderCache: () => ({ ... } as any),
    getBatchEngine: () => ({ ... } as any),
    getMoveTracker: () => undefined,          // add this
    getProposalStore: () => ({ ... } as any), // add this (stub as needed)
  };
}
```

---

## Info

### IN-01: Unsafe query param cast without Fastify schema validation

**File:** `src/web/routes/dispositions.ts:26-27`

**Issue:** `request.query as Record<string, string>` is an unchecked cast. Fastify parses `?type[]=foo` or `?type=a&type=b` as an array, not a string, at runtime. Without a declared Fastify query schema, TypeScript sees `string` but the runtime value could be `string[]`. `isValidDispositionType` would then receive an array and return `false`, yielding a 400 with a misleading error message rather than being handled gracefully.

**Fix:** Declare a Fastify route schema for the query string, or explicitly guard the runtime type:
```typescript
const raw = (request.query as Record<string, unknown>).type;
const type = typeof raw === 'string' ? raw : undefined;
```

---

### IN-02: Test suite leaks a new `buildServer` instance per test case without closing it

**File:** `test/unit/web/dispositions.test.ts:163-252`

**Issue:** Each `it` block calls `buildServer(...)` but never calls `app.close()`. Fastify tracks open handles (timers, sockets). In `vitest`, this can produce "open handle" warnings and slow teardown. The `afterEach` only closes `activityLog` and the tmpdir, not the Fastify instances.

**Fix:** Store the app reference and close it after each test:
```typescript
let app: FastifyInstance;

// inside each it:
app = buildServer(makeDeps(makeTestConfig()));

// or in afterEach:
afterEach(async () => {
  await app?.close();
  activityLog.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

---

_Reviewed: 2026-04-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
