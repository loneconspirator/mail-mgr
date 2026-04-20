# Phase 17: Configuration & Folder Lifecycle - Research

**Researched:** 2026-04-20
**Domain:** Zod config schema extension + IMAP folder creation
**Confidence:** HIGH

## Summary

Phase 17 is the pure foundation phase for v0.6 Action Folders. It delivers two things: (1) a Zod schema for the `actionFolders` config section with sensible defaults and full configurability, and (2) lazy IMAP folder creation that runs on first poll (not startup), checking existence via `status()` before creating. No processor, no polling timer, no action handling -- just config and folders.

The existing codebase already provides every pattern needed. The `reviewConfigSchema` with its `z.object({}).default({})` pattern is the exact template for the new `actionFolderConfigSchema`. The `ImapClient` already wraps `mailboxCreate` and the `ImapFlowLike` interface already accepts `string | string[]` for array-form paths. The `ConfigRepository` already has the callback pattern (`onReviewConfigChange`, `onImapConfigChange`) that the new `onActionFolderConfigChange` follows.

**Primary recommendation:** Follow the established config schema patterns exactly. Extend `configSchema` with `actionFolders: actionFolderConfigSchema.default({})`, update `createMailbox` to accept `string[]` for separator safety, and add the `onActionFolderConfigChange` callback to `ConfigRepository`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Top-level `actionFolders` section in config YAML, parallel to `imap`, `server`, `rules`, `review`. Not nested under any existing section.
- **D-02:** Default prefix is `Actions`
- **D-03:** Default sub-folder names use emoji prefixes: ⭐ VIP Sender, 🚫 Block Sender, ↩️ Undo VIP, ✅ Unblock Sender
- **D-04:** Both prefix and individual folder names are fully configurable in the schema (per-folder `name` overrides alongside `prefix`)
- **D-05:** `enabled: boolean` (default true). When disabled: don't create folders, don't monitor, ignore existing folders on server. Simple early-return in start(), matching MoveTracker pattern.
- **D-06:** Default poll interval is 15 seconds. Configurable via `pollInterval` in the `actionFolders` config section.
- **D-07:** Lazy creation on first poll, not eager at startup. Folders are created when monitoring starts, not during the startup sequence itself.
- **D-08:** Check existence first via `status()` call, only create if missing. No try/catch-already-exists pattern.
- **D-09:** On creation failure: log error, disable action folder monitoring, continue startup. Graceful degradation -- rest of the app works fine.
- **D-10:** Action folder initialization happens after IMAP connect but before sweeper/MoveTracker start. Natural position in startup sequence.
- **D-11:** Add `onActionFolderConfigChange` callback to ConfigRepository following the established hot-reload pattern. On change: stop polling, re-read config, create any new folders, restart polling.
- **D-12:** Config + folder creation only. No processor skeleton, no polling timer, no action handling. Clean boundary -- Phase 18+ adds processing infrastructure.

