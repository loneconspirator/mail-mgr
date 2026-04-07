# Coding Conventions

**Analysis Date:** 2026-04-06

## Naming Patterns

**Files:**
- All lowercase with hyphens for multi-word: `client.ts`, `activity.ts`, `review-config.ts`
- Index files named `index.ts` for module exports
- No suffix conventions (not `service.ts`, `handler.ts`, etc.)
- Example: `src/config/repository.ts`, `src/web/routes/review-config.ts`

**Functions:**
- camelCase for all function names
- Verb-first naming: `matchRule()`, `executeAction()`, `evaluateRules()`, `moveMessage()`
- Helper/private functions same naming as public: `executeMove()` (private), `matchRule()` (public)
- Async functions explicitly marked with `async` keyword
- Example: `src/rules/matcher.ts` exports `matchRule()`

**Variables:**
- camelCase for all variables and constants
- Descriptive names: `activityLog`, `imapClient`, `reviewFolder`, `trashFolder`
- Numeric constants with underscores for readability: `MIN_BACKOFF_MS = 1_000`, `MAX_BACKOFF_MS = 60_000`
- Boolean variables start with verb or state: `autoReconnect`, `idleSupported`, `usable`
- Example from `src/imap/client.ts`: `private backoffMs`, `private reconnectTimer`, `private pollTimer`

**Types:**
- PascalCase for all types, interfaces, and classes
- Descriptive singular nouns: `EmailMessage`, `ImapConfig`, `ReviewConfig`, `ActivityEntry`
- Suffix conventions: `*Result`, `*Context`, `*Deps`, `*State` for specific patterns
- Union types use `|`: `ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'`
- Example: `src/config/schema.ts` defines `moveActionSchema`, `ReviewActionSchema`

**Interfaces:**
- PascalCase, prefixed with `I` NOT used (e.g., `EmailMessage` not `IEmailMessage`)
- Event interfaces end in `Events`: `ImapClientEvents`
- Props/dependency interfaces end in `Props`, `Deps`, `Context`: `ActionContext`, `MonitorDeps`, `SweepDeps`
- Response types end in `Response`: `ImapConfigResponse`, `ActivityEntry` (shared API types in `src/shared/types.ts`)

## Code Style

**Formatting:**
- No explicit ESLint or Prettier config detected — appears to follow implicit TypeScript conventions
- Consistent with 2-space indentation throughout codebase
- Line length not formally constrained; typical range 80-120 characters
- No trailing semicolons at end of lines (not a formal rule, just observed inconsistently)

**Linting:**
- Strict TypeScript mode enabled (`"strict": true` in `tsconfig.json`)
- Type annotations required for function parameters and returns
- No `any` type usage observed
- `unknown` type used for external library interfaces when not fully typed

**Type Safety:**
- All function parameters typed: `function matchRule(rule: Rule, message: EmailMessage): boolean`
- Return types always explicit: `executeAction(...): Promise<ActionResult>`
- Type predicates used: `message.from.address`
- Type guards with `instanceof` and `is` checks: `err instanceof Error ? err : new Error(String(err))`

## Import Organization

**Order:**
1. Node.js built-in modules: `import { EventEmitter } from 'events'`, `import fs from 'node:fs'`
2. External dependencies: `import pino from 'pino'`, `import { ImapFlow } from 'imapflow'`
3. Internal modules: `import type { Rule } from '../config/index.js'`, `import { moveMessage } from './messages.js'`
4. Blank line between groups

**Path Aliases:**
- No alias configuration detected
- Relative paths used throughout: `'../config/index.js'`, `'./client.js'`, `'../../src/imap/index.js'`
- Index files explicitly imported: `from '../config/index.js'` (not just `from '../config'`)

**ES Modules:**
- `.js` extension required on all local imports (ESM): `from './index.js'`
- CommonJS fallback in `package.json`: `"type": "commonjs"`
- Import syntax: `import X from 'Y'` and `import type { X } from 'Y'`
- Type-only imports separated: `import type { Rule } from '../config/index.js'`

## Error Handling

