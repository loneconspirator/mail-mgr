---
phase: 30-scanning-rename-detection
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/config/schema.ts
  - src/index.ts
  - src/sentinel/index.ts
  - src/sentinel/scanner.ts
  - test/unit/sentinel/scanner.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-04-22
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Five files reviewed covering the new `SentinelScanner` class, its type exports, integration wiring in `src/index.ts`, config schema additions, and the unit test suite. The implementation is solid overall — the fast-path / deep-scan architecture is clean, the running-guard is correct, and IMAP transient error handling is well-placed. Two warnings: a case-sensitivity bug in the deep scan folder-skip logic, and a redundant `getConfig()` call during IMAP reconnect that could theoretically read stale config. Three info-level items round out the report.

## Warnings

### WR-01: Deep scan expected-folder skip is case-sensitive

**File:** `src/sentinel/scanner.ts:202`
**Issue:** The expected folder is excluded from deep scan iteration with a strict equality check (`folder === sentinel.folderPath`). If the IMAP server returns folder paths with different casing than what was stored in the sentinel (e.g., "archive" vs "Archive"), the expected folder will be searched a second time unnecessarily — producing a spurious `found-in-different-folder` result pointing at the same logical folder under a different name. This is particularly relevant for IMAP servers that normalize folder names to lowercase.

**Fix:**
```ts
// Replace line 202:
if (folder.toLowerCase() === sentinel.folderPath.toLowerCase()) {
  continue;
}
```

---

### WR-02: Redundant `configRepo.getConfig()` call after IMAP reconnect (potential stale-config window)

**File:** `src/index.ts:277`
**Issue:** After the IMAP reconnect sequence, `configRepo.getConfig()` is called again at line 277 to build the sentinel scanner, despite `updatedConfig` already holding the same data from the call at line 203. In practice they should be identical, but if any middleware or listener mutates config between those two points, the scanner could receive a different `scanIntervalMs` than the sentinel reconciliation used. It also creates a confusing variable name (`updatedConfigForScanner`) that implies the config may have changed.

**Fix:**
```ts
// Replace lines 277-285 — reuse updatedConfig rather than re-fetching:
sentinelScanner = new SentinelScanner({
  client: newClient,
  sentinelStore,
  scanIntervalMs: updatedConfig.sentinel.scanIntervalMs,
  enabled: sentinelEnabled,
  logger,
});
sentinelScanner.start();
```

---

## Info

### IN-01: `sentinelConfigSchema` does not use `sentinelDefaults` for its field default

**File:** `src/config/schema.ts:159-161`
**Issue:** The constant `sentinelDefaults` is defined at line 157 and used at line 171 for the top-level schema default, but `sentinelConfigSchema` itself hardcodes `300_000` directly rather than referencing `sentinelDefaults.scanIntervalMs`. This is inconsistent with the pattern used by `sweepConfigSchema` and `moveTrackingConfigSchema`, which reference their respective `*Defaults` objects. If the default changes, both the const and the schema field default need updating.

**Fix:**
```ts
export const sentinelConfigSchema = z.object({
  scanIntervalMs: z.number().int().positive().default(sentinelDefaults.scanIntervalMs),
});
```

---

### IN-02: Redundant `?? undefined` expression in envelope-header comparison

**File:** `src/index.ts:318`
**Issue:** The expression `(initialHeader ?? undefined)` is used in a comparison. `initialHeader` is typed `string | null`; the `?? undefined` coerces `null` to `undefined`. While logically correct, it is an unusual pattern that obscures intent. A direct null-coalescing assignment or explicit comparison is clearer.

**Fix:**
```ts
// Replace line 318 comparison:
if ((initialHeader ?? undefined) !== config.imap.envelopeHeader) {
// With:
const resolvedHeader = initialHeader ?? undefined;
if (resolvedHeader !== config.imap.envelopeHeader) {
```

---

### IN-03: Test for transient errors does not assert on returned report shape

**File:** `test/unit/sentinel/scanner.test.ts:486`
**Issue:** The `NoConnection` and `ETIMEOUT` error tests (lines 486 and 502) only assert that `logger.debug` was called. They do not assert that the returned report has `results: []`, `errors: 0`, etc. A future refactor could change the early-return shape without breaking the assertion, leaving the behavior unverified.

**Fix:**
```ts
const report = await scanner.runScanForTest();
expect(logger.debug).toHaveBeenCalled();
expect(report.results).toHaveLength(0);
expect(report.deepScansTriggered).toBe(0);
expect(report.errors).toBe(0);
```

---

_Reviewed: 2026-04-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