### Claude's Discretion
- Exact Zod schema field names and nesting within `actionFolders`
- Config YAML formatting and comments in default.yml
- Specific log messages and log levels for creation/failure events
- How `status()` check maps to folder existence detection
- Internal helper function naming and organization

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONF-01 | Action folder prefix and folder names are configurable with sensible defaults | Zod schema with `.default()` pattern from reviewConfigSchema; emoji-prefixed defaults per D-03 |
| CONF-02 | Action folders can be enabled/disabled via config | `enabled: z.boolean().default(true)` following moveTrackingConfigSchema pattern |
| CONF-03 | Poll interval is configurable | `pollInterval: z.number().int().positive().default(15)` in seconds, following scanInterval pattern |
| FOLD-01 | System creates Actions/ folder hierarchy on startup if folders don't exist | `ImapClient.createMailbox` with array-form paths; status() existence check; lazy on first poll per D-07 |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 (installed) | Config schema definition and validation | Already used for all config schemas in project [VERIFIED: npm ls] |
| imapflow | 1.2.8 (installed) | IMAP folder creation via `mailboxCreate`, existence check via `status()` | Already used throughout project; `mailboxCreate(string\|string[])` in interface [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| yaml | (installed) | Config file serialization via existing loader.ts | Already used by saveConfig/loadConfig [VERIFIED: codebase] |
| pino | (installed) | Logging folder creation events | Already used as project logger [VERIFIED: codebase] |

### Alternatives Considered
None -- this phase uses only existing dependencies. No new packages needed. [VERIFIED: codebase analysis]

## Architecture Patterns

### Recommended Project Structure
```
src/
  config/
    schema.ts          # ADD actionFolderConfigSchema, extend configSchema
    repository.ts      # ADD onActionFolderConfigChange callback, getActionFolderConfig()
    loader.ts          # NO CHANGES
  action-folders/
    folders.ts         # NEW: ensureActionFolders() - existence check + creation
    index.ts           # NEW: re-exports
config/
  default.yml          # ADD actionFolders section with commented defaults
test/
  unit/
    config/
      action-folders.test.ts  # NEW: schema validation tests
    action-folders/
      folders.test.ts         # NEW: folder creation logic tests
```

### Pattern 1: Zod Schema with Section Defaults
**What:** Define a nested Zod schema for a config section where the entire section is optional and defaults to sensible values.
**When to use:** Adding a new top-level config section that existing configs don't have.
**Example:**
```typescript
// Source: src/config/schema.ts (existing reviewConfigSchema pattern)
const actionFolderDefaults = {
  enabled: true,
  prefix: 'Actions',
  pollInterval: 15,
  folders: {
    vip: '\u2B50 VIP Sender',
    block: '\uD83D\uDEAB Block Sender',
    undoVip: '\u21A9\uFE0F Undo VIP',
    unblock: '\u2705 Unblock Sender',
  },
} as const;

export const actionFolderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  prefix: z.string().min(1).default('Actions'),
  pollInterval: z.number().int().positive().default(15),
  folders: z.object({
    vip: z.string().min(1).default('\u2B50 VIP Sender'),
    block: z.string().min(1).default('\uD83D\uDEAB Block Sender'),
    undoVip: z.string().min(1).default('\u21A9\uFE0F Undo VIP'),
    unblock: z.string().min(1).default('\u2705 Unblock Sender'),
  }).default({}),
});

// In configSchema:
export const configSchema = z.object({
  imap: imapConfigSchema,
  server: serverConfigSchema,
  rules: z.array(ruleSchema).default([]),
  review: reviewConfigSchema.default(reviewDefaults),
  actionFolders: actionFolderConfigSchema.default(actionFolderDefaults), // NEW
});
```
[VERIFIED: existing pattern in schema.ts lines 94-136]

### Pattern 2: ConfigRepository Callback Registration
**What:** Add a typed listener array and a registration method for config change events.
**When to use:** Any config section that needs hot-reload support.
**Example:**
```typescript
// Source: src/config/repository.ts (existing onReviewConfigChange pattern)
private actionFolderListeners: Array<(config: ActionFolderConfig) => Promise<void>> = [];

onActionFolderConfigChange(fn: (config: ActionFolderConfig) => Promise<void>): void {
  this.actionFolderListeners.push(fn);
}

async updateActionFolderConfig(input: Partial<ActionFolderConfig>): Promise<ActionFolderConfig> {
  const merged = { ...this.config.actionFolders, ...input };
  const result = actionFolderConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Validation failed: ${issues.join(', ')}`);
  }
  this.config.actionFolders = result.data;
  this.persist();
  for (const fn of this.actionFolderListeners) {
    await fn(result.data);
  }
  return result.data;
}

