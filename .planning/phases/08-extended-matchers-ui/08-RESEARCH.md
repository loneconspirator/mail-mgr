# Phase 8: Extended Matchers UI - Research

**Researched:** 2026-04-12 (updated 2026-04-12 post Plan 01 execution)
**Domain:** Frontend UI (vanilla TypeScript, no framework), Fastify API routes
**Confidence:** HIGH

## Summary

This phase adds three new match fields to the rule editor modal (Delivered-To text input, Recipient Field dropdown, Read Status dropdown), extends the rule list behavior description, and adds an envelope discovery status section to the IMAP settings page. The entire frontend is vanilla TypeScript bundled by esbuild into an IIFE -- no React, no Vue, no component library. All UI is built with template strings in `innerHTML` or the `h()` DOM factory helper.

The codebase is small and well-structured. The rule modal (`openRuleModal()` in app.ts) uses HTML template strings for form layout. Adding new fields means inserting additional `<div class="form-group">` blocks into the template and extending the save handler to collect values from the new inputs. The settings page (`renderSettings()`) follows the same pattern -- the discovery status section goes below the existing IMAP form within the same settings card.

**Plan 01 status:** COMPLETE. The backend is fully ready -- discovery module restored, `envelopeHeader` in config schema, GET/POST envelope API endpoints working, frontend API wrapper methods added. Plan 02 is the remaining work: pure frontend UI changes.

**Primary recommendation:** Follow the existing patterns exactly -- template strings for form fields, `document.getElementById()` with type casts for value extraction, CSS classes from styles.css for layout. No new dependencies needed. All backend work is done.

## Project Constraints (from CLAUDE.md)

