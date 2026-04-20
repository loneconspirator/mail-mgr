---
phase: 13-disposition-query-api
verified: 2026-04-19T21:52:00Z
status: gaps_found
score: 3/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Rules with multiple match criteria (recipient, subject, deliveredTo, visibility, readStatus!=any) are excluded"
    status: failed
    reason: "isSenderOnly only checks sender, recipient, subject — does not check deliveredTo, visibility, or readStatus. Schema defines all six fields. A rule with { sender, deliveredTo } or { sender, visibility } incorrectly passes as sender-only."
    artifacts:
      - path: "src/web/routes/dispositions.ts"
        issue: "isSenderOnly predicate omits deliveredTo, visibility, readStatus checks. Lines 8-15 only evaluate m.sender, m.recipient, m.subject."
      - path: "test/unit/web/dispositions.test.ts"
        issue: "No test cases for deliveredTo, visibility, or readStatus filtering — these were removed per SUMMARY deviation claim that the fields don't exist, but they do exist in the schema."
    missing:
      - "Extend isSenderOnly to check: m.deliveredTo === undefined && m.visibility === undefined && (m.readStatus === undefined || m.readStatus === 'any')"
      - "Add test: returns false when deliveredTo also set"
      - "Add test: returns false when visibility also set"
      - "Add test: returns false when readStatus is 'read'"
      - "Add test: returns false when readStatus is 'unread'"
      - "Add test: returns true when readStatus is 'any'"
  - truth: "Rules with readStatus 'any' are treated as sender-only (not excluded)"
    status: failed
    reason: "Predicate does not inspect readStatus at all. A rule with readStatus='any' is currently included incidentally (no check excludes it), but also a rule with readStatus='read' is incorrectly included. The correct behavior — pass 'any', fail 'read'/'unread' — is not implemented or tested."
    artifacts:
      - path: "src/web/routes/dispositions.ts"
        issue: "No readStatus check in isSenderOnly predicate."
    missing:
      - "Add: (m.readStatus === undefined || m.readStatus === 'any') to isSenderOnly"
      - "Add test cases for readStatus variants (read=false, unread=false, any=true, undefined=true)"
---

# Phase 13: Disposition Query API Verification Report

**Phase Goal:** Backend serves filtered lists of sender-only rules grouped by disposition type
**Verified:** 2026-04-19T21:52:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /api/dispositions returns only sender-only rules (single sender match, no other criteria) | PARTIAL | Endpoint exists, filters on sender/recipient/subject but misses deliveredTo, visibility, readStatus fields |
| 2 | GET /api/dispositions?type=skip returns only sender-only rules with action type 'skip' | VERIFIED | 19/19 tests pass including type=skip, type=delete, type=review, type=move |
| 3 | GET /api/dispositions?type=invalid returns 400 error | VERIFIED | Test at line 217 passes; reply.status(400).send with error+valid keys confirmed |
| 4 | Rules with multiple match criteria (recipient, subject, deliveredTo, visibility, readStatus!=any) are excluded | FAILED | isSenderOnly only checks 3 of 6 match fields. deliveredTo, visibility, readStatus absent from predicate. Schema confirms all 6 fields exist. |
| 5 | Rules with readStatus 'any' are treated as sender-only (not excluded) | FAILED | readStatus not checked at all — rules with readStatus='read' are incorrectly allowed through as sender-only |

**Score:** 3/5 truths verified (Truths 2 and 3 verified; Truth 1 partial; Truths 4 and 5 failed)

### Critical Finding: SUMMARY Deviation Was Incorrect

The SUMMARY.md (line 63) states: "Plan references `deliveredTo`, `visibility`, and `readStatus` fields in `EmailMatch` type, but the actual schema only has `sender`, `recipient`, `subject`. These fields do not exist."

**This claim is false.** `src/config/schema.ts` lines 36-53 define all six fields on `emailMatchSchema`:

```
sender, recipient, subject, deliveredTo, visibility, readStatus
```

The SUMMARY's auto-fix was based on an incorrect reading of the schema. The fields do exist. The predicate is incomplete against VIEW-05 and roadmap success criterion #3 ("recipient, visibility, subject, etc. are excluded").

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/web/routes/dispositions.ts` | isSenderOnly predicate and route handler | STUB (partial) | Exists, 41 lines, exports all three functions, but isSenderOnly is incomplete — checks 3 of 6 match fields |
| `test/unit/web/dispositions.test.ts` | Unit tests, min 80 lines | VERIFIED | 254 lines, 19 tests, all passing |
| `src/web/server.ts` | Contains registerDispositionRoutes | VERIFIED | Line 71: `registerDispositionRoutes(app, deps)` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/web/routes/dispositions.ts | src/config/schema.ts | import type { Rule } | VERIFIED | Line 2: `import type { Rule } from '../../config/schema.js'` |
| src/web/routes/dispositions.ts | src/web/server.ts | registerDispositionRoutes called | VERIFIED | server.ts line 71: `registerDispositionRoutes(app, deps)` |
| src/web/routes/dispositions.ts | src/config/repository.ts | deps.configRepo.getRules() | VERIFIED | Line 23: `deps.configRepo.getRules()` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| GET /api/dispositions | senderOnly | deps.configRepo.getRules() | Yes — ConfigRepository reads from YAML file | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 19 disposition tests pass | npx vitest run test/unit/web/dispositions.test.ts | 19/19 passed, exit 0 | PASS |
| Full suite regression check | npx vitest run | 472/472 passed, 29/29 files | PASS |
| deliveredTo rule excluded | behavioral (can't run without compile) | Not tested | SKIP — confirmed by code inspection that check is absent |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| VIEW-05 | 13-01-PLAN.md | Rules with multiple match criteria do not appear in disposition views (sender-only filter) | PARTIAL | Sender/recipient/subject filtering works. deliveredTo, visibility, readStatus filtering absent. A rule matching on sender+deliveredTo or sender+visibility would incorrectly appear in disposition views. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/web/routes/dispositions.ts | 8-15 | Incomplete predicate — 3 of 6 match fields checked | Blocker | VIEW-05 not fully satisfied; rules with deliveredTo/visibility/readStatus criteria appear as sender-only |
| test/unit/web/dispositions.test.ts | — | Missing test cases for deliveredTo, visibility, readStatus variants | Blocker | No regression guard for the incomplete field checks |

### Human Verification Required

None — this verification is automated and conclusive. The schema, predicate code, and test file are all directly readable.

### Gaps Summary

Two gaps share a single root cause: the `isSenderOnly` predicate in `src/web/routes/dispositions.ts` checks only 3 of the 6 fields in `EmailMatch` (sender, recipient, subject) and ignores deliveredTo, visibility, and readStatus.

The SUMMARY.md claimed these fields don't exist in the schema as justification for removing them. That claim is incorrect — `src/config/schema.ts` defines all six fields. The roadmap success criterion #3 explicitly calls out "recipient, visibility, subject, etc." as things that must exclude a rule.

**Fix required (minimal):** Update isSenderOnly to:
```typescript
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

Then add 5 corresponding test cases for the missing field variants.

---

_Verified: 2026-04-19T21:52:00Z_
_Verifier: Claude (gsd-verifier)_
