# Phase 13: Disposition Query API - Research

**Researched:** 2026-04-19
**Domain:** Backend API filtering / Fastify route / TypeScript
**Confidence:** HIGH

## Summary

Phase 13 adds a query endpoint that filters existing rules down to "sender-only" rules and groups them by disposition type (skip, delete, review, move). This is purely a read-only filter over the existing `ConfigRepository.getRules()` data -- no new storage, no schema changes, no migrations.

The existing codebase already has all the primitives: the `Rule` type with `EmailMatch` and `Action` discriminated union, the `ConfigRepository` that returns sorted rules, and the Fastify route registration pattern used by every other route module. The new endpoint is a straightforward filter function plus a route handler.

**Primary recommendation:** Add a single new route file `src/web/routes/dispositions.ts` with a `GET /api/dispositions` endpoint that accepts an optional `?type=` query parameter, filters rules to sender-only, and returns them grouped by disposition type.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIEW-05 | Rules with multiple match criteria do not appear in disposition views (sender-only filter) | The `isSenderOnly()` predicate checks that only `match.sender` is defined and all other match fields are undefined. This is the core filtering logic. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Runtime:** Node.js / TypeScript, compiled with tsc
- **Frontend:** Vanilla HTML/CSS/JS SPA (no framework)
- **Database:** SQLite via better-sqlite3 (not relevant to this phase -- rules live in config.yml)
- **Testing:** Vitest with 453+ tests
- **Web framework:** Fastify 5.x
- **Validation:** Zod 4.x
- **Rule name is OPTIONAL** -- ruleSchema name field must stay optional (regressed 3 times, per CLAUDE.md memory)
- Views are query-based filters over existing rules -- no new storage needed (locked decision from STATE.md)

## Standard Stack

### Core

No new dependencies. This phase uses only what already exists:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | ^5.7.4 | HTTP server, route registration | Already in use, all routes follow same pattern [VERIFIED: package.json] |
| zod | ^4.3.6 | Input validation (query params) | Already in use for all schema validation [VERIFIED: package.json] |

### Supporting

None required -- no new libraries needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Query param `?type=skip` | Separate endpoints per type (`/api/dispositions/skip`) | Query param is simpler, one route, matches existing API style |
| Filter in route handler | Filter in ConfigRepository | Keep ConfigRepository generic; disposition logic is a view concern, not a config concern |

## Architecture Patterns

### Recommended Project Structure

```
src/web/routes/dispositions.ts     # NEW - disposition query route
src/web/server.ts                  # MODIFY - register new route
test/unit/web/dispositions.test.ts # NEW - unit tests
```

### Pattern 1: Sender-Only Predicate

**What:** A pure function that determines if a rule qualifies as "sender-only"
**When to use:** Core filtering logic, reusable across route and tests

```typescript
// Source: derived from src/config/schema.ts EmailMatch type [VERIFIED: codebase]
import type { Rule } from '../../config/schema.js';

export function isSenderOnly(rule: Rule): boolean {
  const m = rule.match;
  return (
    m.sender !== undefined &&
    m.recipient === undefined &&
    m.subject === undefined &&
    m.deliveredTo === undefined &&
    m.visibility === undefined &&
    (m.readStatus === undefined || m.readStatus === 'any')
  );
}
```

**Key decision:** `readStatus: 'any'` is semantically equivalent to undefined (matches everything), so it should NOT disqualify a rule from being "sender-only". All other match fields with a value indicate multi-criteria matching. [ASSUMED]

### Pattern 2: Route Registration (existing pattern)

**What:** All routes in this project follow the same pattern: export a `registerXRoutes(app, deps)` function, called from `server.ts`
**When to use:** Always -- this is the established convention [VERIFIED: src/web/server.ts, src/web/routes/rules.ts]

```typescript
// Source: existing pattern from src/web/routes/rules.ts [VERIFIED: codebase]
import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';

export function registerDispositionRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/dispositions', async (request) => {
    const rules = deps.configRepo.getRules();
    const senderOnly = rules.filter(isSenderOnly);
    
    const type = (request.query as Record<string, string>).type;
    if (type) {
      return senderOnly.filter(r => r.action.type === type);
    }
    return senderOnly;
  });
}
```

