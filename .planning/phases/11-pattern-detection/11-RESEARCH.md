# Phase 11: Pattern Detection & Proposed Rules - Research

**Researched:** 2026-04-12
**Domain:** SQLite pattern analysis, real-time proposal engine, SPA UI for rule lifecycle
**Confidence:** HIGH

## Summary

Phase 11 builds an analysis engine that reads from the existing `move_signals` table, groups signals by sender + envelope_recipient + source_folder, computes strength scores (matching minus contradicting destinations), and maintains a `proposed_rules` SQLite table. The UI gets a new "Proposed" nav tab where proposals appear as cards with approve/modify/dismiss actions. Approving a proposal calls the existing `ConfigRepository.addRule()` which triggers hot-reload.

This is a self-contained phase with no new external dependencies. Everything is built on the existing stack: better-sqlite3 for storage, Fastify for API routes, vanilla TypeScript SPA for the frontend. The complexity is in the SQL aggregation logic and the state machine for proposal lifecycle (active/approved/dismissed with resurface logic).

**Primary recommendation:** Build a standalone `PatternDetector` class (following MoveTracker's pattern) that takes the DB handle and exposes `analyzeSignals(sender, envelopeRecipient, sourceFolder)` for real-time updates plus `getProposals()` for the API. Hook it into `SignalStore.logSignal()` or the MoveTracker signal logging path.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** One proposal per sender + envelope_recipient + source_folder combination. This is the grouping key for pattern detection.
- **D-02:** Each new move signal either strengthens or weakens an existing proposal. Same destination = +1 strength. Different destination = -1 strength (counterindication). Strength = matching signals - contradicting signals.
- **D-03:** Negative-strength proposals are retained as ambiguous counterindications, not deleted.
- **D-04:** All proposals with strength >= 1 are shown to the user. Ambiguous proposals (negative strength) are also visible. Maximum transparency.
- **D-05:** Strength is displayed as plain language: "Strong pattern (N moves)", "Weak (1 move)", "Ambiguous -- conflicting destinations". No raw numeric scores in UI.
- **D-06:** Conflicted proposals (same sender+recipient+source but different destinations) show as one proposal with the dominant destination, annotated with conflicting destinations and their respective move counts.
- **D-07:** Proposed rules stored in a new SQLite `proposed_rules` table, separate from config.yml real rules.
- **D-08:** Approve action creates a real rule in config.yml via `ConfigRepository.addRule()` and marks the proposal as approved.
- **D-09:** Dismiss action suppresses the proposal, but it resurfaces if 5+ new signals arrive after dismissal.
- **D-10:** Signal retention is 90 days (inherited from Phase 10 D-08).
- **D-11:** Proposed rules get their own "Proposed" nav tab in the top navigation bar.
- **D-12:** Each proposal card shows: plain-language strength label, sender -> destination, envelope recipient, and 2-3 recent example message subjects with dates.
- **D-13:** Each card has Approve, Modify, and Dismiss action buttons.
- **D-14:** Modify opens the existing rule editor pre-filled with the proposed match fields.
- **D-15:** Pattern detection runs immediately after each new move signal is logged.

### Claude's Discretion
- Whether approved proposal rows are kept as historical records or deleted after the real rule is created
- SQL schema details for proposed_rules table (columns, indexes, constraints)
- How conflicting destination data is stored (JSON column, separate table, etc.)
- Exact plain-language thresholds for "Strong" vs "Weak" labels
- How the resurface-after-dismiss threshold (5+ new signals) is tracked
- Sorting/ordering of proposals in the UI (by strength, by recency, etc.)
- Whether to show a badge count on the Proposed tab when new proposals exist

### Deferred Ideas (OUT OF SCOPE)
- LLM analysis to resolve ambiguous proposals
- Subject matching and visibility as automatic pattern refinements
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEARN-03 | System performs statistical analysis on move signals to identify repeating patterns (same sender or domain routed to same destination above configurable thresholds) | PatternDetector class with SQL aggregation over move_signals table, grouped by D-01 key. Configurable thresholds not explicitly required by user decisions (D-04 shows all with strength >= 1), but the analysis engine itself is the core deliverable. |
| LEARN-04 | System surfaces detected patterns as proposed rules in the UI with approve, modify, or dismiss actions | Proposed tab in nav (D-11), proposal cards with strength labels (D-05/D-12), Approve/Modify/Dismiss buttons (D-13), Modify opens pre-filled rule editor (D-14) |
| LEARN-05 | Approved proposed rules become real rules in the active ruleset, integrated with existing config hot-reload | Approve calls `ConfigRepository.addRule()` which triggers `notifyRulesChange()` -> hot-reload (D-08). Already implemented in Phase 10 config system. |
| UI-02 | Proposed rules view displays detected patterns with signal count, confidence, example messages, and approve/modify/dismiss controls | Full card layout per D-12, plain-language strength per D-05, example subjects with dates, action buttons per D-13 |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.6.2 | proposed_rules table, aggregation queries | Already in use for move_signals and activity [VERIFIED: package.json] |
| fastify | 5.7.4 | /api/proposed-rules/* endpoints | Already the server framework [VERIFIED: package.json] |
| zod | 4.3.6 | Input validation for API endpoints | Already used for all schemas [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| picomatch | 4.0.3 | Generate glob patterns for proposed match fields | Already in use for rule matching [VERIFIED: package.json] |

No new dependencies required. This phase is 100% built on the existing stack.

## Architecture Patterns

### Recommended Project Structure
```
src/
  tracking/
    signals.ts          # Existing - SignalStore
    index.ts            # Existing - MoveTracker (hook signal logging here)
    detector.ts         # NEW - PatternDetector class
    proposals.ts        # NEW - ProposalStore (CRUD for proposed_rules table)
  web/
    routes/
      proposed-rules.ts # NEW - API routes for proposals
    frontend/
      app.ts            # MODIFIED - Add "Proposed" nav tab + page renderer
      api.ts            # MODIFIED - Add proposed rules API methods
  shared/
    types.ts            # MODIFIED - Add ProposedRule, ProposalCard types
  log/
    migrations.ts       # MODIFIED - Add proposed_rules table migration
```

### Pattern 1: ProposalStore (Database Layer)
**What:** Dedicated class managing `proposed_rules` table CRUD, following the SignalStore pattern.
**When to use:** All proposal read/write operations.
**Example:**
```typescript
// Source: follows src/tracking/signals.ts pattern [VERIFIED: codebase]
export class ProposalStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  upsertProposal(key: ProposalKey, destination: string, signalId: number): void { ... }
  getProposals(): ProposedRule[] { ... }
  approveProposal(id: number): void { ... }
  dismissProposal(id: number): void { ... }
  getExampleSubjects(proposalId: number, limit?: number): ExampleMessage[] { ... }
}
```

### Pattern 2: PatternDetector (Analysis Engine)
**What:** Stateless analysis class that receives a signal and updates the corresponding proposal.
**When to use:** Called immediately after each `SignalStore.logSignal()` invocation.
**Example:**
```typescript
// Source: follows standalone class pattern from MoveTracker [VERIFIED: codebase]
export class PatternDetector {
  constructor(
    private proposalStore: ProposalStore,
    private signalStore: SignalStore,
  ) {}

  /** Called after a new signal is logged. Updates the affected proposal. */
  processSignal(signal: MoveSignal): void {
    const key = {
      sender: signal.sender,
      envelopeRecipient: signal.envelopeRecipient ?? null,
      sourceFolder: signal.sourceFolder,
    };
    // Upsert proposal: +1 if destination matches dominant, -1 if contradicts
    this.proposalStore.upsertProposal(key, signal.destinationFolder, signal.id);
  }
}
```

### Pattern 3: Hook Into Signal Logging
**What:** After MoveTracker logs a signal, immediately trigger pattern detection.
**When to use:** In MoveTracker.logSignal() private method. [VERIFIED: src/tracking/index.ts line 271-287]
**Example:**
```typescript
// In MoveTracker.logSignal():
private logSignal(msg, sourceFolder, destinationFolder): void {
  const input: MoveSignalInput = { ... };
  this.deps.signalStore.logSignal(input);
  this.signalsLoggedCount++;

  // NEW: trigger pattern detection
  if (this.deps.patternDetector) {
    const signal = this.deps.signalStore.getSignalByMessageId(input.messageId);
    if (signal) this.deps.patternDetector.processSignal(signal);
  }
}
```

### Pattern 4: Proposed Rules API Routes
**What:** Fastify route registration following the rules.ts pattern. [VERIFIED: src/web/routes/rules.ts]
**Routes:**
- `GET /api/proposed-rules` -- List all proposals with example subjects
- `POST /api/proposed-rules/:id/approve` -- Approve (creates real rule, marks approved)
- `POST /api/proposed-rules/:id/modify` -- Returns pre-fill data for rule editor
- `POST /api/proposed-rules/:id/dismiss` -- Dismiss (marks dismissed, tracks signal count)

### Anti-Patterns to Avoid
- **Batch analysis instead of real-time:** D-15 explicitly says pattern detection runs immediately after each signal. Do NOT use a periodic analysis job.
- **Storing proposals in config.yml:** D-07 explicitly says proposals live in SQLite, separate from config. Only approved rules go to config.yml.
- **Exposing raw strength numbers in UI:** D-05 says plain language only. Map numbers to labels server-side or client-side, never show "strength: 7".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rule creation from proposal | Custom config file writer | `ConfigRepository.addRule()` | Already handles Zod validation, YAML persistence, and hot-reload notification [VERIFIED: src/config/repository.ts] |
| Glob pattern for sender match | Manual regex construction | picomatch syntax (exact sender string from signals) | Existing rule matcher uses picomatch [VERIFIED: CONTEXT.md canonical refs] |
| Database migrations | Inline DDL in constructor | `runMigrations()` system | Versioned, idempotent, already tested [VERIFIED: src/log/migrations.ts] |
| Folder picker for Modify flow | New folder selection UI | `renderFolderPicker()` | Already exists in app.ts [VERIFIED: src/web/frontend/app.ts line 214] |
| Rule editor modal | New proposal editor | `openRuleModal()` with pre-filled data | Reuse existing modal, just pass proposal data as a pseudo-Rule [VERIFIED: src/web/frontend/app.ts line 152] |

**Key insight:** The approve flow is trivially simple because `ConfigRepository.addRule()` already does everything: validate via Zod, persist to YAML, notify listeners for hot-reload. The hard part is the SQL analysis and UI, not the integration.

## Proposed Schema Design

### `proposed_rules` Table

```sql
-- Source: [ASSUMED] — schema design based on CONTEXT.md decisions
CREATE TABLE IF NOT EXISTS proposed_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Grouping key (D-01)
  sender TEXT NOT NULL,
  envelope_recipient TEXT,  -- nullable, some signals lack it
  source_folder TEXT NOT NULL,
  -- Dominant destination
  destination_folder TEXT NOT NULL,
  -- Strength tracking (D-02)
  matching_count INTEGER NOT NULL DEFAULT 0,
  contradicting_count INTEGER NOT NULL DEFAULT 0,
  -- Conflicting destinations (D-06) as JSON: {"Newsletters": 3, "Archive": 1}
  destination_counts TEXT NOT NULL DEFAULT '{}',
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active',  -- active | approved | dismissed
  dismissed_at TEXT,
  signals_since_dismiss INTEGER NOT NULL DEFAULT 0,
  approved_rule_id TEXT,  -- UUID of the created real rule, if approved
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_signal_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_key
  ON proposed_rules(sender, COALESCE(envelope_recipient, ''), source_folder);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposed_rules(status);
