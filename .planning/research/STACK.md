# Stack Research

**Domain:** IMAP sentinel message system (folder tracking beacons)
**Researched:** 2026-04-21
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

No new dependencies needed. The existing stack handles everything.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| imapflow | ^1.2.8 (existing) | IMAP APPEND, SEARCH, messageDelete | Already in use. Natively supports append(), search({ header }), and messageDelete() -- all three operations needed for sentinel lifecycle |
| Node.js crypto | built-in | Message-ID generation | crypto.randomUUID() produces guaranteed-unique IDs for Message-ID headers. No library needed |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nodemailer | ^8.0.4 (existing dev dep) | Integration test message construction | Already a devDependency. Use MailComposer in tests to build realistic RFC 2822 messages for APPEND testing. NOT needed in production -- sentinel messages are simple enough for string templates |

### Development Tools

No new dev tools needed.

## No New Dependencies Required

The sentinel message system needs three IMAP operations and one message format. All are covered by existing tools:

1. **APPEND** -- imapflow `client.append(path, content, flags)` accepts raw RFC 2822 string
2. **SEARCH by header** -- imapflow `client.search({ header: { 'Message-ID': '<value>' } })` returns UIDs
3. **DELETE** -- imapflow `client.messageDelete(range, { uid: true })` marks and expunges
4. **RFC 2822 construction** -- string template (see below), no library needed

## ImapFlow API Details

### append() -- Planting Sentinel Messages

**Signature:** `client.append(path, content, flags?, idate?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | String | Yes | Destination mailbox path |
| content | String/Buffer/Readable | Yes | RFC 2822 formatted message |
| flags | Array | No | Initial flags (use `['\\Seen']` for sentinels) |
| idate | Date | No | Internal date |

**Returns:** `Promise<AppendResponseObject | false>`
- `path` -- mailbox path
- `uid` -- UID of appended message (requires UIDPLUS extension)
- `uidValidity` -- mailbox UIDVALIDITY value

**UIDPLUS Note:** Fastmail supports UIDPLUS. The append response includes the assigned UID, which should be stored alongside the Message-ID for faster future lookups. If a server lacks UIDPLUS, append() returns `false` for the uid field -- code should handle this gracefully but it won't happen with Fastmail.

**Critical:** append() does NOT require a mailbox lock. It operates on a closed mailbox (you specify the target path, not the currently selected mailbox). This means sentinels can be planted without disrupting IDLE on INBOX.

### search() -- Finding Sentinel Messages

**Signature:** `client.search(query, options?)`

**Header search syntax:**
```typescript
// Search for sentinel by Message-ID in currently selected mailbox
const uids = await client.search(
  { header: { 'Message-ID': '<sentinel-uuid@mail-mgr>' } },
  { uid: true }
);
```

**Returns:** `Promise<number[]>` -- array of matching UIDs

**Important:** search() operates on the currently selected (locked) mailbox. To search across multiple folders, you must iterate: lock folder, search, release, next folder. This is the same pattern already used in DestinationResolver.searchFolderForMessage().

**Performance improvement over current approach:** The existing DestinationResolver fetches ALL envelopes (`fetch('1:*', { envelope: true })`) and iterates in JS to find a Message-ID match. Using `search({ header: { 'Message-ID': value } })` pushes the filtering to the IMAP server -- dramatically faster on large folders. The sentinel system should use search() from the start, and the existing DestinationResolver should be refactored to use it too.

**Server compatibility:** IMAP SEARCH HEADER is part of the base IMAP4rev1 spec (RFC 3501 section 6.4.4). Fastmail fully supports it. The GitHub issue #77 on imapflow where a user had problems was a Dovecot configuration issue, not an imapflow bug.

### messageDelete() -- Removing Stale Sentinels

**Signature:** `client.messageDelete(range, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| range | String/Array/SearchObject | UID range or search criteria |
| options.uid | Boolean | Treat range as UIDs |

**Returns:** `Promise<boolean>`

Marks messages `\Deleted` and expunges. Use after finding a sentinel that needs re-planting or cleanup.

### ImapFlowLike Interface Changes

The existing `ImapFlowLike` interface in `src/imap/client.ts` needs three new methods:

```typescript
// Add to ImapFlowLike interface:
append(path: string, content: string | Buffer, flags?: string[], idate?: Date): Promise<{ path: string; uid?: number; uidValidity?: bigint } | false>;
search(query: Record<string, unknown>, options?: { uid?: boolean }): Promise<number[]>;
messageDelete(range: string | number[], options?: { uid?: boolean }): Promise<boolean>;
```

## RFC 2822 Message Construction

### Why No Library Needed

Sentinel messages are not real emails. They are marker messages with:
- A unique Message-ID header
- A custom X-Mail-Mgr-Sentinel header for identification
- Minimal required headers (Date, From)
- A short text body explaining what the message is

This is trivially constructable as a string template. Using nodemailer's MailComposer or MIMEText for this would be over-engineering -- those libraries handle MIME multipart, attachments, encoding, etc. None of that applies here.

### Minimum Required Headers (RFC 2822)

Per RFC 2822, only two header fields are mandatory:
1. **Date** -- origination date (RFC 2822 format)
2. **From** -- originator address

Additionally, for sentinel purposes:
3. **Message-ID** -- for reliable cross-folder search (technically optional per spec, but essential for us)
4. **Subject** -- human-readable identification
5. **X-Mail-Mgr-Sentinel** -- custom header for fast identification
6. **MIME-Version** + **Content-Type** -- good hygiene for text body

### Sentinel Message Template

```typescript
function buildSentinelMessage(opts: {
  messageId: string;
  folderPath: string;
  purpose: string;
}): string {
  const date = new Date().toUTCString();
  return [
    `Message-ID: <${opts.messageId}>`,
    `Date: ${date}`,
    `From: mail-mgr@localhost`,
    `Subject: [Mail Manager] Sentinel - ${opts.purpose}`,
    `X-Mail-Mgr-Sentinel: ${opts.purpose}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `This message is a tracking sentinel placed by Mail Manager.`,
    `It tracks the folder: ${opts.folderPath}`,
    `Purpose: ${opts.purpose}`,
    ``,
    `Do not delete this message. If you move it, Mail Manager will`,
    `detect the folder rename and update its configuration.`,
  ].join('\r\n');
}
```

### Message-ID Generation

Use `crypto.randomUUID()` for the unique part:

```typescript
import { randomUUID } from 'node:crypto';

