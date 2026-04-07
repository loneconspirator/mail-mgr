---
created: 2026-04-07T01:16:06.004Z
title: Make message cursor optional via settings toggle
area: general
files:
  - src/monitor/index.ts:31,43-44,102,108-110
  - src/log/index.ts
  - src/web/frontend/app.ts
  - src/config/schema.ts
---

## Problem

The monitor currently always persists a `lastUid` cursor via `activityLog.getState('lastUid')` / `setState('lastUid', ...)` in `src/monitor/index.ts`. On startup it resumes from where it left off, only processing new messages. There's no way to disable this behavior — if you want to reprocess all inbox messages (e.g., after changing rules), you have to manually clear state.

Key code in `src/monitor/index.ts`:
- Line 31: `private lastUid: number`
- Lines 43-44: Loads saved cursor on init
- Lines 102-110: Fetches messages since `lastUid`, updates cursor after each

## Solution

1. Add a `useCursor` (or `resumeFromLastMessage`) boolean setting to the config schema (`src/config/schema.ts`)
2. Expose it on the settings page in the web UI (`src/web/frontend/app.ts`)
3. When **enabled** (default): current behavior — persist `lastUid` and resume from it
4. When **disabled**: on each startup/poll cycle, set `lastUid = 0` so all inbox messages are evaluated against rules
5. The monitor (`src/monitor/index.ts`) checks this setting before loading/saving the cursor
6. Consider: when toggling from on→off, should the stored cursor be cleared, or just ignored until re-enabled?
