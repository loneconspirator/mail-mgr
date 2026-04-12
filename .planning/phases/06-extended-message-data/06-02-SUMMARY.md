---
phase: 06-extended-message-data
plan: 02
subsystem: imap
tags: [message-types, header-parsing, visibility, config-schema]
dependency_graph:
  requires: []
  provides: [EmailMessage.envelopeRecipient, EmailMessage.visibility, parseHeaderLines, classifyVisibility, ImapConfig.envelopeHeader]
  affects: [src/imap/messages.ts, src/imap/client.ts, src/imap/index.ts, src/config/schema.ts]
tech_stack:
  added: []
  patterns: [RFC 2822 header parsing, visibility classification priority chain, conditional IMAP fetch query]
key_files:
  created: []
  modified:
    - src/imap/messages.ts
    - src/imap/client.ts
    - src/imap/index.ts
    - src/config/schema.ts
    - test/unit/imap/messages.test.ts
    - test/unit/imap/client.test.ts
decisions:
  - "Visibility type is a union 'list' | 'direct' | 'cc' | 'bcc' with strict priority ordering"
  - "parseHeaderLines handles RFC 2822 folded headers and returns lowercase keys"
  - "parseMessage accepts optional envelopeHeader param to conditionally extract header data"
  - "getHeaderFields() centralizes header list for all fetch methods"
metrics:
  duration: ~4min
  completed: "2026-04-12T03:39:00Z"
  tasks_completed: 2
  tasks_total: 2
  test_count: 85
  test_pass: 85
---

# Phase 6 Plan 02: Extended Message Types and Header Fetching Summary

Extended EmailMessage and ReviewMessage with envelope recipient and visibility fields, added RFC 2822 header parsing with classifyVisibility priority chain (list > direct > cc > bcc), and conditional IMAP header fetching via getHeaderFields().

## Task Results

| Task | Name | Commit(s) | Files |
|------|------|-----------|-------|
| 1 | Extend message types with header parsing and visibility classification | 8e68631 (RED), 6c214c5 (GREEN) | src/imap/messages.ts, src/imap/index.ts, test/unit/imap/messages.test.ts |
| 2 | Add conditional header fetching to ImapClient and extend config schema | 6d3c583 (RED), 1f7f242 (GREEN) | src/imap/client.ts, src/config/schema.ts, test/unit/imap/client.test.ts |

## What Was Built

### Message Type Extensions (src/imap/messages.ts)
- Added `Visibility` type: `'list' | 'direct' | 'cc' | 'bcc'`
- Added `envelopeRecipient?: string` and `visibility?: Visibility` to both `EmailMessage` and `ReviewMessage`
- Added `headers?: Buffer` to `ImapFetchResult`
- `parseHeaderLines()`: Parses raw RFC 2822 header Buffer into lowercase key Map with folding support
- `classifyVisibility()`: Derives visibility from envelope recipient, To/CC addresses, and List-Id
- `parseMessage()`: Now accepts optional `envelopeHeader` param to extract and classify headers
- `reviewMessageToEmailMessage()`: Passes through new fields

### Conditional Header Fetching (src/imap/client.ts)
- `getHeaderFields()`: Returns `[envelopeHeader, 'List-Id']` when configured, undefined otherwise
- `fetchNewMessages()`: Conditionally includes headers in IMAP FETCH query
- `fetchAllMessages()`: Conditionally includes headers in IMAP FETCH query
- `parseRawToReviewMessage()`: Extracts envelopeRecipient and visibility from headers Buffer

### Config Schema Extension (src/config/schema.ts)
- Added `envelopeHeader: z.string().min(1).optional()` to `imapConfigSchema`
- Backward compatible: existing configs without envelopeHeader continue to work

## Decisions Made

1. **Visibility as union type** -- `'list' | 'direct' | 'cc' | 'bcc'` with strict priority per D-07
2. **Header parsing validates '@'** -- Extracted envelope recipient must contain '@' before being accepted (T-06-02 mitigation)
3. **Centralized header list** -- `getHeaderFields()` ensures all fetch methods use consistent header set

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `npx vitest run test/unit/imap/messages.test.ts`: 31 tests pass
- `npx vitest run test/unit/imap/client.test.ts`: 54 tests pass
- `npx vitest run`: 367 pass, 4 pre-existing failures in frontend.test.ts (unrelated static file serving tests)

## Self-Check: PASSED

- All 6 modified files verified present
- All 4 commits verified: 8e68631, 6c214c5, 6d3c583, 1f7f242
- 423 lines added across 6 files
