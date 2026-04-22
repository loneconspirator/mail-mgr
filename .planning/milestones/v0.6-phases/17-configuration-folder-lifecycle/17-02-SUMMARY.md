---
phase: 17-configuration-folder-lifecycle
plan: 02
subsystem: imap
tags: [imap, action-folders, mailbox-creation, imapflow]

requires:
  - phase: 17-configuration-folder-lifecycle/01
    provides: ActionFolderConfig schema, getActionFolderConfig(), onActionFolderConfigChange()
provides:
  - ensureActionFolders() function for IMAP folder existence check and creation
  - ImapClient.status() method for mailbox existence checking
  - ImapClient.createMailbox() updated to accept array-form paths
  - Startup and config change wiring for action folder creation
affects: [17-configuration-folder-lifecycle/03, action-folder-monitoring, action-folder-processing]

tech-stack:
  added: []
  patterns: [status-based existence check, array-form IMAP paths for separator safety, graceful degradation on IMAP failure]

key-files:
  created:
    - src/action-folders/folders.ts
    - src/action-folders/index.ts
    - test/unit/action-folders/folders.test.ts
  modified:
    - src/imap/client.ts
    - src/index.ts

key-decisions:
  - "Added ImapClient.status() wrapper since it was missing from the class (only existed on ImapFlowLike interface)"
  - "Array-form paths prevent IMAP separator injection in folder names with special characters"

patterns-established:
  - "Action folder existence check: status() call, catch error means folder missing"
  - "Graceful degradation: log warning and continue when folder creation fails"
  - "Enabled guard pattern: check config.enabled before action folder operations"

requirements-completed: [FOLD-01]

duration: 3min
completed: 2026-04-20
---

# Phase 17 Plan 02: Action Folder Creation and Startup Wiring Summary

**ensureActionFolders() with IMAP status-based existence checks, array-form path creation, and startup/config-change wiring**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-20T20:33:02Z
- **Completed:** 2026-04-20T20:35:54Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created ensureActionFolders() that checks folder existence via IMAP STATUS and creates missing folders with array-form paths for separator safety
- Updated ImapClient with status() wrapper and createMailbox accepting string | string[] for array-form paths
- Wired folder creation into startup (after monitor.start), config change handler, and IMAP reconnect handler with enabled guards and graceful degradation
- Added 6 unit tests covering all folder creation scenarios (all exist, mixed, all missing, failure, custom prefix)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ensureActionFolders module and update ImapClient.createMailbox signature** - `d629343` (feat)
2. **Task 2: Wire folder creation into startup sequence and config change handler** - `bfbff89` (feat)

## Files Created/Modified
- `src/action-folders/folders.ts` - ensureActionFolders() function with folderExists() helper
- `src/action-folders/index.ts` - Barrel export for action-folders module
- `src/imap/client.ts` - Added status() method, updated createMailbox to accept string | string[]
- `src/index.ts` - Wired ensureActionFolders into startup, onActionFolderConfigChange, and onImapConfigChange
- `test/unit/action-folders/folders.test.ts` - 6 unit tests for folder creation logic

## Decisions Made
- Added ImapClient.status() wrapper method - the plan referenced client.status() but ImapClient only had the raw ImapFlowLike.status(). Added the wrapper to maintain the existing pattern of ImapClient wrapping ImapFlowLike methods.
- Array-form paths used for all createMailbox calls to prevent separator injection with Unicode folder names.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing ImapClient.status() method**
- **Found during:** Task 1 (ensureActionFolders implementation)
- **Issue:** Plan referenced client.status() but ImapClient class had no status() method - only ImapFlowLike interface exposed it
- **Fix:** Added status() wrapper method to ImapClient that delegates to flow.status() with messages/unseen query
- **Files modified:** src/imap/client.ts
- **Verification:** TypeScript compiles clean, all tests pass
- **Committed in:** d629343 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for correctness - ensureActionFolders needs status() to check folder existence. No scope creep.

## Issues Encountered
- Pre-existing frontend test failures (7 tests in test/unit/web/frontend.test.ts) unrelated to this plan's changes. These are about static file serving, not action folders. Out of scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Action folder creation infrastructure complete
- Ready for Phase 17 Plan 03+ to build folder monitoring/polling on top of ensureActionFolders
- ensureActionFolders returns boolean for downstream decision-making (start monitoring or not)

---
*Phase: 17-configuration-folder-lifecycle*
*Completed: 2026-04-20*
