# Feature Landscape: Sentinel Message System

**Domain:** IMAP folder tracking via planted beacon messages
**Researched:** 2026-04-21
**Confidence:** MEDIUM (novel pattern with no off-the-shelf prior art; IMAP primitives well-understood, but sentinel-as-folder-tracker is a custom design)

## Table Stakes

Features the sentinel system must have or it provides zero value over the current hardcoded folder paths.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| Plant sentinel on startup | Without sentinels in folders, there is nothing to track | Low | IMAP APPEND, ImapFlow `append()` | One message per tracked folder. Must use `append()` with RFC822 content + `\Seen` flag |
| Unique Message-ID per sentinel | The lookup key that survives folder renames | Low | UUID generation | Format: `<sentinel-{purpose}-{uuid}@mail-mgr>`. Purpose encodes what the folder is for (action-vip, review, rule-target-{id}, sweep-archive, etc.) |
| Message-ID to folder mapping in SQLite | Persistent record of "sentinel X lives in folder Y" | Low | Existing SQLite infra | New table: `sentinels(message_id TEXT PK, purpose TEXT, folder_path TEXT, planted_at TEXT)` |
| Per-folder SEARCH to locate sentinel | Core detection mechanism -- find sentinel by Message-ID header | Med | ImapFlow `search({ header: { 'Message-ID': id } })` within mailbox lock | IMAP SEARCH HEADER is per-folder only, no global search exists in the protocol |
| Periodic scan across all tracked folders | Detect renames by finding sentinel in a different folder than recorded | Med | Existing poll timer pattern, `listMailboxes()` | Scan frequency separate from mail processing poll -- every 5-10 minutes is fine |
| Auto-heal folder references on rename | When sentinel found in new location, update all config/rules referencing old path | High | Config repository, rule storage, action folder config, sweep config | This is the whole point. Must update: action folder paths, rule target folders, review folder, archive folder, trash folder |
| Re-plant sentinel when deleted | User or server purges the sentinel but folder still exists | Med | Folder existence check via `status()`, then re-append | Generate new Message-ID, update SQLite mapping |
| Failure notification to INBOX | When sentinel AND folder are gone, alert the user | Med | IMAP APPEND to INBOX | Human-readable email: "Mail Manager lost track of folder X. Please reconfigure." |
| Sentinel message format (minimally visible) | Users should not be confused by sentinel messages | Med | RFC822 message construction | Mark `\Seen`, use descriptive Subject ("Mail Manager Tracking Beacon -- do not delete"), small plain-text body explaining purpose |

## Differentiators

Features that elevate from "works" to "works well." Not expected in an MVP but high value.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| Scan all folders (not just tracked) for lost sentinels | If a folder is renamed to something unexpected, scanning only the old path fails. Scanning globally finds the sentinel wherever it went | High | `listMailboxes()` + per-folder SEARCH | Expensive: N folders x 1 SEARCH each. Mitigate by scanning tracked folders first (fast path), then falling back to full scan only when a sentinel is missing from its expected location |
| MAILBOXID integration (RFC 8474) | Servers supporting OBJECTID can detect renames without sentinel messages at all -- the MAILBOXID persists across renames | Med | ImapFlow supports OBJECTID in search; need to check CAPABILITY response | Fastmail authored RFC 8474 so likely supports it. Use as optimization: if OBJECTID available, use it; fall back to sentinel scan otherwise. Do NOT make this the only strategy -- many servers lack support |
| Batched folder scanning | Instead of N individual SEARCH commands, batch folder checks to reduce round trips | Low | Group folders, reuse connection | ImapFlow already handles connection pooling via mailbox locks |
| Sentinel health dashboard | UI showing sentinel status per folder: healthy/missing/relocated | Low | New API endpoint, frontend panel | Useful for debugging. Shows last-seen time, current folder, any recent relocations |
| Graceful sentinel migration on config change | When user changes action folder prefix via API, replant sentinels in new folders rather than losing track | Med | Config change event handler (already exists for poller rebuild) | Wire into existing `configRepo` change listener |

## Anti-Features

Features to explicitly NOT build. These are traps.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Hidden/invisible sentinel messages | Impossible with standard IMAP. No way to hide a message from mail clients. Attempting tricks (zero-width subjects, empty bodies) just confuses users more | Make sentinels clearly labeled with descriptive subject and body. Mark as `\Seen`. Users who understand will leave them alone; the re-plant mechanism handles deletion |
| Global cross-folder search in one IMAP command | Does not exist in IMAP protocol. Building an abstraction that pretends it does will hide the real cost (N sequential folder opens) | Explicitly iterate folders. Fast-path known folders first, full scan as fallback |
| Modifying message headers/flags as tracking mechanism | IMAP does not support modifying existing message headers. Custom flags/keywords are unreliable across servers (some strip them) | Use Message-ID which is immutable and universally searchable via HEADER search |
| Real-time rename detection via IMAP IDLE/NOTIFY | IDLE only monitors the currently selected folder. NOTIFY (RFC 5465) is barely supported. Neither reliably catches folder renames | Poll-based periodic scan. The existing app is already poll-based; this fits naturally |
| Automatic folder creation when sentinel is lost | If both sentinel and folder are gone, the app should NOT recreate the folder -- the user may have intentionally deleted it | Notify the user via INBOX message. Let them decide what to do |
| CONDSTORE/QRESYNC for rename detection | Already researched and rejected in v0.4 -- these extensions track flag changes and UID validity, not folder renames | Sentinel message approach (the whole point of this milestone) |
| Sentinel in INBOX | INBOX cannot be renamed or deleted. Planting a sentinel there wastes a visible message slot for zero benefit | Skip INBOX in sentinel planting. It is the one folder guaranteed to exist |