**Patterns:**
- Try-catch blocks with typed error handling
- Error messages thrown as `Error` instances: `throw new Error('Not connected')`
- Error context included: `throw new Error(\`Validation failed: ${issues.join(', ')}\`)`
- Fallback error normalization: `const error = err instanceof Error ? err : new Error(String(err))`
- Example from `src/config/repository.ts`:
  ```typescript
  const result = ruleSchema.safeParse(newRule);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Validation failed: ${issues.join(', ')}`);
  }
  ```

**Async Error Handling:**
- `.catch()` handlers at application entry point: `main().catch((err) => { logger.fatal(err, ...); })`
- Explicit async/await with try-catch in functions
- Promise rejection handled: `mockRejectedValue(new Error('...'))`

**Logging:**
- Pino logger used throughout: `import pino from 'pino'`
- Logger created with name: `const logger = pino({ name: 'mail-mgr' })`
- Logging levels: `logger.info()`, `logger.error()`, `logger.debug()`, `logger.fatal()`
- Context objects passed to logger: `logger.error({ uid: msg.uid, error }, 'message')`

## Comments

**When to Comment:**
- Architecture/workflow comments with prefixes: `// H1:`, `// H2:`, `// H3:` in `src/index.ts` explain initialization sequence
- Inline comments explain non-obvious behavior: `// best-effort logout`, `// noop failure will trigger error/close handlers`
- Comments on logic at feature boundaries, not on trivial operations

**JSDoc/TSDoc:**
- JSDoc blocks used for public functions and types
- Format: `/** description */` above function definitions
- Example from `src/rules/matcher.ts`:
  ```typescript
  /**
   * Test whether a single rule matches a message.
   * All specified match fields must match (AND logic).
   * Recipient checks both to and cc.
   * All comparisons are case-insensitive.
   */
  export function matchRule(rule: Rule, message: EmailMessage): boolean
  ```
- No `@param` or `@returns` tags observed — plain description style
- Example from `src/actions/index.ts`:
  ```typescript
  /**
   * Execute the action from a matched rule on a message.
   * For "move" actions: moves the message by UID to the target folder,
   * auto-creating the folder if it doesn't exist.
   */
  ```

## Function Design

**Size:**
- Functions typically 10-50 lines
- Complex logic extracted into helper functions
- Example: `executeMove()` is private helper for `executeAction()` in `src/actions/index.ts`

**Parameters:**
- Maximum 3-4 parameters; use objects for multiple options
- Destruturing from objects common: `const { action } = rule`
- Type parameters used: `async withMailboxLock<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T>`

**Return Values:**
- Always typed explicitly
- Objects returned with consistent shape: `ActionResult` type defines all return fields
- Discriminated unions for variants: `action: 'move' | 'review' | 'skip' | 'delete'` in results

**Async Functions:**
- Used for I/O operations: network calls, file access, database operations
- Return `Promise<T>` explicitly typed
- Parallel execution with `Promise.all()` where applicable
- Retry logic implemented: see `executeMove()` which retries with folder creation

## Module Design

**Exports:**
- Explicit export lists (not default exports except for classes in rare cases)
- Barrel files in `index.ts` consolidate exports from module
- Example from `src/imap/index.ts`:
  ```typescript
  export { ImapClient } from './client.js';
  export type { ConnectionState, ImapClientEvents, ImapFlowLike } from './client.js';
  export { parseMessage } from './messages.js';
  export type { EmailMessage, EmailAddress } from './messages.js';
  ```

**Barrel Files:**
- Used to create clean module boundaries
- Located at `index.ts` in each logical module: `src/config/index.ts`, `src/imap/index.ts`, `src/log/index.ts`
- Re-export types and implementations for public API

**Dependency Injection:**
- Dependencies passed as constructor parameters or function arguments
- Interfaces define dependency shape: `MonitorDeps`, `ActionContext`, `SweepDeps`
- Example from `src/monitor/index.ts`:
  ```typescript
  export interface MonitorDeps {
    imapClient: ImapClient;
    activityLog: ActivityLog;
    logger?: pino.Logger;
  }
  export class Monitor {
    constructor(config: Config, deps: MonitorDeps) { ... }
  }
  ```

---

*Convention analysis: 2026-04-06*
