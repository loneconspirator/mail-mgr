# Phase 10: Move Tracking - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 10-move-tracking
**Areas discussed:** Scan timing & frequency, Destination detection, Signal data richness, Lifecycle & wiring

---

## Scan Timing & Frequency

| Option | Description | Selected |
|--------|-------------|----------|
| Independent timer | Own setInterval loop, decoupled from Monitor | ✓ |
| Piggyback on Monitor | Scan after Monitor processes new arrivals | |
| Hybrid | Piggyback + fallback timer | |

**User's choice:** Independent timer
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| 30 seconds | Near-real-time detection | ✓ |
| 60 seconds | Balanced overhead | |
| 5 minutes | Low overhead, delayed detection | |

**User's choice:** 30 seconds
**Notes:** User prioritizes signal freshness

| Option | Description | Selected |
|--------|-------------|----------|
| Configurable in review config | Add moveTrackInterval to review config YAML | ✓ |
| Hardcoded 30s | Keep it simple, no config surface | |

**User's choice:** Configurable in review config
**Notes:** None

---

## Destination Detection

**Note:** User rejected initial options and proposed a hybrid two-tier approach.

**User's approach:** Immediate scan of "usual suspects" (recent folders + common names) upon detecting a move, then enqueue unknowns for a thorough deep scan on a less frequent interval.

| Option | Description | Selected |
|--------|-------------|----------|
| Recent folders + common names | Activity log top 10 + Archive/Trash/Junk | ✓ |
| Recent folders only | Only activity log destinations | |

**User's choice (fast pass):** Recent folders + common names
**Notes:** Covers ~80% of typical moves

| Option | Description | Selected |
|--------|-------------|----------|
| 5 minutes | Quick resolution | |
| 15 minutes | Low overhead, batch analysis doesn't need freshness | ✓ |
| On next sweep cycle | Piggyback on ReviewSweeper | |

**User's choice (deep scan interval):** 15 minutes

| Option | Description | Selected |
|--------|-------------|----------|
| Log as 'deleted' | Assume deletion if not found | |
| Log as null | Keep permanently unknown | |
| Drop signal entirely | Don't store incomplete data | ✓ |

**User's choice (not found):** Drop the signal entirely
**Notes:** User wants clean data only — no incomplete records

---

## Signal Data Richness

| Option | Description | Selected |
|--------|-------------|----------|
| Just the criteria fields | Exactly what LEARN-02 specifies | ✓ |
| Add recipient (To/CC) | Also store To and CC addresses | |
| Store raw headers blob | Keep raw headers for future use | |

**User's choice:** Just the criteria fields
**Notes:** Lean and purpose-built for Phase 11

| Option | Description | Selected |
|--------|-------------|----------|
| 30 days | Match activity log retention | |
| 90 days | Wider window for pattern analysis | ✓ |
| No auto-prune | Keep everything forever | |

**User's choice:** 90 days
**Notes:** Longer window for Phase 11 pattern analysis, negligible storage cost

---

## Lifecycle & Wiring

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone class | New src/tracking/index.ts, own lifecycle | ✓ |
| Part of Monitor | Subsystem of Monitor class | |
| Part of ActivityLog | Method set on ActivityLog | |

**User's choice:** Standalone class
**Notes:** Follows ReviewSweeper pattern

| Option | Description | Selected |
|--------|-------------|----------|
| On by default | Starts automatically, disable via config | ✓ |
| Off by default | Explicit opt-in required | |

**User's choice:** On by default
**Notes:** Feature should just work

| Option | Description | Selected |
|--------|-------------|----------|
| Share ImapClient instance | Same client as Monitor, serialized via withMailboxLock | ✓ |
| Separate IMAP connection | Own connection, true parallelism | |

**User's choice:** Share ImapClient instance
**Notes:** Proven pattern with ReviewSweeper, avoids connection limit issues

---

## Claude's Discretion

- UID snapshot storage mechanism
- Message-ID cross-referencing SQL approach
- Deep scan queue implementation
- Common folder name detection across providers
- Error handling for IMAP scan failures
- Whether to expose move tracker status via API

## Deferred Ideas

None — discussion stayed within phase scope