## Feature Dependencies

```
Plant sentinel on startup
  --> Message-ID to folder mapping in SQLite (need to store what was planted)
  --> Sentinel message format (need the message content to APPEND)

Per-folder SEARCH to locate sentinel
  --> Message-ID to folder mapping in SQLite (need to know what to search for)

Periodic scan across tracked folders
  --> Per-folder SEARCH (the scan mechanism)
  --> Message-ID to folder mapping (what to look for, where expected)

Auto-heal folder references on rename
  --> Periodic scan (detects the rename)
  --> Config repository integration (update action folder paths)
  --> Rule storage integration (update rule target folders)
  --> Sweep config integration (update archive/trash folders)

Re-plant sentinel when deleted
  --> Periodic scan (detects missing sentinel in existing folder)
  --> Plant sentinel (the re-plant mechanism)

Failure notification to INBOX
  --> Periodic scan (detects both sentinel and folder gone)
  --> IMAP APPEND to INBOX (delivery mechanism)

Global folder scan (differentiator)
  --> Per-folder SEARCH (same mechanism, more folders)
  --> listMailboxes() (need full folder list)

MAILBOXID integration (differentiator)
  --> CAPABILITY check on connect
  --> Fallback to sentinel scan when unsupported
```

## Folder Categories That Need Sentinels

Based on the existing codebase, these are all the folder references that could break on rename:

| Folder Reference | Source | Current Storage | Sentinel Purpose Tag |
|-----------------|--------|-----------------|---------------------|
| Review folder | `config.review.folder` | config.yml | `review` |
| Default archive folder | `config.review.defaultArchiveFolder` | config.yml | `sweep-archive` |
| Trash folder | `config.review.trashFolder` | config.yml / special-use | `sweep-trash` |
| Action folder: VIP | `config.actionFolders.folders.vip` | config.yml | `action-vip` |
| Action folder: Block | `config.actionFolders.folders.block` | config.yml | `action-block` |
| Action folder: Undo VIP | `config.actionFolders.folders.undoVip` | config.yml | `action-undo-vip` |
| Action folder: Unblock | `config.actionFolders.folders.unblock` | config.yml | `action-unblock` |
| Rule target folders | `rule.action.folder` (move rules) | SQLite rules table | `rule-target-{ruleId}` |
| Rule review folders | `rule.action.folder` (review rules with custom folder) | SQLite rules table | `rule-review-{ruleId}` |

**Note on Trash:** Trash is resolved via IMAP special-use attribute (`\Trash`) with config fallback. Special-use folders cannot be renamed by users (the attribute follows the folder). Sentinel may be unnecessary here -- verify at implementation time.

## Scan Strategy: Two-Tier

1. **Fast scan (every cycle):** Check each sentinel's expected folder. SEARCH that one folder for the Message-ID. If found, all good. If not found, mark as "missing" and queue for deep scan.

2. **Deep scan (on missing sentinels only):** Iterate all IMAP folders, SEARCH each for the missing sentinel's Message-ID. If found in a different folder, that is a rename -- auto-heal. If not found anywhere, check if the expected folder still exists (via `status()`). If folder exists but sentinel gone, re-plant. If folder gone too, notify user.

This two-tier approach means the common case (nothing changed) is cheap: N SEARCH commands where N is the number of tracked folders (typically 8-12). The expensive global scan only triggers when something is actually wrong.

## MVP Recommendation

**Phase 1 -- Core sentinel infrastructure:**
1. Sentinel message format and APPEND mechanism
2. SQLite storage for sentinel mappings
3. Plant sentinels in all tracked folders on startup

**Phase 2 -- Detection and healing:**
4. Periodic scan (fast path: check expected folders)
5. Deep scan fallback (search all folders for missing sentinels)
6. Auto-heal: update config/rules when rename detected
7. Re-plant when sentinel deleted but folder exists

**Phase 3 -- Failure handling and cleanup:**
8. INBOX notification when folder is truly gone
9. Remove folder rename card from settings UI
10. Sentinel health API endpoint (optional differentiator)

**Defer:**
- MAILBOXID/OBJECTID integration: Nice optimization but adds complexity and only helps on supporting servers. Revisit after core sentinel system is proven.
- Sentinel health dashboard UI: API endpoint is cheap, full UI is gold plating for v0.7.

## Sources

- [ImapFlow API documentation](https://imapflow.com/docs/api/imapflow-client/) -- append(), search(), header search -- HIGH confidence
- [ImapFlow search guide](https://imapflow.com/docs/guides/searching/) -- header search syntax confirmed -- HIGH confidence
- [RFC 8474: IMAP OBJECTID Extension](https://www.rfc-editor.org/rfc/rfc8474.html) -- MAILBOXID survives renames -- HIGH confidence
- [RFC 3501: IMAP4rev1](https://tools.ietf.org/html/rfc3501) -- SEARCH is per-folder, APPEND semantics -- HIGH confidence
- [Chilkat IMAP header search](https://cknotes.com/imap-search-for-messages-by-message-id-or-any-email-header-field/) -- Message-ID searchable via HEADER criterion -- MEDIUM confidence
- [Limilabs IMAP folder rename detection](https://www.limilabs.com/qa/2820/how-to-know-if-an-imap-folder-has-been-renamed) -- UIDVALIDITY does not help with renames -- MEDIUM confidence
- Existing codebase: `src/tracking/destinations.ts` already does Message-ID search across folders (fetch+iterate pattern) -- can be upgraded to use IMAP SEARCH -- HIGH confidence