getActionFolderConfig(): ActionFolderConfig {
  return this.config.actionFolders;
}
```
[VERIFIED: existing pattern in repository.ts lines 106-127]

### Pattern 3: Array-Form Folder Creation with Existence Check
**What:** Check folder existence via `status()` before creating, use array-form paths for separator safety.
**When to use:** Creating IMAP folder hierarchies that must work across servers with different separators.
**Example:**
```typescript
// Source: imapflow docs + codebase ImapFlowLike interface line 26, 29
async function ensureActionFolders(
  client: ImapClient,
  config: ActionFolderConfig,
  logger: pino.Logger,
): Promise<boolean> {
  const folderPaths = [
    [config.prefix, config.folders.vip],
    [config.prefix, config.folders.block],
    [config.prefix, config.folders.undoVip],
    [config.prefix, config.folders.unblock],
  ];

  for (const pathParts of folderPaths) {
    const fullPath = pathParts.join('/'); // for status() call
    try {
      await client.status(fullPath);
      logger.debug('Action folder already exists: %s', fullPath);
    } catch {
      // status() throws if folder doesn't exist
      try {
        await client.createMailbox(pathParts); // array form
        logger.info('Created action folder: %s', fullPath);
      } catch (err) {
        logger.error({ err }, 'Failed to create action folder: %s', fullPath);
        return false; // signal failure -> disable monitoring per D-09
      }
    }
  }
  return true;
}
```
[VERIFIED: ImapFlowLike.status() at client.ts:29, mailboxCreate(string|string[]) at client.ts:26]

### Pattern 4: MoveTracker-Style Enabled Guard
**What:** Simple boolean check at the start of `start()` that returns early when disabled.
**When to use:** Feature toggle that completely disables a component.
**Example:**
```typescript
// Source: src/tracking/index.ts lines 72-75
start(): void {
  if (!this.deps.enabled) {
    return;
  }
  // ... rest of initialization
}
```
[VERIFIED: codebase src/tracking/index.ts:72-75]

### Anti-Patterns to Avoid
- **Eager folder creation at startup:** D-07 says lazy on first poll. Don't create folders in the startup sequence before monitoring starts.
- **String-form mailboxCreate:** Always use array form `['Actions', 'VIP Sender']` for separator safety. The server might use `.` instead of `/`. [VERIFIED: PITFALLS.md Pitfall 3]
- **try/catch-already-exists pattern:** D-08 says check via `status()` first. Don't blindly create and catch errors.
- **Nesting under existing config section:** D-01 says top-level parallel to `imap`, `server`, `rules`, `review`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config validation | Manual field checks | Zod schema with `.default()` | Existing pattern, type-safe, consistent with project |
| YAML serialization | Custom writer | Existing `saveConfig` from loader.ts | Already handles env var preservation, atomic writes |
| Folder path encoding | Manual UTF-7 encoding | ImapFlow's `mailboxCreate(string[])` | ImapFlow handles modified UTF-7 encoding automatically |
| Config hot-reload | File watching | ConfigRepository callback pattern | Already proven with rules, IMAP, and review config |

## Common Pitfalls

### Pitfall 1: IMAP Hierarchy Separator Creates Wrong Folder Structure
**What goes wrong:** Using `mailboxCreate('Actions/VIP Sender')` as a string on a server with `.` separator creates a literal folder named `Actions/VIP Sender` instead of nested hierarchy.
**Why it happens:** IMAP hierarchy separators are server-specific. `/` is common but not universal.
**How to avoid:** Always use array-form `mailboxCreate(['Actions', 'VIP Sender'])`. ImapFlow translates to the server's actual separator.
**Warning signs:** Folders appear as flat names in mail client instead of nested hierarchy.
[VERIFIED: .planning/research/PITFALLS.md Pitfall 3]

### Pitfall 2: createMailbox Wrapper Only Accepts String
**What goes wrong:** The current `ImapClient.createMailbox(path: string)` wrapper only accepts a string parameter, even though the underlying `ImapFlowLike.mailboxCreate` interface already accepts `string | string[]`.
**Why it happens:** The wrapper was written for the one existing use case (string-form path in `executeMove`).
**How to avoid:** Update `createMailbox` signature to `createMailbox(path: string | string[]): Promise<void>` to expose the array form already supported by the interface.
**Warning signs:** TypeScript compilation errors when passing array to `createMailbox`.
[VERIFIED: src/imap/client.ts line 171 vs ImapFlowLike line 26]

### Pitfall 3: status() Throws on Non-Existent Folders
**What goes wrong:** ImapFlow's `status()` throws an error if the queried folder doesn't exist. Code that assumes it returns a zero-count response will crash.
**Why it happens:** IMAP STATUS command (RFC 3501 section 6.3.10) requires the mailbox to exist.
**How to avoid:** Wrap `status()` in try/catch where catch means "folder doesn't exist, needs creation". This is distinct from D-08's "check existence first via status()" -- the status call IS the existence check; a catch means "not found".
**Warning signs:** Unhandled promise rejections during folder existence checks.
[ASSUMED -- ImapFlow behavior for non-existent mailbox status; needs verification against Fastmail]

### Pitfall 4: Emoji Characters in Folder Names
**What goes wrong:** Folder names like "⭐ VIP Sender" contain non-ASCII characters that require modified UTF-7 encoding for IMAP. Some mail clients may display them oddly.
**Why it happens:** IMAP uses a modified UTF-7 encoding for mailbox names (RFC 3501 section 5.1.3).
**How to avoid:** ImapFlow handles the encoding automatically when using `mailboxCreate`. Test against Fastmail to verify emoji display in the web client and any connected IMAP clients.
**Warning signs:** Garbled folder names in mail client sidebar.
[VERIFIED: imapflow handles encoding; ASSUMED: Fastmail emoji support]

### Pitfall 5: Backward Compatibility -- Existing Configs Missing actionFolders Section
**What goes wrong:** Existing `config.yml` files don't have an `actionFolders` section. If the schema requires it, `loadConfig` fails on startup.
**How to avoid:** Use `actionFolderConfigSchema.default(actionFolderDefaults)` pattern so the entire section defaults when absent. Existing configs parse successfully with all defaults applied.
**Warning signs:** Startup crashes after upgrade with "Invalid config" errors.
[VERIFIED: this is exactly how reviewConfigSchema works -- line 131-136 of schema.ts]

### Pitfall 6: FolderCache Stale After Creation
**What goes wrong:** The `FolderCache` (5-minute TTL) doesn't see newly created action folders. The folder picker in the UI shows stale data.
**Why it happens:** No cache invalidation hook for folder creation events.
**How to avoid:** Call `FolderCache.invalidate()` after folder creation (if the method exists) or accept that the cache will refresh within 5 minutes. Minor UX issue since action folders aren't filing destinations.
[VERIFIED: .planning/research/PITFALLS.md Pitfall 10]

## Code Examples

### Full Zod Schema Addition
```typescript
// Source: follows pattern from schema.ts reviewConfigSchema (lines 94-136)
const actionFolderDefaults = {
  enabled: true,
  prefix: 'Actions',
  pollInterval: 15,
  folders: {
    vip: '\u2B50 VIP Sender',
    block: '\uD83D\uDEAB Block Sender',
    undoVip: '\u21A9\uFE0F Undo VIP',
    unblock: '\u2705 Unblock Sender',
  },
} as const;

