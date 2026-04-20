# Phase 19: Action Processing Core - Research

**Researched:** 2026-04-20
**Domain:** IMAP action folder message processing, rule CRUD, sender extraction
**Confidence:** HIGH

## Summary

Phase 19 delivers the `ActionFolderProcessor` class -- the core processing logic that takes a message found in an action folder and executes the corresponding rule operation (create VIP, block sender, undo VIP, unblock). It builds directly on Phase 18's building blocks: `ACTION_REGISTRY` for declarative action lookup, `findSenderRule()`/`isSenderOnly()` for conflict detection, `configRepo.addRule()`/`deleteRule()` for rule persistence, and `logActivity()` with `'action-folder'` source.

The codebase already has every primitive needed. The processor is a pure orchestration layer that wires these together in the correct sequence: extract sender, check conflicts, create/remove rule, move message, log activity. No new libraries are needed. No new database schema. No new IMAP operations beyond the existing `moveMessage()`.

**Primary recommendation:** Build a single `ActionFolderProcessor` class with constructor DI and one public method `processMessage(message, actionType)`. All building blocks exist -- this is glue code with good test coverage.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Class-based processor (`ActionFolderProcessor`) with constructor-injected dependencies (ConfigRepository, ImapClient, ActivityLog, Logger)
- D-02: Single public method `processMessage(message, actionType)` returning result object
- D-03: Processor lives in `src/action-folders/processor.ts`, exported from `src/action-folders/index.ts`
- D-04: Parse sender from From header, normalize to lowercase bare email
- D-05: Dedicated `extractSender(message)` utility function within the processor module
- D-06: Unparseable From: move to INBOX, log error, return early (no throw)
- D-07: Use `configRepo.addRule()` for Zod validation path
- D-08: Rule names: `"VIP: sender@example.com"`, `"Block: sender@example.com"`
- D-09: Rules appended at end via `addRule()` push
- D-10: Remove operations use `findSenderRule()` + `configRepo.deleteRule(id)`
- D-11: Create operations check for conflicting sender-only rules via `findSenderRule()` with opposite action
- D-12: Conflict: remove conflicting rule first, then create new. Log both as separate activity entries
- D-13: Multi-field rules for same sender are preserved (use `isSenderOnly()` to distinguish)
- D-14: Move message to final destination via `ImapClient.moveMessage()`
- D-15: Resolve abstract destinations ('inbox', 'trash') from config at runtime
- D-16: If message move fails: log error, don't roll back rule changes

### Claude's Discretion
- Internal type for processMessage return value (success/error result shape)
- Whether extractSender uses a regex or a small parser library
- Error message wording for unparseable From addresses
- Whether conflict check and rule creation are wrapped in a single method or kept as sequential steps
- Test fixture structure for mock messages and rules

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROC-01 | VIP sender: creates sender-only skip rule, message returned to INBOX | ACTION_REGISTRY.vip defines operation='create', ruleAction='skip', destination='inbox'; configRepo.addRule() handles creation with Zod validation |
| PROC-02 | Block sender: creates sender-only delete rule, message moved to Trash | ACTION_REGISTRY.block defines operation='create', ruleAction='delete', destination='trash'; trashFolder resolved from review config |
| PROC-03 | Undo VIP: removes matching sender-only skip rule, message returned to INBOX | findSenderRule(sender, 'skip', rules) locates the rule; configRepo.deleteRule(id) removes it |
| PROC-04 | Unblock sender: removes matching sender-only delete rule, message returned to INBOX | findSenderRule(sender, 'delete', rules) locates the rule; configRepo.deleteRule(id) removes it |
| PROC-05 | Sender extracted as lowercase bare email | extractSender utility parses EmailMessage.from.address, lowercases |
| PROC-06 | Unparseable From: move to INBOX, log error | Return early with error result, caller-provided INBOX path for move |
| PROC-09 | Conflicting sender-only rule removed and replaced, both logged | findSenderRule with opposite ruleAction detects conflict; delete then add; two logActivity calls |
| PROC-10 | More specific rules (multi-field) preserved, action folder rule appended after | isSenderOnly() distinguishes; addRule() appends at end naturally |
| RULE-01 | Rules pass same Zod validation as web UI | configRepo.addRule() uses ruleSchema.safeParse internally |
| RULE-02 | Rules have UUID and descriptive name | addRule() generates crypto.randomUUID(); name pattern "VIP: sender@example.com" |
| RULE-03 | Rules appended at end of rule list | addRule() calls this.config.rules.push() |
| RULE-04 | Rules indistinguishable from web UI rules in views | Same Rule type, same Zod schema, same configRepo path |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^4.3.6 | Rule validation | Already in project, used by configRepo.addRule() [VERIFIED: package.json] |
| pino | ^10.3.0 | Structured logging | Already in project, Logger type used across codebase [VERIFIED: package.json] |
| vitest | ^4.0.18 | Unit testing | Already in project, all tests use vitest [VERIFIED: package.json] |

