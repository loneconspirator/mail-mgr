# Phase 17: Configuration & Folder Lifecycle - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a validated Zod configuration schema for action folders and create the IMAP folder hierarchy on startup. This phase delivers config + folder creation only — no processor, no polling timer, no action handling. Requirements: CONF-01, CONF-02, CONF-03, FOLD-01.

</domain>

<decisions>
## Implementation Decisions

### Config schema location
- **D-01:** Top-level `actionFolders` section in config YAML, parallel to `imap`, `server`, `rules`, `review`. Not nested under any existing section.

### Default folder names
- **D-02:** Default prefix is `Actions`
- **D-03:** Default sub-folder names use emoji prefixes: ⭐ VIP Sender, 🚫 Block Sender, ↩️ Undo VIP, ✅ Unblock Sender
- **D-04:** Both prefix and individual folder names are fully configurable in the schema (per-folder `name` overrides alongside `prefix`)

### Feature toggle
- **D-05:** `enabled: boolean` (default true). When disabled: don't create folders, don't monitor, ignore existing folders on server. Simple early-return in start(), matching MoveTracker pattern.

### Poll interval
- **D-06:** Default poll interval is 15 seconds. Configurable via `pollInterval` in the `actionFolders` config section.

### Folder creation strategy
- **D-07:** Lazy creation on first poll, not eager at startup. Folders are created when monitoring starts, not during the startup sequence itself.
- **D-08:** Check existence first via `status()` call, only create if missing. No try/catch-already-exists pattern.
- **D-09:** On creation failure: log error, disable action folder monitoring, continue startup. Graceful degradation — rest of the app works fine.

### Startup integration
- **D-10:** Action folder initialization happens after IMAP connect but before sweeper/MoveTracker start. Natural position in startup sequence.
- **D-11:** Add `onActionFolderConfigChange` callback to ConfigRepository following the established hot-reload pattern. On change: stop polling, re-read config, create any new folders, restart polling.

### Phase scope
- **D-12:** Config + folder creation only. No processor skeleton, no polling timer, no action handling. Clean boundary — Phase 18+ adds processing infrastructure.

### Claude's Discretion
- Exact Zod schema field names and nesting within `actionFolders`
- Config YAML formatting and comments in default.yml
- Specific log messages and log levels for creation/failure events
- How `status()` check maps to folder existence detection
- Internal helper function naming and organization

</decisions>

<specifics>
## Specific Ideas

- Emoji-prefixed folder names (⭐ 🚫 ↩️ ✅) give visual distinction in mail client sidebars — these are the defaults but fully overridable
- Array-form `mailboxCreate(['Actions', '⭐ VIP Sender'])` for separator safety (per research)
- The `enabled` flag follows the exact same pattern as `config.review.moveTracking.enabled` — simple boolean guard at component start

</specifics>

<canonical_refs>
## Canonical References

### Requirements & PRD
- `.planning/REQUIREMENTS.md` — CONF-01, CONF-02, CONF-03, FOLD-01 requirement definitions
- `.planning/ROADMAP.md` §Phase 17 — Success criteria (4 items)

### Research
- `.planning/research/SUMMARY.md` — Recommended architecture, pitfalls, stack decisions
- `.planning/research/ARCHITECTURE.md` — ActionFolderProcessor design, config schema recommendations
- `.planning/research/PITFALLS.md` — IMAP hierarchy separator risks, folder creation edge cases

### Existing patterns to follow
- `src/config/schema.ts` — Zod schema definition patterns, nested config sections with defaults
- `src/config/loader.ts` — Config loading, env var substitution, validation flow
- `src/config/repository.ts` — Hot-reload callbacks (onRulesChange, onImapConfigChange, onReviewConfigChange)
- `src/index.ts` — Startup sequence, component initialization order
- `src/imap/client.ts:171-175` — `createMailbox()` method wrapping `mailboxCreate`
- `src/tracking/index.ts:71-96` — MoveTracker `enabled` flag pattern, timer setup/cleanup

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `configSchema` (schema.ts): Extend with new `actionFolders` Zod object schema
- `ConfigRepository.saveConfig()`: Already handles atomic write with validation — will work for action folder config
- `ImapClient.createMailbox(path)`: Existing method, currently string-form — may need array-form overload or update
- `ImapClient.status()` via imapflow: Available for existence checks without selecting mailbox

### Established Patterns
- Zod schemas with `.default()` for optional config — all new fields should have sensible defaults
- `z.object({}).default({})` pattern for entire optional sections (see `reviewConfigSchema.default(reviewDefaults)`)
- Timer refs stored on instance, cleared in `stop()`, `.unref()` for background intervals
- Config change callbacks registered in index.ts after component creation

### Integration Points
- `src/config/schema.ts` — Add `actionFolders` to `configSchema` z.object
- `src/config/repository.ts` — Add `onActionFolderConfigChange` callback
- `src/index.ts` — Wire folder creation into startup after IMAP connect, register config change handler
- `config/default.yml` — Add `actionFolders` section with defaults

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-configuration-folder-lifecycle*
*Context gathered: 2026-04-20*