```

**Design rationale:**
- `destination_counts` as JSON column stores per-destination signal counts (D-06). This avoids a separate join table and keeps queries simple. better-sqlite3 handles JSON just fine for read purposes; we parse in application code. [ASSUMED]
- `matching_count` / `contradicting_count` are denormalized for fast reads. Updated on each signal. [ASSUMED]
- `signals_since_dismiss` tracks the resurface threshold (D-09: 5+ signals after dismiss). Reset on re-dismiss. [ASSUMED]
- `approved_rule_id` links back to the real rule created on approve. Allows keeping approved rows as historical records. [ASSUMED]
- Unique index on the grouping key ensures one proposal per combination (D-01). COALESCE handles nullable envelope_recipient. [ASSUMED]

### Strength Calculation

Per D-02: `strength = matching_count - contradicting_count`

The `destination_counts` JSON lets us compute both values:
- `matching_count` = count for the dominant (highest-count) destination
- `contradicting_count` = sum of counts for all other destinations

### Plain Language Labels (D-05)

Recommended thresholds (Claude's discretion):
- Strength >= 5: **"Strong pattern (N moves)"**
- Strength 2-4: **"Moderate pattern (N moves)"**
- Strength 1: **"Weak (1 move)"**
- Strength <= 0: **"Ambiguous -- conflicting destinations"**

Where N = matching_count (total moves to the dominant destination).

## Common Pitfalls

### Pitfall 1: Race Condition on Concurrent Signal Processing
**What goes wrong:** Two signals arrive near-simultaneously for the same grouping key, both read the current proposal state, both compute new values, one overwrites the other.
**Why it happens:** MoveTracker scans periodically and could log multiple signals per scan.
**How to avoid:** Use SQLite's built-in atomicity. Do the upsert with a single SQL statement (INSERT ... ON CONFLICT DO UPDATE) rather than read-modify-write in application code. [ASSUMED]
**Warning signs:** Strength counts that don't match actual signal counts.

### Pitfall 2: COALESCE Gotcha in Unique Index
**What goes wrong:** Two proposals with `envelope_recipient = NULL` and `envelope_recipient = ''` treated as different entries.
**Why it happens:** SQL NULL vs empty string semantics.
**How to avoid:** Normalize in application code: always store NULL for missing envelope_recipient, use `COALESCE(envelope_recipient, '')` in the unique index. [ASSUMED]
**Warning signs:** Duplicate proposals for the same sender.

### Pitfall 3: Stale Proposal Data After Approve
**What goes wrong:** User approves a proposal, real rule is created, but new signals keep updating the now-approved proposal.
**Why it happens:** PatternDetector doesn't check proposal status before updating.
**How to avoid:** Skip proposals with status='approved' during signal processing. New signals for the same grouping key should NOT create a new proposal (the rule already exists). [ASSUMED]
**Warning signs:** Approved proposals showing updated strength numbers.

### Pitfall 4: Modify Flow Losing Proposal Context
**What goes wrong:** User clicks Modify, rule editor opens, but saving creates a new rule without marking the proposal as approved.
**Why it happens:** The Modify flow opens the existing `openRuleModal()` which doesn't know about proposals.
**How to avoid:** Pass a callback or proposal ID through the Modify flow so that after `addRule()` succeeds, the proposal is marked approved. [ASSUMED]
**Warning signs:** Proposal stays active after user modified and saved it as a real rule.

### Pitfall 5: Resurface Logic Counting Old Signals
**What goes wrong:** After dismissal, the system counts ALL signals (including pre-dismiss ones) toward the 5-signal resurface threshold.
**Why it happens:** Query counts all signals for the grouping key without filtering by dismiss timestamp.
**How to avoid:** `signals_since_dismiss` counter is tracked on the proposal row itself, incremented only for signals arriving after the dismiss action. Reset to 0 on each dismiss. [ASSUMED]
**Warning signs:** Dismissed proposals immediately resurfacing.

## Code Examples

### Migration Addition
```typescript
// Source: follows src/log/migrations.ts pattern [VERIFIED: codebase]
// Add to the migrations array in src/log/migrations.ts
{
  version: '20260412_002',
  description: 'Create proposed_rules table for pattern detection',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS proposed_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        envelope_recipient TEXT,
        source_folder TEXT NOT NULL,
        destination_folder TEXT NOT NULL,
        matching_count INTEGER NOT NULL DEFAULT 0,
        contradicting_count INTEGER NOT NULL DEFAULT 0,
        destination_counts TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        dismissed_at TEXT,
        signals_since_dismiss INTEGER NOT NULL DEFAULT 0,
        approved_rule_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_signal_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_key
      ON proposed_rules(sender, COALESCE(envelope_recipient, ''), source_folder)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposed_rules(status)`);
  },
},
```

### Atomic Upsert for Signal Processing
```typescript
// Source: [ASSUMED] — SQLite INSERT ON CONFLICT pattern
const upsertStmt = db.prepare(`
  INSERT INTO proposed_rules (sender, envelope_recipient, source_folder, destination_folder, destination_counts, matching_count, last_signal_at)
  VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
  ON CONFLICT (sender, COALESCE(envelope_recipient, ''), source_folder)
  DO UPDATE SET
    destination_counts = ?,  -- updated JSON computed in app code
    matching_count = ?,
    contradicting_count = ?,
    destination_folder = ?,  -- dominant destination
    last_signal_at = datetime('now'),
    updated_at = datetime('now'),
    signals_since_dismiss = CASE
      WHEN status = 'dismissed' THEN signals_since_dismiss + 1
      ELSE signals_since_dismiss
    END,
    status = CASE
      WHEN status = 'dismissed' AND signals_since_dismiss + 1 >= 5 THEN 'active'
      ELSE status
    END
`);
```

Note: The ON CONFLICT with COALESCE may require an expression index. If SQLite doesn't support this directly, an alternative is to normalize envelope_recipient to empty string '' at the application level and use a standard unique index on the three columns. [ASSUMED]

### Approve Flow
```typescript
// Source: follows ConfigRepository.addRule() pattern [VERIFIED: src/config/repository.ts]
async approveProposal(proposalId: number, configRepo: ConfigRepository): Promise<Rule> {
  const proposal = this.proposalStore.getById(proposalId);
  if (!proposal) throw new Error('Proposal not found');

  const newRule = configRepo.addRule({
    name: `Auto: ${proposal.sender}`,
    match: {
      sender: proposal.sender,
      ...(proposal.envelopeRecipient ? { deliveredTo: proposal.envelopeRecipient } : {}),
    },
    action: { type: 'move', folder: proposal.destinationFolder },
    enabled: true,
    order: 0,
  });

  this.proposalStore.markApproved(proposalId, newRule.id);
  return newRule;
}
```

### Frontend Nav Addition
```html
<!-- Source: src/web/frontend/index.html [VERIFIED: codebase] -->
<!-- Add after the "batch" button: -->
<button class="nav-btn" data-page="proposed">Proposed</button>
```

```typescript
// Source: follows navigate() pattern in app.ts [VERIFIED: codebase]
// In navigate():
else if (page === 'proposed') renderProposed();
```

### Frontend API Extension
```typescript
// Source: follows api object pattern in api.ts [VERIFIED: codebase]
proposed: {
  list: () => request<ProposedRuleCard[]>('/api/proposed-rules'),
  approve: (id: number) => request<Rule>(`/api/proposed-rules/${id}/approve`, { method: 'POST' }),
  dismiss: (id: number) => request<void>(`/api/proposed-rules/${id}/dismiss`, { method: 'POST' }),
  getModifyData: (id: number) => request<ProposalModifyData>(`/api/proposed-rules/${id}/modify`),
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Batch analysis jobs | Real-time per-signal processing (D-15) | User decision | No stale proposal data, instant feedback |
| Numeric confidence scores | Plain language labels (D-05) | User decision | More approachable UI |
| Delete contradicted proposals | Retain as ambiguous (D-03) | User decision | Preserves data for future LLM analysis |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `destination_counts` as JSON column is preferable to a separate table | Proposed Schema Design | Low -- easy to refactor if JSON parsing becomes a bottleneck, but for a single-user app with hundreds of proposals at most this is fine |
| A2 | SQLite expression index on COALESCE works for unique constraint | Proposed Schema Design | Medium -- if it doesn't, normalize to empty string instead of NULL |
| A3 | Strength labels: >=5 Strong, 2-4 Moderate, 1 Weak, <=0 Ambiguous | Proposed Schema Design | Low -- these are Claude's discretion per CONTEXT.md |
| A4 | Approved proposals should be kept as historical records (status='approved') | Proposed Schema Design | Low -- both options (keep vs delete) work, keeping is more conservative |
| A5 | Sort proposals by strength DESC, then last_signal_at DESC | Not explicitly documented | Low -- reasonable default, easy to change |
| A6 | Badge count on Proposed tab showing count of active proposals | Not explicitly documented | Low -- nice UX touch, trivial to implement or skip |
| A7 | INSERT ON CONFLICT DO UPDATE is the right approach for atomic upserts | Code Examples | Low -- standard SQLite pattern, well-tested |

## Open Questions

1. **Expression index on COALESCE**
   - What we know: SQLite supports expression indexes since 3.9.0 (2015). The project uses better-sqlite3 which bundles a recent SQLite.
   - What's unclear: Whether ON CONFLICT can reference an expression index rather than a column list.
   - Recommendation: Test during implementation. Fallback: normalize NULL to empty string '' in application code and use a plain 3-column unique index. [ASSUMED]

2. **Proposal card UI density**
   - What we know: D-12 specifies what each card shows. The existing UI uses tables for rules, cards for batch.
   - What's unclear: Exact layout/styling.
   - Recommendation: Use card layout (not table) since proposals have variable-length content (example subjects, conflict annotations). Follow batch page styling patterns.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest, from package.json) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run test/unit/tracking/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LEARN-03 | Pattern detection groups signals by sender+recipient+source, computes strength | unit | `npx vitest run test/unit/tracking/detector.test.ts -x` | Wave 0 |
| LEARN-03 | Strength increments on matching destination, decrements on contradicting | unit | `npx vitest run test/unit/tracking/detector.test.ts -x` | Wave 0 |
| LEARN-03 | Conflicted proposals show dominant destination with conflict annotation | unit | `npx vitest run test/unit/tracking/proposals.test.ts -x` | Wave 0 |
| LEARN-04 | GET /api/proposed-rules returns proposals with example subjects | unit | `npx vitest run test/unit/web/proposed-rules.test.ts -x` | Wave 0 |
| LEARN-04 | POST approve creates real rule and marks proposal approved | unit | `npx vitest run test/unit/web/proposed-rules.test.ts -x` | Wave 0 |
| LEARN-04 | POST dismiss marks proposal dismissed, resurfaces after 5 new signals | unit | `npx vitest run test/unit/tracking/proposals.test.ts -x` | Wave 0 |
| LEARN-05 | Approved rule integrates with ConfigRepository.addRule() hot-reload | unit | `npx vitest run test/unit/tracking/detector.test.ts -x` | Wave 0 |
| UI-02 | Proposed page renders cards with strength labels and action buttons | unit | `npx vitest run test/unit/web/frontend.test.ts -x` | Extend existing |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/tracking/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/tracking/detector.test.ts` -- covers LEARN-03, LEARN-05
- [ ] `test/unit/tracking/proposals.test.ts` -- covers ProposalStore CRUD, dismiss/resurface
- [ ] `test/unit/web/proposed-rules.test.ts` -- covers API routes

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A (single-user local app) |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A (single-user) |
| V5 Input Validation | yes | Zod validation on API inputs (proposal ID as integer, approve/dismiss payloads) |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via proposal fields | Tampering | Parameterized queries (already standard in codebase via better-sqlite3 prepared statements) [VERIFIED: codebase] |
| XSS via sender/subject in proposal cards | Tampering | Use `esc()` helper for all innerHTML, or DOM API (`h()` helper) which auto-escapes [VERIFIED: src/web/frontend/app.ts] |
| Stored XSS from move_signals data | Tampering | Signals contain email sender/subject which could have malicious content. Escape on render. [VERIFIED: existing pattern in app.ts] |

## Sources

### Primary (HIGH confidence)
- `src/tracking/signals.ts` -- SignalStore API, move_signals schema
- `src/tracking/index.ts` -- MoveTracker class structure, signal logging hook point
- `src/config/repository.ts` -- ConfigRepository.addRule() with Zod validation and hot-reload
- `src/config/schema.ts` -- Rule, EmailMatch, Action Zod schemas
- `src/web/server.ts` -- ServerDeps interface, route registration pattern
- `src/web/routes/rules.ts` -- REST route pattern for CRUD operations
- `src/web/frontend/app.ts` -- Nav rendering, page routing, rule modal, h()/esc() helpers
- `src/web/frontend/api.ts` -- Typed API wrapper pattern
- `src/log/migrations.ts` -- Versioned migration system
- `src/shared/types.ts` -- Shared type definitions between frontend/backend
- `src/web/frontend/index.html` -- Nav button structure

### Secondary (MEDIUM confidence)
- SQLite documentation on expression indexes and ON CONFLICT -- well-known capabilities but not verified against exact better-sqlite3 bundled version

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, everything exists in the project
- Architecture: HIGH -- follows established patterns verbatim (SignalStore, MoveTracker, route registration)
- Pitfalls: HIGH -- derived directly from the decision constraints and codebase analysis
- Schema design: MEDIUM -- the SQL schema is reasonable but the expression index and JSON column approach need implementation-time validation

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable -- no external dependencies to go stale)