### Supporting
No new libraries needed. All building blocks exist in the codebase.

**Installation:**
```bash
# No new packages required
```

## Architecture Patterns

### Recommended Project Structure
```
src/action-folders/
  processor.ts          # NEW: ActionFolderProcessor class
  registry.ts           # EXISTS: ACTION_REGISTRY (Phase 18)
  folders.ts            # EXISTS: ensureActionFolders (Phase 18)
  index.ts              # EXISTS: re-exports (add processor export)

test/unit/action-folders/
  processor.test.ts     # NEW: processor unit tests
  registry.test.ts      # EXISTS (Phase 18)
  folders.test.ts       # EXISTS (Phase 18)
```

### Pattern 1: Class with Constructor DI
**What:** Stateful processor with injected dependencies, matching MoveTracker/BatchEngine pattern
**When to use:** Components that orchestrate multiple subsystems
**Example:**
```typescript
// Source: Codebase pattern from src/batch/index.ts, src/tracking/tracker.ts
export class ActionFolderProcessor {
  constructor(
    private readonly configRepo: ConfigRepository,
    private readonly client: ImapClient,
    private readonly activityLog: ActivityLog,
    private readonly logger: Logger,
    private readonly inboxFolder: string,    // resolved at construction
    private readonly trashFolder: string,    // resolved at construction
  ) {}

  async processMessage(
    message: EmailMessage,
    actionType: ActionType,
  ): Promise<ProcessResult> {
    // 1. Extract sender
    // 2. Look up action definition from registry
    // 3. Check conflicts (create ops) or find existing rule (remove ops)
    // 4. Execute rule operation
    // 5. Move message to destination
    // 6. Log activity
    // 7. Return result
  }
}
```
[VERIFIED: codebase pattern from BatchEngine, MoveTracker constructors]