export const actionFolderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  prefix: z.string().min(1).default('Actions'),
  pollInterval: z.number().int().positive().default(15),
  folders: z.object({
    vip: z.string().min(1).default('\u2B50 VIP Sender'),
    block: z.string().min(1).default('\uD83D\uDEAB Block Sender'),
    undoVip: z.string().min(1).default('\u21A9\uFE0F Undo VIP'),
    unblock: z.string().min(1).default('\u2705 Unblock Sender'),
  }).default({}),
});

export type ActionFolderConfig = z.infer<typeof actionFolderConfigSchema>;
```

### Updated createMailbox Signature
```typescript
// Source: src/imap/client.ts line 171 -- update to accept array form
async createMailbox(path: string | string[]): Promise<void> {
  await this.withMailboxLock('INBOX', async (flow) => {
    await flow.mailboxCreate(path);
  });
}
```

### Folder Existence Check Helper
```typescript
// New: src/action-folders/folders.ts
async function folderExists(client: ImapClient, path: string): Promise<boolean> {
  try {
    await client.status(path, { messages: true });
    return true;
  } catch {
    return false;
  }
}
```

### default.yml Addition
```yaml
# Action Folders -- drag messages here to create sender rules
actionFolders:
  enabled: true
  prefix: Actions
  pollInterval: 15  # seconds
  folders:
    vip: "\u2B50 VIP Sender"
    block: "\uD83D\uDEAB Block Sender"
    undoVip: "\u21A9\uFE0F Undo VIP"
    unblock: "\u2705 Unblock Sender"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod v3 `z.object` | Zod v4.3.6 `z.object` (same API) | 2025 | No breaking changes for this use case [VERIFIED: npm ls shows zod@4.3.6] |

