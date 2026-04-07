# Testing Patterns

**Analysis Date:** 2026-04-06

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts` and `vitest.integration.config.ts`
- Globals enabled: `globals: true` — test globals like `describe`, `it`, `expect` available without imports

**Assertion Library:**
- Vitest built-in assertion library (extends Chai)
- `.toBe()`, `.toHaveLength()`, `.toMatchObject()`, `.toBeInstanceOf()`, `.toBeUndefined()`, `.toBeNull()`

**Run Commands:**
```bash
npm test                    # Run all unit tests (test/**/*.test.ts, exclude integration)
npm run test:integration   # Run only integration tests (test/integration/**/*.test.ts)
npm run test:watch        # Watch mode for unit tests
```

**Test Timeout:**
- Unit tests: default 5 second timeout
- Integration tests: 30 second timeout (`testTimeout: 30_000` in `vitest.integration.config.ts`)

## Test File Organization

**Location:**
- Co-located pattern: tests mirror source directory structure
- Unit tests in `test/unit/` matching `src/` layout
- Integration tests in `test/integration/`

**Naming:**
- All test files: `*.test.ts`
- Examples: `test/unit/rules/matcher.test.ts`, `test/unit/actions/actions.test.ts`

**Structure:**
```
test/
├── unit/
│   ├── rules/
│   │   └── matcher.test.ts
│   ├── actions/
│   │   └── actions.test.ts
│   ├── config/
│   │   ├── config.test.ts
│   │   └── repository.test.ts
│   └── [other unit tests]
├── integration/
│   ├── helpers.ts          # Shared test utilities and fixtures
│   ├── pipeline.test.ts
│   └── sweep.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Feature Name', () => {
  describe('Sub-feature', () => {
    it('does something specific', () => {
      // Arrange
      const input = makeFixture();

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe(expectedValue);
    });
  });
});
```

**Patterns:**
- Nested `describe()` blocks organize related tests
- Single responsibility per `it()` block
- Clear test names: verb-first, describing behavior
- AAA pattern: Arrange, Act, Assert
- Example from `test/unit/rules/matcher.test.ts`:
  ```typescript
  describe('matchRule', () => {
    describe('sender matching', () => {
      it('matches exact sender address', () => {
        const rule = makeRule({ sender: 'alice@example.com' });
        const msg = makeMessage();
        expect(matchRule(rule, msg)).toBe(true);
      });
    });
  });
  ```

**Setup/Teardown:**
- `beforeEach()` and `afterEach()` for per-test setup/cleanup
- Fixture creation in setup, file cleanup in teardown
- Example from `test/unit/config/config.test.ts`:
  ```typescript
  const FIXTURES_DIR = path.join(os.tmpdir(), `mail-mgr-test-${process.pid}`);

  beforeEach(() => {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });
  ```

## Mocking

**Framework:**
- Vitest `vi` module for mocks, spies, stubs
- Import: `import { vi } from 'vitest'`

**Patterns:**

**Creation:**
```typescript
const moveMessage = vi.fn().mockResolvedValue(undefined);
const moveMessage = vi.fn().mockRejectedValue(new Error('Move failed'));
const moveMessage = vi.fn()
  .mockRejectedValueOnce(new Error('First failure'))
  .mockResolvedValueOnce(undefined);  // Chained for sequence
```

**Usage in context objects:**
```typescript
function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    client: {
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient,
    reviewFolder: 'Review',
    trashFolder: 'Trash',
    ...overrides,
  };
}
```

**Assertion:**
```typescript
expect(moveMessage).toHaveBeenCalledWith(42, 'Archive/Test');
expect(moveMessage).toHaveBeenCalledTimes(2);
expect(moveMessage).not.toHaveBeenCalled();
```

**Accessing mocked function in test:**
```typescript
const ctx = makeCtx();
const moveMessage = vi.mocked(ctx.client.moveMessage);  // Get typed mock
const result = await executeAction(ctx, msg, rule);
expect(moveMessage).toHaveBeenCalledWith(42, 'Review');
```

**What to Mock:**
- External dependencies: IMAP client, database, file system
- Event emitters and callbacks
- Time-dependent operations (not done — tests use real `Date.now()`)
- Third-party services

**What NOT to Mock:**
- Core application logic being tested
- Data validation (Zod schemas)
- Helper utilities (`matchRule`, `evaluateRules`)
- Pure functions

## Fixtures and Factories

**Test Data:**

Factory functions create test objects with sensible defaults:
```typescript
function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    uid: 1,
    messageId: '<test@example.com>',
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ name: 'Bob', address: 'bob@example.com' }],
    cc: [],
    subject: 'Hello World',
    date: new Date(),
    flags: new Set(),
    ...overrides,
  };
}

