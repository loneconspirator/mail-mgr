# WBS 9.1 — IMAP Integration Tests Design

## Goal

Validate the full mail-mgr pipeline end-to-end against a real IMAP server, with no mocks. Edge cases remain in unit tests; integration tests cover normal operation only.

## Test Infrastructure

### GreenMail (Docker)

A separate `docker-compose.test.yaml` adds a GreenMail container:

- **Image:** `greenmail/standalone`
- **IMAP:** port 3143
- **SMTP:** port 3025
- GreenMail auto-creates users on first login, so no provisioning needed

### Directory Layout

```
test/
  integration/
    helpers.ts        # SMTP send, IMAP mailbox assertions, wait utilities
    pipeline.test.ts  # Full pipeline integration tests
docker-compose.test.yaml
```

### npm Script

```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

A separate vitest config points at `test/integration/` only.

### Dependencies

- `nodemailer` (dev) — send test emails to GreenMail via SMTP

## Helper Module (`test/integration/helpers.ts`)

- `sendTestEmail(opts: { from, to, subject, body })` — sends via SMTP to GreenMail on port 3025
- `waitForProcessed(activityLog, opts: { timeout, predicate })` — polls activity log until a matching entry appears or timeout
- `listMailboxMessages(folder, imapConfig)` — connects to GreenMail via IMAP and lists UIDs in a folder (for assertions)
- `clearMailboxes(imapConfig)` — deletes all messages to reset state between tests

## Test Suite: Full Pipeline

### Test 1: "rule match moves email to target folder"

1. **Config:** One rule — sender matches `test@sender.com` -> move to `Processed`
2. **Start** Monitor with real ImapClient connected to GreenMail
3. **Send** email from `test@sender.com` to `user@localhost` via SMTP
4. **Wait** for activity log entry (up to 10s)
5. **Assert:**
   - INBOX has no messages
   - `Processed` folder contains the message
   - Activity log entry records: matched rule ID, action "move", destination "Processed", success
6. **Teardown:** Stop monitor

### Test 2: "no rule match leaves email in INBOX"

1. **Config:** Same rule (sender matches `test@sender.com`)
2. **Start** Monitor
3. **Send** email from `nomatch@other.com` to `user@localhost`
4. **Wait** for processing (up to 10s)
5. **Assert:**
   - INBOX still contains the message
   - Activity log records no rule matched
6. **Teardown:** Stop monitor

## What Is NOT Covered Here

These are covered by existing unit tests and do not need integration-level testing:

- IDLE cycling mechanics
- Poll fallback when IDLE is unsupported
- Reconnect with exponential backoff
- Rule evaluation edge cases (glob patterns, multiple match fields)
- Config validation and loading

## Files to Create/Modify

| File | Action |
|------|--------|
| `docker-compose.test.yaml` | Create — GreenMail service |
| `vitest.integration.config.ts` | Create — points at test/integration |
| `test/integration/helpers.ts` | Create — SMTP send, IMAP assertions, wait utils |
| `test/integration/pipeline.test.ts` | Create — the two test cases |
| `package.json` | Modify — add `test:integration` script, `nodemailer` devDep |
