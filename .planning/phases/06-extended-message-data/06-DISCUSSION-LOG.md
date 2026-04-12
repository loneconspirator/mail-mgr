# Phase 6: Extended Message Data - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-11
**Phase:** 6-extended-message-data
**Areas discussed:** Auto-discovery strategy, Header fetch approach, Visibility classification, Migration system

---

## Auto-Discovery Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| On connect + change | Run on first connect if no header stored, re-run when host/user changes | |
| Every connect | Re-probe every time IMAP connection is established | |
| Manual only | Only run when user clicks button in UI | |
| *User's own* | Trigger when user submits IMAP server config in UI | ✓ |

**User's choice:** Trigger on IMAP config submission in UI, regardless of whether values changed
**Notes:** User initially considered waiting for live message arrivals (5 messages post-reconnect) to avoid probing "local messages from another server," then revised to 10 recent messages after realizing all fetched messages come from the connected server.

| Option | Description | Selected |
|--------|-------------|----------|
| 10 recent messages | Quick probe, header shows up consistently | ✓ |
| 1 message | Fastest but risks hitting atypical message | |
| 50 messages | Overkill for well-behaved servers | |

**User's choice:** 10 recent messages (revised from initial "5 messages that have arrived since reconnecting")

| Option | Description | Selected |
|--------|-------------|----------|
| Config YAML | Visible, editable, consistent with other settings | ✓ |
| SQLite state table | Hidden, already used for cursor UID | |
| Separate discovery cache | Most isolated, adds complexity | |

**User's choice:** Config YAML under imap.envelopeHeader

| Option | Description | Selected |
|--------|-------------|----------|
| Process normally | Evaluate rules with empty envelope fields, MATCH-06 skips | |
| Queue and reprocess | Hold messages until discovery completes | |
| *Revised* | Pause Monitor entirely until discovery completes | ✓ |

**User's choice:** Pause Monitor until discovery completes — no need to run with a neutered rule set
**Notes:** User initially selected "Queue and reprocess" then revised to full Monitor pause, which is simpler and cleaner.

---

## Header Fetch Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Only discovered header | After discovery, only fetch identified header + List-Id | ✓ |
| All candidate headers always | Fetch all candidate headers on every message | |
| You decide | Claude picks cleanest approach | |

**User's choice:** Only discovered header plus List-Id

| Option | Description | Selected |
|--------|-------------|----------|
| Centralized in ImapClient | Fetch methods add header fields, parseMessage() extracts values | ✓ |
| Parse layer in messages.ts | Fetch in client, parsing in messages.ts | |
| You decide | Claude picks cleanest layering | |

**User's choice:** Centralized in ImapClient

---

## Visibility Classification

| Option | Description | Selected |
|--------|-------------|----------|
| Single value, priority order | list > direct > cc > bcc. Simple, deterministic | ✓ |
| Multi-value set | Message can be both 'list' and 'cc'. More accurate, more complex | |
| You decide | Claude picks based on matchRule() needs | |

**User's choice:** Single value, priority order

| Option | Description | Selected |
|--------|-------------|----------|
| null/undefined | Visibility absent when envelope unavailable, rules skipped | ✓ |
| Best-effort from To/CC only | Partial classification without envelope recipient | |
| You decide | Claude picks based on MATCH-06 requirements | |

**User's choice:** null/undefined when envelope recipient unavailable

---

## Migration System

| Option | Description | Selected |
|--------|-------------|----------|
| Version table + numbered migrations | schema_version table, numbered migration functions, transactional | |
| File-based migrations | SQL files in migrations/ directory | |
| Keep try/catch + version tracking | Least disruption | |
| *User's own* | Version table + timestamped migrations | ✓ |

**User's choice:** Version table with timestamped migrations (not sequential numbers)

| Option | Description | Selected |
|--------|-------------|----------|
| Bootstrap + fresh | Detect existing schema, mark as done, new system forward | ✓ |
| Convert everything | Rewrite all migrations into new system | |
| You decide | Claude picks least disruptive approach | |

**User's choice:** Bootstrap + fresh — detect existing state, remove try/catch code

---

## Claude's Discretion

- Header probing order and consensus logic
- EmailMessage type extension field names
- ImapFlow fetch query syntax details
- Migration timestamp format and naming convention

## Deferred Ideas

None — discussion stayed within phase scope