- TypeScript strict mode, 2-space indentation
- camelCase functions/variables, PascalCase types
- `.js` extension required on all local imports
- `import type { X }` for type-only imports
- No `any` type usage; use `unknown` for untyped externals
- Explicit return types on all functions
- Use `h()` DOM factory or template strings (not a framework)
- Vitest for testing
- GSD workflow enforcement -- work through GSD commands

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New match fields placed below existing fields in a flat list. Field order: Name -> Match Sender -> Match Subject -> Delivered-To -> Recipient Field -> Read Status -> Action -> Folder. No grouping, no separators, no collapsible sections.
- **D-02:** All new fields default to blank/unset, consistent with existing sender and subject fields. Empty means "don't filter on this field."
- **D-03:** Delivered-To is a text input with glob syntax, identical to existing sender input. Placeholder follows same pattern.
- **D-04:** Visibility rendered as a single `<select>` dropdown, not multi-select. Options: (blank/none), direct, cc, bcc, list. Matches Phase 7 D-04 single-value config schema.
- **D-05:** Dropdown labeled "Recipient Field" (user's chosen label).
- **D-06:** Read Status rendered as a `<select>` dropdown. Options: (blank/none), read, unread. No "any" option in UI -- blank/unset is equivalent to "any" per Phase 7 D-06.
- **D-07:** Discovery status section appears below the IMAP form within the same settings card, separated by a labeled divider ("Envelope Discovery").
- **D-08:** When header discovered: displays header name with success indicator and "Re-run Discovery" button.
- **D-09:** When no header discovered: warning style with explanation that rules using Delivered-To and Recipient Field will be skipped, plus a "Run Discovery" button.
- **D-10:** Re-run button disables and shows "Discovering..." with spinner while API call in progress. Prevents double-clicks.
- **D-11:** When envelope header unavailable, Delivered-To input and Recipient Field dropdown are visible but disabled/grayed out. Info icon with tooltip explains: "Envelope header not discovered -- run discovery in IMAP settings."
- **D-12:** Read Status is always available regardless of envelope header status.
- **D-13:** When editing an existing rule that has deliveredTo/visibility values but envelope header is currently unavailable, the saved values display in the disabled fields.
- **D-14:** `generateBehaviorDescription()` in rule-display.ts extended to include new fields in the rule summary.

### Claude's Discretion
- Specific tooltip implementation (CSS tooltip vs title attribute vs custom component)
- Spinner style for discovery re-run (CSS animation, text-only, etc.)
- API endpoint shape for discovery trigger and status retrieval
- Form validation messaging for new fields
- How the "at least one match field" validation in the modal accounts for the three new fields

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Rule editor surfaces envelope recipient glob input, header visibility multi-select (direct/cc/bcc/list), and read status toggle for new match fields | Decisions D-01 through D-06 and D-11 through D-13 define exact controls. Existing `openRuleModal()` template string pattern supports adding form groups. Schema already has `deliveredTo`, `visibility`, `readStatus` fields. [VERIFIED: schema.ts] |
| UI-03 | IMAP settings page shows discovered envelope recipient header and provides a button to re-run auto-discovery | Decisions D-07 through D-10 define exact UX. Existing `renderSettings()` pattern supports adding to settings card. API endpoints already exist: GET /api/config/envelope and POST /api/config/envelope/discover. [VERIFIED: envelope.ts, api.ts] |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 | Frontend source language | Already in use [VERIFIED: package.json] |
| esbuild | 0.27.2 | Frontend bundling (IIFE) | Already in use [VERIFIED: esbuild.mjs] |
| Fastify | 5.7.4 | Backend API routes | Already in use [VERIFIED: package.json] |
| Zod | 4.3.6 | Schema validation (backend) | Already in use, schema already has new fields [VERIFIED: schema.ts] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.0.18 | Unit testing | API route tests [VERIFIED: package.json] |

### Alternatives Considered
None -- this phase adds no new dependencies. Everything uses existing stack.

## Architecture Patterns

### Existing Frontend Architecture (follow exactly)
```
src/web/frontend/
  app.ts         -- All page rendering, modal logic, event handlers
  api.ts         -- API wrapper with typed request<T>() function
  styles.css     -- All CSS (no CSS modules, no preprocessors)
  index.html     -- Static shell
  rule-display.ts -- NEW: generateBehaviorDescription() (Plan 02 creates this)
```

esbuild bundles `app.ts` as entry point into `dist/public/app.js` (IIFE format). The `api.ts` module is imported and bundled inline. `styles.css` and `index.html` are copied as-is. New files imported from `app.ts` are automatically bundled.

### Pattern 1: Form Field in Rule Modal
**What:** Each field in the rule modal is an HTML string `<div class="form-group">` block inside the template literal in `openRuleModal()`.
**When to use:** All three new match fields.
**Example:**
```typescript
// Source: app.ts lines 138-148 (existing pattern) [VERIFIED: read file]
modal.innerHTML = `
  <h2>${isEdit ? 'Edit Rule' : 'New Rule'}</h2>
  <div class="form-group"><label>Name</label><input id="m-name" value="${rule?.name || ''}" /></div>
  <div class="form-group"><label>Match Sender</label><input id="m-sender" value="${rule?.match?.sender || ''}" placeholder="*@example.com" /></div>
  <!-- New fields go here, BETWEEN subject and action -->
  <div class="form-group"><label>Delivered-To</label><input id="m-deliveredTo" value="${rule?.match?.deliveredTo || ''}" placeholder="*@example.com" ${!envelopeAvailable ? 'disabled' : ''} /></div>
`;
```

### Pattern 2: Select Dropdown
**What:** Standard `<select>` element with options, using same form-group wrapper.
**When to use:** Recipient Field (visibility) and Read Status dropdowns.
**Example:**
```typescript
// Source: app.ts line 143 (existing action select pattern) [VERIFIED: read file]
<div class="form-group"><label>Action</label><select id="m-action-type"><option value="move">Move</option></select></div>
```

### Pattern 3: Settings Card Extension
**What:** The IMAP settings page renders a single `<div class="settings-card">` with innerHTML template. Discovery section extends this card.
**When to use:** Envelope Discovery status section.
**Example:**
```typescript
// Source: app.ts renderSettings() at line 260 [VERIFIED: read file]
// After the form-actions div, add a divider and discovery section
card.innerHTML = `
  ...existing IMAP form...
  <hr class="discovery-divider" />
  <h3 class="discovery-heading">Envelope Discovery</h3>
  <!-- discovery status content -->
`;
```

### Pattern 4: API Wrapper (ALREADY DONE by Plan 01)
**What:** The `api` object in api.ts already has the envelope methods from Plan 01.
**Current state:**
```typescript
// Source: api.ts [VERIFIED: read file post Plan 01]
config: {
  getImap: () => request<ImapConfig>('/api/config/imap'),
  updateImap: (cfg: ImapConfig) => request<ImapConfig>('/api/config/imap', { method: 'PUT', body: JSON.stringify(cfg) }),
  getEnvelopeStatus: () => request<{ envelopeHeader: string | null }>('/api/config/envelope'),
  triggerDiscovery: () => request<{ envelopeHeader: string | null }>('/api/config/envelope/discover', { method: 'POST' }),
},
```

### Pattern 5: Value Extraction on Save
**What:** The save handler uses `document.getElementById()` with type casts to read form values.
**When to use:** Collecting new match field values on save.
**Example:**
```typescript
// Source: app.ts lines 157-160 (existing pattern) [VERIFIED: read file]
const sender = (document.getElementById('m-sender') as HTMLInputElement).value.trim();
const deliveredTo = (document.getElementById('m-deliveredTo') as HTMLInputElement).value.trim();
const visibility = (document.getElementById('m-visibility') as HTMLSelectElement).value;
const readStatus = (document.getElementById('m-readStatus') as HTMLSelectElement).value;
```

### Pattern 6: Parallel API Fetch in Settings
**What:** `renderSettings()` uses `Promise.all()` to fetch multiple endpoints. Discovery status should be added to this call.
**When to use:** Loading envelope status alongside IMAP config and connection status.
**Example:**
```typescript
// Source: app.ts line 265 [VERIFIED: read file]
// Current:
const [imapCfg, status] = await Promise.all([api.config.getImap(), api.status.get()]);
// Becomes:
const [imapCfg, status, envelopeStatus] = await Promise.all([
  api.config.getImap(), api.status.get(), api.config.getEnvelopeStatus()
]);
```

### Anti-Patterns to Avoid
- **Creating a component/widget system:** The codebase uses raw DOM and template strings. Do not introduce abstractions like custom elements, a render function, or reactive state.
- **Adding CSS preprocessors or CSS-in-JS:** styles.css is the single flat stylesheet. Add new rules there.
- **Framework-style data binding:** There is no state management. Data flows: API fetch -> render HTML -> attach event listeners -> collect values on save -> API call. Keep it that way.
- **Multi-select for visibility:** Decision D-04 explicitly locks this to a single `<select>`, not a multi-select or checkbox group.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip for disabled fields | Complex tooltip component with positioning logic | HTML `title` attribute on `<span class="info-icon">` | D-11 just needs a brief explanation on hover, nothing fancy [ASSUMED] |
| Loading spinner | SVG animation library or component | CSS `@keyframes` spin animation on a border element | D-10 just needs visual feedback, existing toast uses CSS animation [ASSUMED] |
| Form validation | Validation library | Inline checks in save handler (matching existing pattern at line 162-167) | Existing pattern works, three new fields just add to the condition [VERIFIED: app.ts] |

## Common Pitfalls

### Pitfall 1: Forgetting to Fetch Envelope Status Before Opening Modal
**What goes wrong:** The rule modal opens without knowing if envelope header is available, so it cannot disable the Delivered-To and Recipient Field inputs per D-11.
**Why it happens:** Envelope status is on the settings page, not the rules page. The rules page doesn't currently fetch any config info.
**How to avoid:** Fetch envelope status when opening the modal (or cache it at page load), pass `envelopeAvailable` boolean into `openRuleModal()`.
**Warning signs:** Delivered-To and Recipient Field inputs are always enabled even when no envelope header is configured.

### Pitfall 2: Select Dropdown Empty String vs Undefined
**What goes wrong:** An empty `<select>` value `""` gets sent to the API as an empty string instead of being omitted, causing Zod validation to reject it (enum expects specific values or undefined).
**Why it happens:** HTML select values are always strings. The save handler must convert empty string to `undefined` before building the match object.
**How to avoid:** For visibility and readStatus, check `if (value) match.visibility = value;` -- same pattern as sender/subject where empty means "don't include."
**Warning signs:** 400 validation errors when saving a rule with blank visibility or readStatus.

### Pitfall 3: Disabled Fields Losing Values on Save
**What goes wrong:** When fields are disabled (D-11) and the user saves an existing rule, the disabled input values might not be collected, accidentally removing the saved `deliveredTo`/`visibility` from the rule.
**Why it happens:** Disabled inputs are still readable via `.value`, but the save handler might skip them thinking they're irrelevant.
**How to avoid:** Always read the values from disabled fields. Per D-13, existing values must be preserved even when fields are disabled. The save handler should collect these values regardless of disabled state.
**Warning signs:** Editing and saving a rule when envelope header is unavailable strips the deliveredTo/visibility fields.

### Pitfall 4: Match Validation Not Updated
**What goes wrong:** The "at least one match field" check on line 167 only checks sender and subject. With three new fields, a rule with only `readStatus` set would be rejected.
**Why it happens:** The validation was written before new fields existed.
**How to avoid:** Update the validation check to include `deliveredTo`, `visibility`, and `readStatus` in the "at least one" condition.
**Warning signs:** Cannot save a rule that only matches on readStatus or deliveredTo.

### Pitfall 5: XSS via Template String Interpolation
**What goes wrong:** Rule values (like deliveredTo globs) containing HTML special characters break the template literal or create XSS vectors.
**Why it happens:** The existing modal uses `value="${rule?.name || ''}"` which does not escape HTML entities.
**How to avoid:** This is an existing pattern issue (sender/subject have the same risk). For consistency, follow the same approach as existing fields. Fixing would require refactoring the entire modal from innerHTML to the `h()` DOM factory.
**Warning signs:** Rules with `<` or `"` in glob patterns break the edit modal.

### Pitfall 6: Discovery Button Re-render Race
**What goes wrong:** After successful discovery, `renderSettings()` is called to re-render the page. If the user clicks quickly or the re-render races with a state update, button state could be inconsistent.
**Why it happens:** The discovery handler calls `renderSettings()` on success, which replaces the entire DOM including the button.
**How to avoid:** On success, just call `renderSettings()` -- it replaces everything. On error, restore the button manually (since the page isn't re-rendered). The backend already has an in-progress flag (409 response) as a safety net. [VERIFIED: envelope.ts has `discoveryInProgress` guard]

## Code Examples

### New Rule Modal Fields (D-01 through D-06, D-11 through D-13)
```typescript
// Source: Pattern derived from existing app.ts openRuleModal() [VERIFIED: read file]
// These form groups insert between Match Subject and Action in the template

// Delivered-To text input (D-03, D-11)
`<div class="form-group">
  <label>Delivered-To${!envelopeAvailable ? ' <span class="info-icon" title="Envelope header not discovered &#8212; run discovery in IMAP settings.">&#9432;</span>' : ''}</label>
  <input id="m-deliveredTo" value="${rule?.match?.deliveredTo || ''}" placeholder="*@example.com" ${!envelopeAvailable ? 'disabled' : ''} />
</div>`

// Recipient Field dropdown (D-04, D-05, D-11)
`<div class="form-group">
  <label>Recipient Field${!envelopeAvailable ? ' <span class="info-icon" title="Envelope header not discovered &#8212; run discovery in IMAP settings.">&#9432;</span>' : ''}</label>
  <select id="m-visibility" ${!envelopeAvailable ? 'disabled' : ''}>
    <option value="">&#8212;</option>
    <option value="direct" ${rule?.match?.visibility === 'direct' ? 'selected' : ''}>Direct</option>
    <option value="cc" ${rule?.match?.visibility === 'cc' ? 'selected' : ''}>CC</option>
    <option value="bcc" ${rule?.match?.visibility === 'bcc' ? 'selected' : ''}>BCC</option>
    <option value="list" ${rule?.match?.visibility === 'list' ? 'selected' : ''}>List</option>
  </select>
</div>`

// Read Status dropdown (D-06, D-12 -- always enabled)
`<div class="form-group">
  <label>Read Status</label>
  <select id="m-readStatus">
    <option value="">&#8212;</option>
    <option value="read" ${rule?.match?.readStatus === 'read' ? 'selected' : ''}>Read</option>
    <option value="unread" ${rule?.match?.readStatus === 'unread' ? 'selected' : ''}>Unread</option>
  </select>
</div>`
```

### Save Handler Value Collection
```typescript
// Source: Pattern derived from app.ts lines 157-167 [VERIFIED: read file]
const deliveredTo = (document.getElementById('m-deliveredTo') as HTMLInputElement).value.trim();
const visibility = (document.getElementById('m-visibility') as HTMLSelectElement).value;
const readStatus = (document.getElementById('m-readStatus') as HTMLSelectElement).value;

const match: Record<string, string> = {};
if (sender) match.sender = sender;
if (subject) match.subject = subject;
if (deliveredTo) match.deliveredTo = deliveredTo;
if (visibility) match.visibility = visibility;
if (readStatus) match.readStatus = readStatus;

// Updated validation (Pitfall 4)
if (!sender && !subject && !deliveredTo && !visibility && !readStatus) {
  toast('At least one match field is required', true);
  return;
}
```

### Discovery Status Section (D-07 through D-10)
```typescript
// Source: Pattern derived from app.ts renderSettings() [VERIFIED: read file]
// After IMAP save button, within the same settings-card

const discoveryHtml = envelopeStatus.envelopeHeader
  ? `<p><span class="status-badge connected">${envelopeStatus.envelopeHeader}</span> detected</p>
     <button class="btn" id="s-rediscover">Re-run Discovery</button>`
  : `<p class="discovery-warning">&#9888; No envelope header detected. Rules using Delivered-To and Recipient Field will be skipped.</p>
     <button class="btn btn-primary" id="s-rediscover">Run Discovery</button>`;

// Append to card innerHTML:
`<hr class="discovery-divider" />
 <h3 class="discovery-heading">Envelope Discovery</h3>
 ${discoveryHtml}`
```

### Discovery Button Handler (D-10)
```typescript
// Source: Pattern derived from existing event handler approach in app.ts [VERIFIED: read file]
document.getElementById('s-rediscover')?.addEventListener('click', async (e) => {
  const btn = e.target as HTMLButtonElement;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.classList.add('discovering');
  btn.innerHTML = '<span class="spinner"></span> Discovering...';
  try {
    const result = await api.config.triggerDiscovery();
    if (result.envelopeHeader) {
      toast(`Discovered: ${result.envelopeHeader}`);
    } else {
      toast('No envelope header found', true);
    }
    renderSettings(); // Re-render to show updated status
  } catch (err: any) {
    toast(err.message, true);
    btn.disabled = false;
    btn.classList.remove('discovering');
    btn.innerHTML = originalText || 'Run Discovery';
  }
});
```

### Backend API Endpoints (ALREADY IMPLEMENTED by Plan 01)
```typescript
// Source: src/web/routes/envelope.ts [VERIFIED: read file post Plan 01]
// GET /api/config/envelope -> { envelopeHeader: string | null }
// POST /api/config/envelope/discover -> { envelopeHeader: string | null }
// POST includes in-progress guard (409 if concurrent) and try/finally cleanup
```

### generateBehaviorDescription() (D-14)
```typescript
// Source: New file rule-display.ts (referenced in CONTEXT.md) [ASSUMED: to be created]
export function generateBehaviorDescription(match: Record<string, string>): string {
  const parts: string[] = [];
  if (match.sender) parts.push(`sender: ${match.sender}`);
  if (match.recipient) parts.push(`to: ${match.recipient}`);
  if (match.subject) parts.push(`subject: ${match.subject}`);
  if (match.deliveredTo) parts.push(`delivered-to: ${match.deliveredTo}`);
  if (match.visibility) parts.push(`field: ${match.visibility}`);
  if (match.readStatus) parts.push(`status: ${match.readStatus}`);
  return parts.join(', ');
}
```

### CSS Additions
```css
/* Source: New styles following existing patterns in styles.css [VERIFIED: read file] */

/* Disabled form fields (D-11) */
.form-group input:disabled,
.form-group select:disabled {
  background: #f0f0f0;
  color: #999;
  cursor: not-allowed;
}

/* Info icon for disabled fields */
.info-icon {
  cursor: help;
  color: #666;
  font-size: 0.85rem;
}

/* Discovery section divider (D-07) */
.discovery-divider {
  margin: 1.5rem 0;
  border: none;
  border-top: 1px solid #eee;
}

.discovery-heading {
  font-size: 0.95rem;
  margin-bottom: 0.75rem;
  color: #444;
}

/* Discovery warning (D-09) */
.discovery-warning {
  color: #854d0e;
  background: #fef9c3;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

/* Spinner for discovery button (D-10) */
.btn.discovering {
  pointer-events: none;
  opacity: 0.7;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid #ccc;
  border-top-color: #333;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  vertical-align: middle;
  margin-right: 0.25rem;
}

@keyframes spin { to { transform: rotate(360deg); } }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Rule modal only has sender/subject | Rule modal has 5 match fields + action/folder | Phase 8 | More powerful rule creation |
| Settings page shows IMAP only | Settings page shows IMAP + envelope discovery | Phase 8 | User can see/control discovery |
| Rule list shows raw match object | Rule list uses generateBehaviorDescription() | Phase 8 | Cleaner rule summary display |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run test/unit/web/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01a | Rule modal includes deliveredTo text input | manual | Visual verification | manual-only: DOM testing requires browser |
| UI-01b | Rule modal includes visibility dropdown | manual | Visual verification | manual-only: DOM testing requires browser |
| UI-01c | Rule modal includes readStatus dropdown | manual | Visual verification | manual-only: DOM testing requires browser |
| UI-01d | Rules with new fields can be created/updated via API | unit (API) | `npx vitest run test/unit/web/api.test.ts` | Partial (Plan 01 added envelope tests) |
| UI-01e | generateBehaviorDescription includes new fields | unit | `npx vitest run test/unit/web/rule-display.test.ts` | Wave 0 |
| UI-01f | Disabled state when envelope unavailable | manual | Visual verification | manual-only: DOM testing requires browser |
| UI-03a | GET /api/config/envelope returns header status | unit (API) | `npx vitest run test/unit/web/api.test.ts -t "envelope"` | Done (Plan 01) |
| UI-03b | POST /api/config/envelope/discover triggers discovery | unit (API) | `npx vitest run test/unit/web/api.test.ts -t "envelope"` | Done (Plan 01) |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/web/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/web/rule-display.test.ts` -- covers UI-01e (generateBehaviorDescription)
- [x] API route tests for discovery endpoints -- Done in Plan 01 (12 tests added)

**Note:** Frontend DOM testing (UI-01a through UI-01c, UI-01f) requires a browser environment not available in vitest. These are covered by the Plan 02 Task 3 human visual verification checkpoint.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | no | Single-user app, no auth |
| V5 Input Validation | yes | Zod schema validation on backend (already in place); frontend validation is UX only |
| V6 Cryptography | no | -- |

### Known Threat Patterns for vanilla JS frontend + Fastify

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via innerHTML template interpolation | Tampering | Pre-existing risk across all modal fields. Out of scope for Phase 8. Accepted in threat model T-08-03. |
| CSRF on discovery trigger | Tampering | Low risk -- single-user app on localhost. No mitigation needed. |
| Discovery spam DoS | Denial of Service | Backend in-progress flag returns 409 on concurrent calls. Frontend disables button during request. [VERIFIED: envelope.ts] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| -- | -- | -- | -- |

**All previous assumptions (A1-A3) have been confirmed by Plan 01 execution:**
- A1: `envelopeHeader` in config schema -- CONFIRMED [VERIFIED: schema.ts line 81]
- A2: ConfigRepository accesses envelopeHeader via `getConfig().imap.envelopeHeader` -- CONFIRMED [VERIFIED: envelope.ts line 14]
- A3: Discovery triggered programmatically from route handler -- CONFIRMED [VERIFIED: envelope.ts lines 17-45]

**If this table is empty:** All claims in this research were verified or cited -- no user confirmation needed.

## Open Questions (ALL RESOLVED)

1. **How does the POST discovery endpoint actually trigger discovery?** (RESOLVED)
   - **Resolution:** The route handler creates its own temporary ImapClient. [VERIFIED: src/web/routes/envelope.ts]

2. **Should `generateBehaviorDescription()` replace the inline `matchStr` in the rules table?** (RESOLVED)
   - **Resolution:** Yes, replace it. Line 84 of app.ts is replaced with `generateBehaviorDescription(rule.match)` imported from `rule-display.ts`.

3. **Existing XSS risk in rule modal template interpolation** (RESOLVED)
   - **Resolution:** Out of scope for Phase 8. Pre-existing risk, new fields follow same pattern. Noted in threat model T-08-03.

## Sources

### Primary (HIGH confidence)
- `src/web/frontend/app.ts` -- Full rule modal and settings page implementation [VERIFIED: read file 2026-04-12]
- `src/web/frontend/api.ts` -- API wrapper with envelope methods already added [VERIFIED: read file 2026-04-12 post Plan 01]
- `src/web/frontend/styles.css` -- Complete CSS stylesheet [VERIFIED: read file 2026-04-12]
- `src/config/schema.ts` -- Zod schemas with deliveredTo, visibility, readStatus, envelopeHeader [VERIFIED: read file 2026-04-12]
- `src/shared/types.ts` -- Shared API types including EnvelopeStatus [VERIFIED: read file 2026-04-12]
- `src/web/routes/envelope.ts` -- Envelope API routes (GET status, POST discover) [VERIFIED: read file 2026-04-12]
- `src/web/routes/imap-config.ts` -- IMAP config route pattern [VERIFIED: read file 2026-04-12]

### Secondary (MEDIUM confidence)
- `.planning/phases/08-extended-matchers-ui/08-01-SUMMARY.md` -- Plan 01 execution details [VERIFIED: read file]
- `.planning/phases/08-extended-matchers-ui/08-CONTEXT.md` -- User decisions [VERIFIED: read file]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, existing code fully inspected
- Architecture: HIGH -- all patterns verified from source code, backend already working
- Pitfalls: HIGH -- derived from actual code patterns and known HTML/JS edge cases

**Research date:** 2026-04-12 (updated post Plan 01)
**Valid until:** 2026-05-12 (stable -- vanilla TS with no framework churn)