### Pattern 2: Result Object (non-throwing)
**What:** Return a typed result instead of throwing on expected errors
**When to use:** When callers need to handle both success and expected-error cases without try/catch
**Example:**
```typescript
export type ProcessResult =
  | { ok: true; action: ActionType; sender: string; ruleId?: string }
  | { ok: false; action: ActionType; error: string };
```
This matches D-06 (no throw on unparseable From) and D-16 (log error on move failure but don't roll back). The processor never throws for expected conditions -- only for genuinely unexpected failures (dependency injection missing, etc).
[ASSUMED -- discretion area, shape is recommendation]

### Pattern 3: Sender Extraction via Regex
**What:** Parse bare email from From header using simple regex
**When to use:** When the input is already structured (EmailMessage.from.address is pre-parsed by imapflow envelope)
**Example:**
```typescript
export function extractSender(message: EmailMessage): string | null {
  const raw = message.from?.address;
  if (!raw || !raw.includes('@')) return null;
  // Address is already parsed by imapflow envelope -- just lowercase it
  return raw.toLowerCase().trim();
}
```
**Key insight:** The EmailMessage.from.address field is already extracted from the IMAP envelope by `parseMessage()` in `src/imap/messages.ts`. It's already a bare email string (no display name). The only work needed is validation (contains @) and lowercasing. No need for RFC 5322 parsing.
[VERIFIED: src/imap/messages.ts parseAddress() returns { name, address } from envelope]

### Anti-Patterns to Avoid
- **Throwing on expected errors:** D-06 and D-16 explicitly say don't throw. Return result objects.
- **Hardcoding folder paths:** Destinations come from ACTION_REGISTRY (abstract) and resolve to config values at runtime per D-15.
- **Rolling back on partial failure:** D-16 says rule changes are the user's intent. A stuck message retries on next poll.
- **Creating rules without using configRepo.addRule():** Must go through the existing Zod validation path per RULE-01.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rule validation | Custom validation | `configRepo.addRule()` with Zod | Already validates, generates UUID, persists, notifies listeners |
| Conflict detection | Manual rule array scan | `findSenderRule()` from sender-utils.ts | Handles case-insensitivity, enabled check, sender-only check |
| Sender-only check | Inline field checks | `isSenderOnly()` from sender-utils.ts | Canonical definition of what "sender-only" means across codebase |
| Action type lookup | Switch/if chains | `ACTION_REGISTRY[actionType]` | Declarative, type-safe, already tested |
| Email address parsing | RFC 5322 parser | `message.from.address` (already parsed) | imapflow envelope parsing already did the heavy lifting |

**Key insight:** Phase 18 built all the primitives specifically so this phase could be pure orchestration. Every building block is tested and ready.

## Common Pitfalls

### Pitfall 1: Conflict Detection Direction
**What goes wrong:** Checking for conflicts with the SAME action type instead of the OPPOSITE
**Why it happens:** "VIP" and "Block" are opposites (skip vs delete), not the same action
**How to avoid:** Per D-11: for create operations, check `findSenderRule(sender, oppositeRuleAction, rules)`. VIP (skip) conflicts with existing Block (delete) rules, and vice versa.
**Warning signs:** Test creates a VIP rule when a Block rule already exists for the same sender, and both survive

### Pitfall 2: Order Value for New Rules
**What goes wrong:** Creating a rule with order=0 or duplicate order, causing sort collisions
**Why it happens:** `addRule()` doesn't auto-assign order -- caller must provide it
**How to avoid:** Use `configRepo.nextOrder()` to get the next order value before calling `addRule()`. This returns `max(existing orders) + 1`.
**Warning signs:** New rules appear at top of list instead of bottom, or rules reorder unexpectedly

### Pitfall 3: Source Folder for Message Move
**What goes wrong:** Trying to move message from INBOX instead of from the action folder
**Why it happens:** `moveMessage(uid, destination, sourceFolder)` defaults to 'INBOX'
**How to avoid:** The processor must know which action folder the message came from. The source folder path is `${config.prefix}/${config.folders[actionDef.folderConfigKey]}`. Pass this as the sourceFolder parameter.
**Warning signs:** IMAP errors about message UID not found (wrong mailbox selected)

### Pitfall 4: Activity Log Expects ActionResult Shape
**What goes wrong:** Passing wrong shape to `logActivity()` 
**Why it happens:** `logActivity(result, message, rule, source)` expects an `ActionResult` with specific fields
**How to avoid:** Construct a proper `ActionResult` object: `{ success, messageUid, messageId, action, folder, rule: ruleId, timestamp }`. The `action` field maps to the disposition action type ('skip', 'delete') and `rule` is the rule ID string.
**Warning signs:** Activity log entries with null fields or wrong action types

### Pitfall 5: Remove Operation When No Rule Exists
**What goes wrong:** Calling deleteRule with undefined id when findSenderRule returns nothing
**Why it happens:** User moves message to "Undo VIP" but no VIP rule exists for that sender
**How to avoid:** PROC-08 (Phase 21 scope) covers this edge case, but the processor should still handle it gracefully -- if no rule found for remove, just move message to destination and return. Don't crash.
**Warning signs:** TypeError: Cannot read property 'id' of undefined

## Code Examples

### Core Processing Flow
```typescript
// Source: Derived from CONTEXT.md decisions D-01 through D-16
async processMessage(
  message: EmailMessage,
  actionType: ActionType,
): Promise<ProcessResult> {
  const actionDef = ACTION_REGISTRY[actionType];
  
  // 1. Extract sender
  const sender = extractSender(message);
  if (!sender) {
    this.logger.error({ uid: message.uid }, 'Unparseable From address');
    await this.moveToInbox(message, actionType);
    return { ok: false, action: actionType, error: 'Unparseable From address' };
  }

  const rules = this.configRepo.getRules();

  if (actionDef.operation === 'create') {
    // 2. Check for conflicting sender-only rule (opposite action)
    const oppositeAction = actionDef.ruleAction === 'skip' ? 'delete' : 'skip';
    const conflict = findSenderRule(sender, oppositeAction, rules);
    if (conflict) {
      this.configRepo.deleteRule(conflict.id);
      this.logRemoval(message, conflict);
    }
    // 3. Create new rule
    const rule = this.configRepo.addRule({
      name: `${actionType === 'vip' ? 'VIP' : 'Block'}: ${sender}`,
      match: { sender },
      action: { type: actionDef.ruleAction },
      enabled: true,
      order: this.configRepo.nextOrder(),
    });
    this.logCreation(message, rule, actionType);
  } else {
    // Remove operation
    const existing = findSenderRule(sender, actionDef.ruleAction, rules);
    if (existing) {
      this.configRepo.deleteRule(existing.id);
      this.logRemoval(message, existing);
    }
  }

  // 4. Move message to destination
  await this.moveMessage(message, actionDef, actionType);
  return { ok: true, action: actionType, sender };
}
```

### Destination Resolution
```typescript
// Source: D-15, existing codebase patterns from src/index.ts
private resolveDestination(destination: 'inbox' | 'trash'): string {
  return destination === 'inbox' ? this.inboxFolder : this.trashFolder;
}
```
INBOX is always 'INBOX' in IMAP. Trash folder comes from `config.review.trashFolder` (same pattern used by Monitor, BatchEngine, Sweep).
[VERIFIED: src/index.ts lines 62, 71, 259-265]

### Source Folder Path Construction
```typescript
// Source: folders.ts pattern for constructing action folder paths
private getSourceFolder(actionType: ActionType): string {
  const actionDef = ACTION_REGISTRY[actionType];
  const config = this.configRepo.getActionFolderConfig();
  return `${config.prefix}/${config.folders[actionDef.folderConfigKey]}`;
}
```
[VERIFIED: src/action-folders/folders.ts line 42 uses same pattern]

### Mock Pattern for Tests
```typescript
// Source: test/unit/action-folders/folders.test.ts pattern
function createMockClient() {
  return {
    moveMessage: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ messages: 0, unseen: 0 }),
  } as unknown as ImapClient;
}

function createMockConfigRepo(rules: Rule[] = []) {
  return {
    getRules: vi.fn().mockReturnValue(rules),
    addRule: vi.fn().mockImplementation((input) => ({
      ...input,
      id: 'generated-uuid',
    })),
    deleteRule: vi.fn().mockReturnValue(true),
    nextOrder: vi.fn().mockReturnValue(rules.length),
    getActionFolderConfig: vi.fn().mockReturnValue(DEFAULT_CONFIG),
  } as unknown as ConfigRepository;
}

function createMockActivityLog() {
  return {
    logActivity: vi.fn(),
  } as unknown as ActivityLog;
}
```
[VERIFIED: follows exact mock patterns from test/unit/action-folders/folders.test.ts]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ProcessResult discriminated union `{ ok: true/false }` shape is optimal | Architecture Patterns | Low -- discretion area, planner can adjust |
| A2 | INBOX folder is always 'INBOX' string in IMAP | Code Examples | Low -- standard IMAP convention, used throughout codebase |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts (implied from package.json) |
| Quick run command | `npx vitest run test/unit/action-folders/processor.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROC-01 | VIP creates skip rule, moves to INBOX | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "vip"` | Wave 0 |
| PROC-02 | Block creates delete rule, moves to Trash | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "block"` | Wave 0 |
| PROC-03 | Undo VIP removes skip rule, moves to INBOX | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "undoVip"` | Wave 0 |
| PROC-04 | Unblock removes delete rule, moves to INBOX | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "unblock"` | Wave 0 |
| PROC-05 | Sender extracted as lowercase bare email | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "extractSender"` | Wave 0 |
| PROC-06 | Unparseable From moves to INBOX, logs error | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "unparseable"` | Wave 0 |
| PROC-09 | Conflicting rule removed and replaced | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "conflict"` | Wave 0 |
| PROC-10 | Multi-field rules preserved | unit | `npx vitest run test/unit/action-folders/processor.test.ts -t "specific"` | Wave 0 |
| RULE-01 | Rules pass Zod validation | unit | Covered by addRule() mock verifying correct shape | Wave 0 |
| RULE-02 | Rules have UUID and descriptive name | unit | Covered by PROC-01/02 tests checking name pattern | Wave 0 |
| RULE-03 | Rules appended at end | unit | Verify nextOrder() called, addRule() receives correct order | Wave 0 |
| RULE-04 | Rules indistinguishable from web UI | unit | Covered by Zod validation path (same as web UI) | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/action-folders/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
- [ ] `test/unit/action-folders/processor.test.ts` -- covers PROC-01 through PROC-06, PROC-09, PROC-10, RULE-01 through RULE-04

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A (IMAP auth handled upstream) |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A (single-user system) |
| V5 Input Validation | yes | Zod schema via configRepo.addRule(); extractSender validates email format |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed From header injection | Tampering | extractSender validates @ presence; Zod validates rule shape |
| Rule injection via crafted email | Tampering | addRule() Zod validation rejects invalid rule shapes |

## Sources

### Primary (HIGH confidence)
- Codebase: `src/action-folders/registry.ts` -- ACTION_REGISTRY definition
- Codebase: `src/rules/sender-utils.ts` -- findSenderRule(), isSenderOnly()
- Codebase: `src/config/repository.ts` -- addRule(), deleteRule(), nextOrder(), getRules()
- Codebase: `src/log/index.ts` -- logActivity() with 'action-folder' source
- Codebase: `src/imap/client.ts` -- moveMessage() with sourceFolder param
- Codebase: `src/imap/messages.ts` -- EmailMessage type, parseMessage(), parseAddress()
- Codebase: `src/actions/index.ts` -- ActionResult interface
- Codebase: `src/config/schema.ts` -- Rule type, ruleSchema, actionSchema
- Codebase: `test/unit/action-folders/` -- existing test patterns

### Secondary (MEDIUM confidence)
- None needed -- all findings from codebase analysis

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed, all verified in package.json
- Architecture: HIGH -- follows existing codebase patterns, all building blocks verified
- Pitfalls: HIGH -- derived from actual code analysis of method signatures and call patterns

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable -- internal codebase, no external dependency changes expected)
