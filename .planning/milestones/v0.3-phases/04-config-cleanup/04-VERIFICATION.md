---
phase: 04-config-cleanup
verified: 2026-04-10T19:07:00Z
status: human_needed
score: 4/5 must-haves verified
overrides_applied: 0
overrides:
  - must_have: "Default archive destination is configurable separately for inbox-sourced and review-sourced messages"
    reason: "Developer narrowed CONF-02 in CONTEXT.md D-04: inbox processing (Monitor) has no archive fallback and doesn't need one — unmatched messages stay in INBOX. CONF-02 reduces to making the single defaultArchiveFolder editable, which is implemented."
    accepted_by: ""
    accepted_at: ""
human_verification:
  - test: "Open the Settings page and verify the Sweep Settings card shows editable form fields"
    expected: "Three folder tree pickers (Review Folder, Archive Folder, Trash Folder), three numeric inputs (Sweep Interval, Read Max Age, Unread Max Age), a cursor toggle checkbox, and a Save Sweep Settings button — not a static read-only dl list"
    why_human: "DOM rendering verification requires a running browser session"
  - test: "Change Sweep Interval to 12 hours, click Save Sweep Settings, then refresh the page"
    expected: "Toast shows 'Sweep settings saved'. After refresh, the interval field shows 12. Config file on disk reflects the change."
    why_human: "Requires running server + browser to verify persistence end-to-end"
  - test: "Use a folder tree picker to change the Archive Folder, save, and verify it persists after page refresh"
    expected: "Tree picker opens showing folder hierarchy, selecting a folder updates the displayed value, saving persists the new folder name"
    why_human: "Tree picker is a DOM-heavy interactive component; requires live browser"
  - test: "Uncheck the cursor toggle, save, restart the server, verify Monitor starts processing from UID 1 (not the last stored UID)"
    expected: "Server logs show Monitor fetching '1:*' range on startup instead of resuming from a stored UID. After re-enabling and restarting, it resumes from the stored UID again."
    why_human: "Requires server restart and log inspection to verify behavior"
---

# Phase 4: Config & Cleanup Verification Report

**Phase Goal:** Users can edit sweep settings and archive defaults from the UI, and v0.2 bugs are resolved
**Verified:** 2026-04-10T19:07:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Sweep settings card shows editable input fields instead of static text | ? HUMAN | DOM verified via code — sweepCard.innerHTML with form inputs confirmed. Visual confirmation needed. |
| 2 | Folder fields in sweep settings use the tree picker component | ? HUMAN | Three `renderFolderPicker` calls for sw-review-picker, sw-archive-picker, sw-trash-picker exist in app.ts lines 457-470. Live verification needed. |
| 3 | Saving sweep settings persists changes and triggers hot-reload | ? HUMAN | `api.config.updateReview(payload)` wired in save handler with complete sweep sub-object at app.ts:486. Persistence requires running server test. |
| 4 | After config reload, getSweeper returns the newly created sweeper instance | VERIFIED | src/index.ts line 71: `sweeper = undefined` set before async gap. Line 41: typed as `ReviewSweeper \| undefined`. Both onReviewConfigChange and onImapConfigChange handlers have the guard. |
| 5 | When cursor toggle is disabled, Monitor starts from UID 0 on restart | VERIFIED | src/monitor/index.ts lines 44-51: `cursorEnabled !== 'false'` check; when false, `this.lastUid = 0`. Test in monitor.test.ts line 488 confirms behavior with stored lastUid=500. |
| 6 | When cursor toggle is disabled, Monitor does not persist lastUid to SQLite | VERIFIED | src/monitor/index.ts lines 117-119: `if (this.cursorEnabled)` guards the `setState('lastUid', ...)` call. Test at line 511 verifies. |
| 7 | Cursor toggle setting is visible and changeable in the settings UI | ? HUMAN | Checkbox `id="sw-cursor"` in sweepCard.innerHTML at app.ts:448. Wired to `/api/settings/cursor` PUT at app.ts:489. Visual confirmation needed. |
| 8 | Rules with blank names are accepted by the schema and saved without error | VERIFIED | src/config/schema.ts line 47: `name: z.string().optional()`. Test at config.test.ts line 461 passes. 347 tests passing. |
| 9 | Every rule shows a behavior description as primary text | VERIFIED | `generateBehaviorDescription` in rule-display.ts, used in app.ts line 89. Rule cell renders with `rule-behavior` span as primary. |
| 10 | DryRunMessage.ruleName never contains undefined | VERIFIED | src/batch/index.ts line 125: `ruleName = matched.name ?? ''`. Line 113 already had `sweep.matchedRule?.name ?? ''`. |

