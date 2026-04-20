# Technology Stack

**Project:** Mail Manager v0.6 - Action Folders
**Researched:** 2026-04-20

## Key Finding: No New Dependencies Required

Every capability needed for action folders is already available in the existing imapflow (^1.2.8) dependency and the current `ImapClient` wrapper. This milestone is purely application-level feature work on top of the existing stack.

## Existing Stack (Unchanged)

| Technology | Version | Purpose | Status for v0.6 |
|------------|---------|---------|-----------------|
| imapflow | ^1.2.8 (latest: ~1.3.2) | IMAP client | All needed APIs already exposed |
| better-sqlite3 | ^12.6.2 | Rule/activity storage | No changes needed |
| Fastify | ^5.7.4 | Web server | No new routes required by PRD |
| Zod | ^4.3.6 | Config/rule validation | Extend schema for actionFolders config |
| picomatch | ^4.0.3 | Glob matching | No changes |
| pino | ^10.3.0 | Logging | No changes |
| Vitest | ^4.0.18 | Testing | No changes |

## imapflow APIs Needed for v0.6

All three capabilities below are already present in the `ImapFlowLike` interface and `ImapClient` class. No wrapper additions needed.

### 1. Mailbox Creation (`mailboxCreate`)

**Already available:** `ImapClient.createMailbox(path: string)` wraps `flow.mailboxCreate(path)` (client.ts:171-175).

**imapflow behavior (HIGH confidence, verified via official docs):**
- `mailboxCreate(path)` accepts `string | string[]`
- Returns `{ path: string, created: boolean, mailboxId?: string }`
- When folder already exists: returns `{ created: false }` -- does NOT throw
- Array form `['Actions', 'VIP Sender']` auto-joins with the server's namespace delimiter
- Creates parent folders automatically (creating `Actions/VIP Sender` creates `Actions/` if missing)

**Integration point:** The existing `createMailbox` wrapper takes a `string` path. For action folders, use the string form with the IMAP separator (e.g., `"Actions/VIP Sender"` on `/`-delimited servers). The array form is available if delimiter-agnostic creation is needed, but requires updating the wrapper's type signature from `string` to `string | string[]`.

**Recommendation:** Use the **array form** `['Actions', 'VIP Sender']` for folder creation because imapflow handles delimiter joining automatically. This avoids hardcoding `/` or `.` separators. Update `ImapClient.createMailbox` to accept `string | string[]`.

### 2. Folder Status Check (`status`)

**Already available:** `ImapFlowLike.status(path, query)` is in the interface (client.ts:29). No `ImapClient` wrapper exists yet, but adding one is trivial.

**imapflow behavior (HIGH confidence):**
- `status(path, { messages: true })` returns `{ messages: number }` without selecting the mailbox
- Does not interfere with IDLE or current mailbox lock
- Lightweight IMAP STATUS command -- much cheaper than fetching all messages

**Use for action folders:** Poll action folders with `status('Actions/VIP Sender', { messages: true })` to check if any messages are waiting. If `messages > 0`, switch to that folder and process. This avoids full fetch cycles on empty folders (which they will be 99% of the time).

**New wrapper needed:**
```typescript
async getMailboxStatus(path: string): Promise<{ messages: number }> {
  if (!this.flow) throw new Error('Not connected');
  const result = await this.flow.status(path, { messages: true });
  return { messages: result.messages ?? 0 };
}
```

### 3. Multi-Folder Monitoring (IDLE + Poll)

**IMAP protocol limitation (HIGH confidence):** IDLE only monitors the currently-selected mailbox. One connection = one IDLE folder. This is a fundamental RFC 2177 constraint, not an imapflow limitation.

**Current architecture:** The `ImapClient` IDLEs on INBOX (the selected mailbox after connect). The `MoveTracker` and `ReviewSweeper` use `withMailboxLock` / `withMailboxSwitch` to temporarily access other folders, which breaks IDLE temporarily and restores it after.

**Options for action folder monitoring:**

| Approach | Responsiveness | Complexity | Resource Cost |
|----------|---------------|------------|---------------|
| **A: Poll via `status()` on timer** | ~30-60s latency | Low | One STATUS command per folder per cycle |
| **B: Separate ImapFlow connection per action folder** | Near-instant (IDLE) | High | 4+ extra IMAP connections |
| **C: Piggyback on existing poll/IDLE cycle** | Same as INBOX monitoring | Minimal | Zero additional cost |