function makeRule(match: Rule['match'], overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    match,
    action: { type: 'move', folder: 'Archive' },
    enabled: true,
    order: 0,
    ...overrides,
  };
}
```

**Location:**
- Factories defined in test files, not extracted to separate utility files
- Integration helpers in `test/integration/helpers.ts`

**Integration Test Helpers:**
- `sendTestEmail()` — send email via SMTP to GreenMail
- `waitForProcessed()` — poll activity log until entry matches predicate
- `waitForMailboxMessage()` — poll IMAP for message in folder
- `listMailboxMessages()` — fetch UIDs from folder
- `clearMailboxes()` — reset GreenMail state
- `TEST_IMAP_CONFIG` — shared test IMAP configuration

Example from `test/integration/helpers.ts`:
```typescript
export async function waitForProcessed(
  activityLog: { getRecentActivity(limit?: number): ActivityEntry[] },
  opts: { timeout?: number; predicate: (entry: ActivityEntry) => boolean },
): Promise<ActivityEntry> {
  const timeout = opts.timeout ?? 10_000;
  const start = Date.now();
  const poll = 250;

  while (Date.now() - start < timeout) {
    const entries = activityLog.getRecentActivity(100);
    const match = entries.find(opts.predicate);
    if (match) return match;
    await sleep(poll);
  }

  throw new Error(`waitForProcessed timed out after ${timeout}ms`);
}
```

## Coverage

**Requirements:** No coverage target enforced

**View Coverage:** Not configured

## Test Types

**Unit Tests:**
- Location: `test/unit/`
- Scope: Single function or class in isolation
- Mocking: Dependencies mocked
- Examples:
  - `test/unit/rules/matcher.test.ts` — tests `matchRule()` with mocked `picomatch`
  - `test/unit/actions/actions.test.ts` — tests `executeAction()` with mocked `ImapClient`
  - `test/unit/sweep/sweep.test.ts` — tests sweep eligibility logic
  - `test/unit/config/repository.test.ts` — tests config persistence and validation

**Integration Tests:**
- Location: `test/integration/`
- Scope: Multiple components working together (Monitor, ActivityLog, IMAP)
- Real Dependencies: Uses GreenMail (SMTP/IMAP test server)
- Fixtures: Real temporary directories for SQLite database
- Examples:
  - `test/integration/pipeline.test.ts` — end-to-end email processing
  - `test/integration/sweep.test.ts` — review folder sweep behavior
  - Timeout: 30 seconds per test

**E2E Tests:**
- Not used — manual testing against real IMAP/SMTP needed

## Common Patterns

**Async Testing:**
```typescript
it('moves a message to the target folder', async () => {
  const ctx = makeCtx();
  const result = await executeAction(ctx, makeMessage(), makeRule());

  expect(result.success).toBe(true);
});
```

**Error Testing:**
```typescript
it('returns error when both move and folder creation fail', async () => {
  const moveMessage = vi.fn().mockRejectedValue(new Error('Move failed'));
  const createMailbox = vi.fn().mockRejectedValue(new Error('Cannot create folder'));
  const ctx = makeCtx({ client: { moveMessage, createMailbox } as unknown as ImapClient });

  const result = await executeAction(ctx, makeMessage(), makeRule());

  expect(result.success).toBe(false);
  expect(result.error).toBe('Cannot create folder');
});
```

**Chained Mock Behavior (Retry Pattern):**
```typescript
it('auto-creates folder and retries when move fails', async () => {
  const moveMessage = vi.fn()
    .mockRejectedValueOnce(new Error('Mailbox not found'))
    .mockResolvedValueOnce(undefined);
  const createMailbox = vi.fn().mockResolvedValue(undefined);
  const ctx = makeCtx({ client: { moveMessage, createMailbox } as unknown as ImapClient });

  const result = await executeAction(ctx, makeMessage(), makeRule());

  expect(result.success).toBe(true);
  expect(createMailbox).toHaveBeenCalledWith('Archive/Test');
  expect(moveMessage).toHaveBeenCalledTimes(2);
});
```

**Date/Time in Tests:**
```typescript
const now = new Date('2026-04-01T00:00:00Z');
const msg = makeReviewMessage({
  internalDate: new Date('2026-03-20T00:00:00Z'), // 12 days old
});
expect(isEligibleForSweep(msg, config, now)).toBe(true);
```

**Snapshot/Object Matching:**
```typescript
expect(result).toMatchObject({
  success: true,
  messageUid: 99,
  messageId: '<special@test.com>',
  action: 'move',
  folder: 'Dev/OSS',
});
```

---

*Testing analysis: 2026-04-06*
