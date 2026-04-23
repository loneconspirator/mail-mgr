---
phase: 27-imap-sentinel-operations
plan: 01
subsystem: imap
tags: [imapflow, append, search, delete, tdd]

# Dependency graph
requires:
  - phase: 26-sentinel-store-message-format
    provides: sentinel message format builder and store
provides:
  - "ImapClient.appendMessage() for IMAP APPEND operations"
  - "ImapClient.searchByHeader() for IMAP SEARCH by custom header"
  - "ImapClient.deleteMessage() for IMAP message deletion by UID"
  - "AppendResponse and SearchQuery types exported from imap barrel"
affects: [27-02-imap-sentinel-operations]

# Tech tracking
tech-stack:
  added: []
  patterns: ["appendMessage avoids mailbox switch (APPEND takes path directly)", "searchByHeader/deleteMessage use withMailboxSwitch for folder selection + INBOX reopen"]

key-files:
  created: []
  modified:
    - src/imap/client.ts
    - src/imap/index.ts
    - test/unit/imap/client.test.ts

key-decisions:
  - "appendMessage does not use withMailboxSwitch because IMAP APPEND takes folder path as first argument"
  - "searchByHeader and deleteMessage use withMailboxSwitch for proper mailbox selection and INBOX reopen"
  - "SearchQuery uses index signature for extensibility beyond header/seen/all"

patterns-established:
  - "APPEND operations bypass mailbox lock/switch pattern since APPEND takes path directly"
  - "SEARCH and DELETE operations follow existing withMailboxSwitch pattern for consistency"

requirements-completed: [SENT-06, SENT-04]

# Metrics
duration: 2min
completed: 2026-04-22
---

# Phase 27 Plan 01: IMAP Sentinel Operations Summary

**ImapClient extended with appendMessage, searchByHeader, deleteMessage methods via TDD for sentinel IMAP transport layer**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-22T03:22:07Z
- **Completed:** 2026-04-22T03:24:21Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Extended ImapFlowLike interface with append, search, messageDelete signatures
- Added AppendResponse and SearchQuery types for type-safe IMAP operations
- Implemented three ImapClient methods with correct mailbox handling patterns
- 11 new tests added, all 52 ImapClient tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for append/search/delete** - `72aa2a3` (test)
2. **Task 1 (GREEN): Implement ImapClient methods** - `24c454c` (feat)
3. **Task 2: Export types from imap barrel** - `c54d525` (chore)

_TDD task had separate RED and GREEN commits._

## Files Created/Modified
- `src/imap/client.ts` - Added AppendResponse/SearchQuery types, ImapFlowLike extensions, three ImapClient methods
- `src/imap/index.ts` - Added AppendResponse, SearchQuery, MailboxLock to type exports
- `test/unit/imap/client.test.ts` - 11 new tests for appendMessage, searchByHeader, deleteMessage

## Decisions Made
- appendMessage does not use withMailboxSwitch because IMAP APPEND accepts folder path as first argument (per imapflow docs and research pitfall 1)
- searchByHeader and deleteMessage use withMailboxSwitch to follow established mailbox selection pattern
- SearchQuery interface includes index signature for future extensibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ImapClient transport methods ready for Plan 02 to build sentinel-specific imap-ops.ts wrappers
- AppendResponse and SearchQuery types exported for downstream consumption

---
*Phase: 27-imap-sentinel-operations*
*Completed: 2026-04-22*