**Recommendation: Option A (status polling) with short interval.** Use `status()` to check message counts in action folders every 15-30 seconds. When messages are found, use `withMailboxSwitch` to process them. Rationale:
- Action folders will be empty 99%+ of the time -- `status()` is near-zero cost for empty checks
- 15-30s latency is acceptable (user moved a message, they're not staring at the action folder)
- No additional IMAP connections (Fastmail and other providers limit concurrent connections)
- Simpler than multi-connection management with reconnect/backoff for each
- The existing `withMailboxSwitch` pattern handles IDLE interruption and restoration cleanly

**Do NOT use Option B.** Multiple IMAP connections add reconnect complexity, hit provider connection limits (Fastmail allows ~10 concurrent), and the responsiveness gain is not worth it for an operation that happens a few times per day.

## IMAP Separator / Hierarchy Handling

**Already available:** The `listTree()` / `listFolders()` output includes `delimiter` per folder node (client.ts:337). The folder cache already stores this.

**Key insight:** imapflow's `mailboxCreate` with the array form handles separator automatically. For string-form paths used in monitoring (`withMailboxLock('Actions/VIP Sender')`), the separator matters.

**Approach:** On startup, after creating action folders, read back the actual paths from `listMailboxes()` or the create response. Store the resolved paths (with correct server separator) in the action folder processor config. Never hardcode `/` as separator.

**Alternatively:** Since the PRD specifies configurable folder names, the config can use the array form:
```yaml
actionFolders:
  prefix: "Actions"
  folders:
    vip: "VIP Sender"
```
And the system joins `[prefix, folderName]` using imapflow's array-path support for creation, then resolves the actual string path from the server for subsequent operations.

## Schema Addition (Zod)

New config section needed. Minimal addition to `config/schema.ts`:

```typescript
export const actionFoldersConfigSchema = z.object({
  enabled: z.boolean().default(true),
  prefix: z.string().min(1).default('Actions'),
  pollIntervalSeconds: z.number().int().positive().default(30),
  folders: z.object({
    vip: z.string().min(1).default('VIP Sender'),
    block: z.string().min(1).default('Block Sender'),
    undoVip: z.string().min(1).default('Undo VIP'),
    unblock: z.string().min(1).default('Unblock Sender'),
  }).default({}),
});
```

This uses Zod which is already a dependency. No new libraries.

## What NOT to Add

| Temptation | Why Not |
|------------|---------|
| `@types/imapflow` | The codebase already uses its own `ImapFlowLike` interface with explicit typing. Adding `@types/imapflow` would create type conflicts. |
| Second IMAP library | imapflow handles everything needed. |
| Additional IMAP connections | Provider connection limits, complexity, not worth the latency gain. |
| Message queue library (bull, etc.) | Overkill. Action folders process at most a few messages per day. A simple poll loop is sufficient. |
| Event emitter library | Node's built-in EventEmitter (already used by ImapClient) is sufficient. |
| UUID library | Already using `crypto.randomUUID()` (Node built-in) for rule IDs throughout the codebase. |

## Version Consideration

The project pins imapflow at `^1.2.8`. The latest appears to be ~1.3.2. The `mailboxCreate`, `status`, and `mailboxOpen` APIs have been stable across the 1.x line. No version bump is required, but running `npm update imapflow` would be harmless and pick up any bug fixes.

**Confidence: HIGH** -- verified that `mailboxCreate` returns `{ created: boolean }` and `status()` works without selecting the mailbox, both via official imapflow documentation.

## Sources

- [ImapFlow Client API](https://imapflow.com/docs/api/imapflow-client/) -- mailboxCreate, status, mailboxOpen docs
- [ImapFlow Documentation](https://imapflow.com/module-imapflow-ImapFlow.html) -- full API reference
- [RFC 2177](https://datatracker.ietf.org/doc/html/rfc2177) -- IDLE limitation to single selected mailbox
- [ImapFlow GitHub](https://github.com/postalsys/imapflow) -- source, changelog, issue tracker
- [imapflow npm](https://www.npmjs.com/package/imapflow) -- version history
- Codebase analysis: `src/imap/client.ts`, `src/monitor/index.ts`, `src/tracking/index.ts`, `src/actions/index.ts`