### Pattern 3: Response Shape

**What:** The endpoint returns Rule objects directly (same shape as `GET /api/rules`), just filtered. No transformation needed.
**When to use:** Keeps downstream phases simple -- the frontend already knows the Rule type.

For a grouped response (useful for Phase 14-15 UI):

```typescript
// Optional: grouped response for convenience
interface DispositionGroup {
  type: 'skip' | 'delete' | 'review' | 'move';
  label: string;
  rules: Rule[];
}
```

### Anti-Patterns to Avoid

- **Adding disposition columns to the database:** Views are query-based filters over existing rules. No new storage. This is a locked decision.
- **Modifying ConfigRepository:** The filter logic belongs in the route layer, not the config layer. ConfigRepository should stay generic.
- **Forgetting disabled rules:** The endpoint should probably include disabled rules in results (the view shows all sender rules regardless of enabled state), but this should be considered. [ASSUMED]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query param validation | Manual string parsing | Zod schema or simple type guard | Consistent with project patterns |
| Action type checking | String comparison with typo risk | TypeScript discriminated union narrowing | Already works via `rule.action.type` |

**Key insight:** This phase is almost trivially simple because the existing data model already encodes everything needed. The "disposition" is just the action type, and "sender-only" is just a check that only the sender match field is populated.

## Common Pitfalls

### Pitfall 1: readStatus 'any' vs undefined

**What goes wrong:** A rule with `readStatus: 'any'` gets excluded from sender-only results even though 'any' is semantically identical to not specifying readStatus.
**Why it happens:** The Zod schema allows readStatus to be set explicitly to 'any', which some rules may have.
**How to avoid:** Treat `readStatus: 'any'` the same as `readStatus: undefined` in the `isSenderOnly` predicate.
**Warning signs:** Rules that should appear in disposition views are missing.

### Pitfall 2: Forgetting to register the route

**What goes wrong:** Endpoint 404s because the route was not registered in server.ts.
**Why it happens:** New route file created but `registerDispositionRoutes` not called in `buildServer()`.
**How to avoid:** Always update server.ts import and registration call. There are 10 existing registrations to follow as examples.
**Warning signs:** 404 on `/api/dispositions`.

### Pitfall 3: Not considering enabled/disabled state