**Score:** 6/7 automated truths verified; 4 require human confirmation

### Deferred Items

No items deferred to later phases.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/schema.ts` | Optional rule name in ruleSchema | VERIFIED | `z.string().optional()` at line 47 |
| `src/web/frontend/app.ts` | Editable sweep card + generateBehaviorDescription usage | VERIFIED | renderFolderPicker calls, sweepCard form, generateBehaviorDescription imported and used |
| `src/web/frontend/rule-display.ts` | generateBehaviorDescription function | VERIFIED | File exists, function exported at line 15 |
| `test/unit/config/config.test.ts` | Schema tests + generateBehaviorDescription tests | VERIFIED | `ruleSchema optional name` describe block (3 tests) + `generateBehaviorDescription` describe block (5 tests) |
| `src/monitor/index.ts` | Conditional lastUid persistence based on cursorEnabled | VERIFIED | `cursorEnabled` field, conditional constructor logic, conditional setState |
| `test/unit/monitor/monitor.test.ts` | Tests for cursor toggle behavior | VERIFIED | `cursorEnabled toggle` describe block with 4 tests at line 487 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/web/frontend/app.ts | src/config/schema.ts | Rule type with optional name | WIRED | `name?` pattern confirmed by gsd-tools |
| src/batch/index.ts | src/config/schema.ts | rule.name with fallback | WIRED | `matched.name ?? ''` at line 125 — gsd-tools false negative due to regex escaping, manually confirmed |
| src/web/frontend/app.ts | PUT /api/config/review | api.config.updateReview(payload) | WIRED | `api.config.updateReview(payload)` at app.ts:486 — gsd-tools false negative, manually confirmed |
| src/index.ts | src/monitor/index.ts | onReviewConfigChange triggers sweeper rebuild | WIRED | Confirmed by gsd-tools and manual inspection |
| src/monitor/index.ts | src/log/index.ts | getState/setState for cursorEnabled and lastUid | WIRED | Confirmed by gsd-tools |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| src/web/frontend/app.ts (sweep card) | reviewConfig | GET /api/config/review | Yes — configRepo.getReviewConfig() reads from YAML/SQLite | FLOWING |
| src/monitor/index.ts | cursorEnabled | activityLog.getState('cursorEnabled') | Yes — reads SQLite state table | FLOWING |
| src/monitor/index.ts | lastUid | activityLog.getState('lastUid') | Yes — reads SQLite state table | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| generateBehaviorDescription produces expected output | Verified via vitest (5 tests) | All pass | PASS |
| Monitor cursorEnabled=false starts from UID 0 | Verified via vitest monitor.test.ts line 488 | Passes | PASS |
| Monitor cursorEnabled=false skips lastUid setState | Verified via vitest monitor.test.ts line 511 | Passes | PASS |
| Frontend build succeeds | `node esbuild.mjs` | "Frontend built to dist/public/" | PASS |
| Full test suite passes | `npx vitest run` | 347 tests, 18 files, all passing | PASS |
| Server entrypoint loads | `node dist/index.js` | Loads cleanly (exits on missing IMAP config, not on import error) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CONF-01 | 04-02 | Sweep settings editable in UI (intervals, age thresholds, folder names) | VERIFIED | Editable form card with inputs for all 6 fields + 3 tree pickers in app.ts |
| CONF-02 | 04-02 | Default archive destination configurable per-stream | PARTIAL — SEE OVERRIDE | Single `defaultArchiveFolder` editable in UI. Developer decision D-04 in CONTEXT.md explicitly narrowed this — inbox has no archive fallback because unmatched messages stay in INBOX |
| CONF-03 | 04-02 | Fix stale sweeper reference after config reload | VERIFIED | `sweeper = undefined` guard before async gap in src/index.ts lines 71, 88 |
| CONF-04 | 04-02 | Message cursor toggle — disable lastUid persistence | VERIFIED | cursorEnabled in Monitor, GET/PUT /api/settings/cursor endpoints, frontend checkbox wired |
| CONF-05 | 04-01 | Rule name optional, behavior description display | VERIFIED | z.string().optional() in schema, generateBehaviorDescription in rule-display.ts, rule table updated |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/web/routes/review-config.ts | 12-14 | `body as any` and `err: any` casts | Info | Pre-existing pattern, not introduced in this phase. No blocking impact. |

### Human Verification Required

#### 1. Sweep Settings Card — Visual Confirmation

**Test:** Start the server (`npm start`), open the web UI, navigate to Settings.
**Expected:** The Sweep Settings section shows an editable form: three folder tree pickers (Review Folder, Archive Folder, Trash Folder), three number inputs (Sweep Interval hours, Read Max Age days, Unread Max Age days), a checkbox labeled "Enable message cursor (resume from last UID)", and a "Save Sweep Settings" button. No static `<dl>` list.
**Why human:** DOM rendering requires a live browser session.

#### 2. Sweep Settings Save + Persistence

**Test:** Change the Sweep Interval to 12, click "Save Sweep Settings", then do a hard refresh.
**Expected:** Toast shows "Sweep settings saved". After refresh, the interval field shows 12. Config hot-reload triggers (check server logs show sweeper rebuild).
**Why human:** End-to-end persistence requires live server + browser.

#### 3. Folder Tree Picker in Sweep Settings

**Test:** Click on the "Archive Folder" tree picker, browse the folder hierarchy, select a different folder, then save and refresh.
**Expected:** Tree picker opens showing mail folder hierarchy. Selecting a folder updates the picker display. After save and refresh, the new folder name appears in the picker.
**Why human:** Tree picker is an interactive DOM component.

#### 4. Cursor Toggle Restart Behavior

**Test:** Uncheck "Enable message cursor", save. Restart the server. Check logs.
**Expected:** Server logs show Monitor fetching `1:*` range (from UID 0). Re-enable the cursor, save, restart — logs show Monitor fetching from the previously stored lastUid.
**Why human:** Requires server restart and log inspection.

### CONF-02 Override Decision Needed

The roadmap success criterion #2 states: "Default archive destination is configurable separately for inbox-sourced and review-sourced messages." The implementation provides a single `defaultArchiveFolder` editable in the sweep UI — not separate per-stream configuration.

**This is an intentional developer decision.** In CONTEXT.md D-04: "No per-stream archive split. Inbox processing (Monitor) has no archive fallback and doesn't need one — unmatched messages stay in INBOX. CONF-02 reduces to making the existing `defaultArchiveFolder` editable in the sweep settings UI."

The REQUIREMENTS.md CONF-02 description also aligns with the narrowed scope: "Default archive destination configurable per-stream (inbox-sourced vs review-sourced)" — but the developer decided this was unnecessary.

**To formally accept this deviation, add to the VERIFICATION.md frontmatter:**

```yaml
overrides:
  - must_have: "Default archive destination is configurable separately for inbox-sourced and review-sourced messages"
    reason: "Developer narrowed CONF-02 in CONTEXT.md D-04: inbox processing (Monitor) has no archive fallback — unmatched messages stay in INBOX. Single defaultArchiveFolder editable in sweep UI satisfies the actual need."
    accepted_by: "your-name"
    accepted_at: "2026-04-10T00:00:00Z"
```

### Gaps Summary

No hard gaps blocking goal achievement. All automated truths pass. The only open items are:

1. **CONF-02 override needs acceptance** — the developer narrowed the scope in CONTEXT.md but the roadmap success criterion still says "separately for inbox-sourced and review-sourced." Needs an explicit override to close.

2. **Human verification required** — 4 items need live server + browser testing: the sweep settings card visual appearance, save/persistence behavior, tree picker interaction, and cursor toggle restart behavior.

All 347 unit tests pass. Frontend builds cleanly. The backend wiring (stale sweeper fix, cursor toggle, schema change, batch engine fallback) is fully verified programmatically.

---

_Verified: 2026-04-10T19:07:00Z_
_Verifier: Claude (gsd-verifier)_
