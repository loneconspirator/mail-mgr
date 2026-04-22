# Phase 26: Sentinel Store & Message Format - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 26-sentinel-store-message-format
**Areas discussed:** Sentinel message content, Message-ID generation, SQLite schema location, Module structure
**Mode:** --auto (all decisions auto-selected)

---

## Sentinel Message Content

| Option | Description | Selected |
|--------|-------------|----------|
| Descriptive system message | Subject: `[Mail Manager] Sentinel: {path}`, From: `mail-manager@localhost`, body explains purpose | ✓ |
| Minimal/hidden message | Empty subject, no body — minimize user visibility | |
| Custom template per folder type | Different subjects/bodies for each folder purpose | |

**User's choice:** [auto] Descriptive system message (recommended default)
**Notes:** SENT-04 requires body text explains purpose including action folder descriptions. Descriptive approach satisfies this directly.

---

## Message-ID Generation

| Option | Description | Selected |
|--------|-------------|----------|
| UUID + domain format | `<uuid@mail-manager.sentinel>` — unique + identifiable pseudo-domain | ✓ |
| Timestamp-based | `<timestamp-random@mail-manager>` — sortable but less unique | |
| Hash-based | `<sha256(folder+timestamp)@mail-manager>` — deterministic but complex | |

**User's choice:** [auto] UUID + domain format (recommended default)
**Notes:** UUID v4 is the standard approach for RFC 2822 Message-ID generation. The `.sentinel` pseudo-domain aids debugging.

---

## SQLite Schema Location

| Option | Description | Selected |
|--------|-------------|----------|
| New migration in existing activity DB | Add `sentinels` table via migration runner in `src/log/migrations.ts` | ✓ |
| Separate sentinel DB file | Dedicated `sentinel.db` alongside activity DB | |
| Extend state table | Use existing `state` key-value table for sentinel mappings | |

**User's choice:** [auto] New migration in existing activity DB (recommended default)
**Notes:** Follows established migration pattern. Single DB file keeps deployment simple and allows transactional consistency with activity logging.

---

## Module Structure

| Option | Description | Selected |
|--------|-------------|----------|
| New `src/sentinel/` directory | Dedicated module with `format.ts`, `store.ts`, `index.ts` | ✓ |
| Add to `src/tracking/` | Extend existing tracking module | |
| Add to `src/log/` | Collocate with database code | |

**User's choice:** [auto] New `src/sentinel/` directory (recommended default)
**Notes:** Clean separation follows pattern of `src/action-folders/`, `src/tracking/`. Sentinel is a new cross-cutting concern, not a subset of tracking or logging.

---

## Claude's Discretion

- Body text exact wording and formatting
- Internal naming conventions for types/interfaces
- Test file organization

## Deferred Ideas

None — discussion stayed within phase scope