**What goes wrong:** Disabled sender-only rules either show up when they shouldn't or are hidden when they should be visible.
**Why it happens:** No clear requirement about whether disabled rules appear in disposition views.
**How to avoid:** Include all sender-only rules regardless of enabled state (the view is about showing what senders have rules, not about what's currently active). Let the UI indicate enabled/disabled status.
**Warning signs:** User disables a rule and it vanishes from disposition view without explanation.

### Pitfall 4: Invalid disposition type parameter

**What goes wrong:** User passes `?type=invalid` and gets empty results with no error.
**Why it happens:** No validation on the query parameter.
**How to avoid:** Validate that `type` is one of `skip`, `delete`, `review`, `move` or return 400.
**Warning signs:** Silent empty results.

## Code Examples

### Complete isSenderOnly implementation

```typescript
// Source: derived from EmailMatch schema in src/config/schema.ts [VERIFIED: codebase]
import type { Rule } from '../../config/schema.js';

const DISPOSITION_TYPES = ['skip', 'delete', 'review', 'move'] as const;
type DispositionType = typeof DISPOSITION_TYPES[number];

export function isSenderOnly(rule: Rule): boolean {
  const m = rule.match;
  return (
    m.sender !== undefined &&
    m.recipient === undefined &&
    m.subject === undefined &&
    m.deliveredTo === undefined &&
    m.visibility === undefined &&
    (m.readStatus === undefined || m.readStatus === 'any')
  );
}

export function isValidDispositionType(type: string): type is DispositionType {
  return (DISPOSITION_TYPES as readonly string[]).includes(type);
}
```

### Test structure (following existing patterns)

```typescript
// Source: test pattern from test/unit/config/repository.test.ts [VERIFIED: codebase]
import { describe, it, expect } from 'vitest';
import { isSenderOnly } from '../../../src/web/routes/dispositions.js';
import type { Rule } from '../../../src/config/schema.js';

function makeRule(match: Rule['match'], action: Rule['action']): Rule {
  return { id: 'test-1', match, action, enabled: true, order: 0 };
}

describe('isSenderOnly', () => {
  it('returns true for sender-only match', () => {
    expect(isSenderOnly(makeRule({ sender: '*@test.com' }, { type: 'skip' }))).toBe(true);
  });

  it('returns false when recipient is also set', () => {
    expect(isSenderOnly(makeRule(
      { sender: '*@test.com', recipient: 'me@test.com' },
      { type: 'skip' }
    ))).toBe(false);
  });

  it('returns true when readStatus is any', () => {
    expect(isSenderOnly(makeRule(
      { sender: '*@test.com', readStatus: 'any' },
      { type: 'skip' }
    ))).toBe(true);
  });

  it('returns false when readStatus is specific', () => {
    expect(isSenderOnly(makeRule(
      { sender: '*@test.com', readStatus: 'read' },
      { type: 'skip' }
    ))).toBe(false);
  });
});
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/unit/web/dispositions.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIEW-05 | sender-only filter excludes multi-criteria rules | unit | `npx vitest run test/unit/web/dispositions.test.ts -t "isSenderOnly"` | Wave 0 |
| VIEW-05 | API returns filtered rules by disposition type | unit | `npx vitest run test/unit/web/dispositions.test.ts -t "GET /api/dispositions"` | Wave 0 |
| VIEW-05 | invalid type param returns 400 | unit | `npx vitest run test/unit/web/dispositions.test.ts -t "invalid type"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run test/unit/web/dispositions.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/unit/web/dispositions.test.ts` -- covers VIEW-05 (isSenderOnly predicate + route handler)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-user system, no auth |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | Single-user, all endpoints open |
| V5 Input Validation | yes | Validate `?type=` query param against allowed values |
| V6 Cryptography | no | No crypto operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Query param injection | Tampering | Validate against allowlist of disposition types |

Minimal security surface -- this is a read-only filter endpoint on a single-user local app with no authentication.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `readStatus: 'any'` should be treated same as undefined for sender-only check | Architecture Patterns | Rules with explicit `readStatus: 'any'` would be incorrectly excluded from views |
| A2 | Disabled rules should appear in disposition views | Common Pitfalls | Could confuse users if disabled rules show/hide unexpectedly |
| A3 | Response should use same Rule shape as GET /api/rules (no transformation) | Architecture Patterns | If frontend needs different shape, would require rework in Phase 14 |

## Open Questions

1. **Should `readStatus: 'any'` disqualify sender-only?**
   - What we know: 'any' matches everything, semantically equivalent to not filtering by readStatus
   - What's unclear: Whether users intentionally set 'any' to mean "I care about read status"
   - Recommendation: Treat 'any' as equivalent to undefined -- it doesn't narrow the match

2. **Should disabled rules appear in disposition views?**
   - What we know: Requirements don't mention enabled/disabled state
   - What's unclear: User expectation when disabling a sender-only rule
   - Recommendation: Include disabled rules, let UI show enabled/disabled indicator

## Sources

### Primary (HIGH confidence)
- `src/config/schema.ts` -- EmailMatch fields, Action discriminated union, Rule schema [VERIFIED: codebase]
- `src/web/routes/rules.ts` -- existing route pattern [VERIFIED: codebase]
- `src/web/server.ts` -- route registration pattern, ServerDeps interface [VERIFIED: codebase]
- `src/config/repository.ts` -- getRules() method [VERIFIED: codebase]
- `src/shared/types.ts` -- shared API types [VERIFIED: codebase]
- `package.json` -- dependency versions [VERIFIED: codebase]
- `.planning/REQUIREMENTS.md` -- VIEW-05 requirement [VERIFIED: codebase]

### Secondary (MEDIUM confidence)
None needed -- this phase is entirely within existing codebase patterns.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries [VERIFIED: codebase]
- Architecture: HIGH -- follows exact patterns from 10 existing route modules [VERIFIED: codebase]
- Pitfalls: MEDIUM -- readStatus edge case and disabled-rule behavior are assumptions

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (stable -- no external dependencies, pure codebase query)