function generateSentinelMessageId(): string {
  return `${randomUUID()}@mail-mgr.sentinel`;
}
// Produces: "a1b2c3d4-e5f6-7890-abcd-ef1234567890@mail-mgr.sentinel"
```

**Why not Date.now() or incrementing counter:** UUIDs v4 have 122 bits of randomness. Collisions are astronomically unlikely even across reinstalls. Timestamps can collide if two sentinels are planted in the same millisecond. The `@mail-mgr.sentinel` domain part makes these immediately identifiable as sentinel Message-IDs.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| String template for RFC 2822 | nodemailer MailComposer | Only if sentinel messages need MIME multipart, attachments, or encoded headers -- they don't |
| String template for RFC 2822 | MIMEText (npm: mimetext) | Only if you need RFC 5322 compliance validation -- overkill for internal marker messages |
| crypto.randomUUID() | uuid npm package | Never -- Node.js has built-in UUID generation since v14.17 |
| imapflow search({ header }) | Fetch all + filter in JS | Never -- current DestinationResolver does this and it's slow. Server-side search is strictly better |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| mimetext / emailjs-mime-builder | Adds dependency for trivial string concatenation. Sentinel messages have no MIME complexity | String template with \r\n joins |
| nodemailer in production | Already a devDependency for tests. Moving to production dep for message building adds unnecessary weight | String template |
| Custom IMAP commands via imapflow rawCommand | ImapFlow already wraps APPEND/SEARCH/DELETE with proper error handling and connection state management | Use the documented API methods |
| X-Keywords / custom flags for sentinel identification | Not all IMAP servers support custom flags. Custom headers are universally supported | X-Mail-Mgr-Sentinel header |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| imapflow@^1.2.8 | Node.js 16+ | append(), search(), messageDelete() available since 1.0.0. No version bump needed |
| crypto.randomUUID() | Node.js 19+ (stable), 14.17+ (with flag) | Project uses Node 25.x per @types/node -- no issue |

## Key Implementation Notes

### Sentinel Flags

Plant sentinels with `['\\Seen']` flag so they don't show as unread in mail clients. Do NOT use `\Deleted` or `\Draft`. The `\Seen` flag is the most benign -- it just means "read."

### CRLF Line Endings

RFC 2822 requires `\r\n` line endings. The string template must use `\r\n`, not `\n`. ImapFlow's append() passes the content directly to the IMAP server which expects RFC 2822 format.

### Searching Across Folders

For the periodic sentinel scan, the pattern is:
1. Get list of tracked folders from SQLite
2. For each folder: lock mailbox, search for sentinel Message-ID, release lock
3. If sentinel found: folder exists, update any path changes
4. If sentinel not found: check if folder exists (via list), if so re-plant, if not mark as missing

This is O(N) IMAP operations where N = number of tracked folders. With search() pushing filtering server-side, each operation is fast even on folders with thousands of messages.

### Existing Code to Refactor

The `DestinationResolver.searchFolderForMessage()` in `src/tracking/destinations.ts` currently fetches ALL envelopes and filters in JS. It even has a TODO comment: "ImapFlow's search() with Message-ID header should be investigated for better performance." The sentinel system should use search() from day one, and the existing resolver should be updated to use the same pattern.

## Sources

- [ImapFlow Client API](https://imapflow.com/docs/api/imapflow-client/) -- append(), search(), messageDelete() signatures (HIGH confidence)
- [ImapFlow search guide](https://imapflow.com/docs/guides/searching/) -- header search syntax (HIGH confidence)
- [ImapFlow DeepWiki](https://deepwiki.com/postalsys/imapflow/5-message-operations) -- message operations detail (HIGH confidence)
- [ImapFlow GitHub issue #77](https://github.com/postalsys/imapflow/issues/77) -- header search server compatibility (MEDIUM confidence, server-dependent)
- [RFC 2822](https://tools.ietf.org/html/rfc2822) -- minimum required headers: Date + From only (HIGH confidence)
- [RFC 4315 UIDPLUS](https://www.rfc-editor.org/rfc/rfc4315.html) -- APPENDUID response format (HIGH confidence)
- [Fastmail IMAP capabilities](https://gist.github.com/emersion/2c769bc1ed60a7b7945910d35b606801) -- confirms UIDPLUS support (HIGH confidence)
- [Nodemailer MailComposer](https://nodemailer.com/extras/mailcomposer) -- evaluated and rejected for production use (MEDIUM confidence)

---
*Stack research for: IMAP sentinel message system*
*Researched: 2026-04-21*