**Deprecated/outdated:**
- Nothing relevant to this phase. Zod 4 is backward-compatible for the schema patterns used here. [VERIFIED: existing tests pass with zod@4.3.6]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ImapFlow `status()` throws on non-existent folders (vs returning empty/zero) | Pitfall 3 | Folder existence check logic would be wrong; low risk since we'd catch it in testing |
| A2 | Fastmail IMAP server correctly handles emoji characters in folder names via modified UTF-7 | Pitfall 4 | Folder names would be garbled; would need to fall back to ASCII-only defaults |
| A3 | `status()` can be called for folders without disrupting INBOX IDLE | Architecture Pattern 3 | Would need alternative existence check approach; this is also flagged in STATE.md as a concern for Phase 20 |

## Open Questions

1. **status() behavior for non-existent folders**
   - What we know: IMAP STATUS command requires the mailbox to exist per RFC 3501. ImapFlow wraps this.
   - What's unclear: Whether ImapFlow throws, returns null, or returns zero-count for non-existent mailboxes.
   - Recommendation: Test during implementation. If status() doesn't throw, use `listMailboxes()` as fallback existence check.

2. **Emoji folder name display across clients**
   - What we know: ImapFlow handles modified UTF-7 encoding. Fastmail web client should display Unicode fine.
   - What's unclear: How Apple Mail, Thunderbird, etc. display emoji-prefixed IMAP folder names.
   - Recommendation: Test with Fastmail first (primary target). Emoji is a nice-to-have in the defaults; users can override with ASCII names via config.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `vitest run test/unit/config/action-folders.test.ts` |
| Full suite command | `vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | Prefix and folder names configurable with defaults | unit | `vitest run test/unit/config/action-folders.test.ts -t "defaults"` | Wave 0 |
| CONF-02 | enabled/disabled via config | unit | `vitest run test/unit/config/action-folders.test.ts -t "enabled"` | Wave 0 |
| CONF-03 | Poll interval configurable | unit | `vitest run test/unit/config/action-folders.test.ts -t "pollInterval"` | Wave 0 |
| FOLD-01 | Creates folder hierarchy if missing | unit | `vitest run test/unit/action-folders/folders.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `vitest run test/unit/config/ test/unit/action-folders/`
- **Per wave merge:** `vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/config/action-folders.test.ts` -- covers CONF-01, CONF-02, CONF-03
- [ ] `test/unit/action-folders/folders.test.ts` -- covers FOLD-01

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | Zod schema validation for all config inputs |
| V6 Cryptography | no | N/A |

### Known Threat Patterns for Config + IMAP Folder Creation

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious folder name injection via config | Tampering | Zod `z.string().min(1)` validation; ImapFlow handles encoding |
| Config file manipulation | Tampering | Existing atomic write pattern in saveConfig; file permissions managed by deployment |

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/config/schema.ts` (lines 94-136 for review schema pattern), `src/config/repository.ts` (lines 84-127 for callback patterns), `src/imap/client.ts` (lines 24-29 for ImapFlowLike interface, lines 171-175 for createMailbox wrapper)
- `.planning/research/SUMMARY.md` -- overall architecture recommendations
- `.planning/research/ARCHITECTURE.md` -- config schema design, component boundaries
- `.planning/research/PITFALLS.md` -- hierarchy separator risks, folder creation edge cases

### Secondary (MEDIUM confidence)
- ImapFlow documentation -- `mailboxCreate(string|string[])` array form for separator safety
- RFC 3501 section 6.3.10 -- STATUS command requires existing mailbox

### Tertiary (LOW confidence)
- Fastmail emoji folder name support -- untested assumption

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all existing dependencies, no new packages, verified versions
- Architecture: HIGH -- follows established patterns line-by-line from existing code
- Pitfalls: HIGH -- codebase-specific risks with clear mitigations; one assumption about status() behavior

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable domain, no fast-moving dependencies)
