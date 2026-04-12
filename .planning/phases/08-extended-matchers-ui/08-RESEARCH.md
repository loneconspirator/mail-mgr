# Phase 8: Extended Matchers UI - Research

**Researched:** 2026-04-12
**Domain:** Frontend UI (vanilla TypeScript, no framework), Fastify API routes
**Confidence:** HIGH

## Summary

This phase adds three new match fields to the rule editor modal (Delivered-To text input, Recipient Field dropdown, Read Status dropdown), extends the rule list behavior description, and adds an envelope discovery status section to the IMAP settings page. The entire frontend is vanilla TypeScript bundled by esbuild into an IIFE -- no React, no Vue, no component library. All UI is built with template strings in `innerHTML` or the `h()` DOM factory helper.

The codebase is small and well-structured. The rule modal (`openRuleModal()` in app.ts) uses HTML template strings for form layout. Adding new fields means inserting additional `<div class="form-group">` blocks into the template and extending the save handler to collect values from the new inputs. The settings page (`renderSettings()`) follows the same pattern -- the discovery status section goes below the existing IMAP form within the same settings card. A new API endpoint is needed for triggering discovery and retrieving status (`envelopeHeader` from config).

**Primary recommendation:** Follow the existing patterns exactly -- template strings for form fields, `document.getElementById()` with type casts for value extraction, CSS classes from styles.css for layout. No new dependencies needed. The backend needs two additions: a GET endpoint for envelope header status and a POST endpoint to trigger re-discovery.

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
| UI-01 | Rule editor surfaces envelope recipient glob input, header visibility multi-select (direct/cc/bcc/list), and read status toggle for new match fields | Decisions D-01 through D-06 and D-11 through D-13 define exact controls. Existing `openRuleModal()` template string pattern supports adding form groups. Schema already has `deliveredTo`, `visibility`, `readStatus` fields (Phase 7 complete). |
| UI-03 | IMAP settings page shows discovered envelope recipient header and provides a button to re-run auto-discovery | Decisions D-07 through D-10 define exact UX. Existing `renderSettings()` pattern supports adding to settings card. New API endpoints needed for status and trigger. |
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
```

esbuild bundles `app.ts` as entry point into `dist/public/app.js` (IIFE format). The `api.ts` module is imported and bundled inline. `styles.css` and `index.html` are copied as-is.

### Pattern 1: Form Field in Rule Modal
**What:** Each field in the rule modal is an HTML string `<div class="form-group">` block inside the template literal in `openRuleModal()`.
**When to use:** All three new match fields.
**Example:**
```typescript
// Source: app.ts lines 138-148 (existing pattern)
modal.innerHTML = `
  <h2>${isEdit ? 'Edit Rule' : 'New Rule'}</h2>
  <div class="form-group"><label>Name</label><input id="m-name" value="${rule?.name || ''}" /></div>
  <div class="form-group"><label>Match Sender</label><input id="m-sender" value="${rule?.match?.sender || ''}" placeholder="*@example.com" /></div>
  <!-- New fields go here, BETWEEN subject and action -->
  <div class="form-group"><label>Delivered-To</label><input id="m-deliveredTo" value="${rule?.match?.deliveredTo || ''}" placeholder="*@example.com" ${!envelopeAvailable ? 'disabled' : ''} /></div>
`;
```
[VERIFIED: app.ts openRuleModal() at line 133]

### Pattern 2: Select Dropdown
**What:** Standard `<select>` element with options, using same form-group wrapper.
**When to use:** Recipient Field (visibility) and Read Status dropdowns.
**Example:**
```typescript
// Source: app.ts line 143 (existing action select pattern)
<div class="form-group"><label>Action</label><select id="m-action-type"><option value="move">Move</option></select></div>
```
[VERIFIED: app.ts line 143]

### Pattern 3: Settings Card Extension
**What:** The IMAP settings page renders a single `<div class="settings-card">` with innerHTML template. Discovery section extends this card.
**When to use:** Envelope Discovery status section.
**Example:**
```typescript
// Source: app.ts renderSettings() at line 260
// After the form-actions div, add a divider and discovery section
card.innerHTML = `
  ...existing IMAP form...
  <hr style="margin: 1.5rem 0; border-color: #eee;" />
  <h3 style="font-size: 0.95rem; margin-bottom: 0.75rem;">Envelope Discovery</h3>
  <!-- discovery status content -->
`;
```
[VERIFIED: app.ts renderSettings() at line 260]

### Pattern 4: API Wrapper Extension
**What:** The `api` object in api.ts uses a `request<T>()` generic function. New endpoints follow same pattern.
**When to use:** Discovery status GET and trigger POST.
**Example:**
```typescript
// Source: api.ts lines 22-40 (existing pattern)
export const api = {
  // ... existing namespaces ...
  config: {
    getImap: () => request<ImapConfig>('/api/config/imap'),
    updateImap: (cfg: ImapConfig) => request<ImapConfig>('/api/config/imap', { method: 'PUT', body: JSON.stringify(cfg) }),
    // New:
    getEnvelopeStatus: () => request<EnvelopeStatus>('/api/config/envelope'),
    triggerDiscovery: () => request<EnvelopeStatus>('/api/config/envelope/discover', { method: 'POST' }),
  },
};
```
[VERIFIED: api.ts]

### Pattern 5: Value Extraction on Save
**What:** The save handler uses `document.getElementById()` with type casts to read form values.
**When to use:** Collecting new match field values on save.
**Example:**
```typescript
// Source: app.ts lines 157-160 (existing pattern)
const sender = (document.getElementById('m-sender') as HTMLInputElement).value.trim();
const deliveredTo = (document.getElementById('m-deliveredTo') as HTMLInputElement).value.trim();
const visibility = (document.getElementById('m-visibility') as HTMLSelectElement).value;
const readStatus = (document.getElementById('m-readStatus') as HTMLSelectElement).value;
```
[VERIFIED: app.ts lines 157-160]

### Anti-Patterns to Avoid
- **Creating a component/widget system:** The codebase uses raw DOM and template strings. Do not introduce abstractions like custom elements, a render function, or reactive state.
- **Adding CSS preprocessors or CSS-in-JS:** styles.css is the single flat stylesheet. Add new rules there.
- **Framework-style data binding:** There is no state management. Data flows: API fetch -> render HTML -> attach event listeners -> collect values on save -> API call. Keep it that way.
- **Multi-select for visibility:** Decision D-04 explicitly locks this to a single `<select>`, not a multi-select or checkbox group.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip for disabled fields | Complex tooltip component with positioning logic | CSS `title` attribute or a simple CSS-only tooltip using `::after` pseudo-element | D-11 just needs a brief explanation on hover, nothing fancy |
| Loading spinner | SVG animation library or component | CSS `@keyframes` spin animation on a border element, or text-only "Discovering..." | D-10 just needs visual feedback, existing toast uses CSS animation |
| Form validation | Validation library | Inline checks in save handler (matching existing pattern at line 162-167) | Existing pattern works, three new fields just add to the condition |

## Common Pitfalls

### Pitfall 1: Forgetting to Fetch Envelope Status Before Opening Modal
**What goes wrong:** The rule modal opens without knowing if envelope header is available, so it cannot disable the Delivered-To and Recipient Field inputs per D-11.
**Why it happens:** Envelope status is on the settings page, not the rules page. The rules page doesn't currently fetch any config info.
**How to avoid:** Fetch envelope status when the rules page loads (or cache it), pass `envelopeAvailable` boolean into `openRuleModal()`.
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
**How to avoid:** This is an existing pattern issue (sender/subject have the same risk). For consistency, follow the same approach as existing fields. If fixing, use `h()` helper to create inputs programmatically instead of innerHTML. But NOTE: the existing code uses innerHTML for ALL modal fields, so changing approach mid-modal would be inconsistent.
**Warning signs:** Rules with `<` or `"` in glob patterns break the edit modal.

## Code Examples

### New Rule Modal Fields (D-01 through D-06, D-11 through D-13)
```typescript
// Source: Pattern derived from existing app.ts openRuleModal()
// These form groups insert between Match Subject and Action in the template

// Delivered-To text input (D-03, D-11)
`<div class="form-group">
  <label>Delivered-To${!envelopeAvailable ? ' <span class="info-icon" title="Envelope header not discovered — run discovery in IMAP settings.">&#9432;</span>' : ''}</label>
  <input id="m-deliveredTo" value="${rule?.match?.deliveredTo || ''}" placeholder="*@example.com" ${!envelopeAvailable ? 'disabled' : ''} />
</div>`

// Recipient Field dropdown (D-04, D-05, D-11)
`<div class="form-group">
  <label>Recipient Field${!envelopeAvailable ? ' <span class="info-icon" title="Envelope header not discovered — run discovery in IMAP settings.">&#9432;</span>' : ''}</label>
  <select id="m-visibility" ${!envelopeAvailable ? 'disabled' : ''}>
    <option value="">—</option>
    <option value="direct" ${rule?.match?.visibility === 'direct' ? 'selected' : ''}>Direct</option>
    <option value="cc" ${rule?.match?.visibility === 'cc' ? 'selected' : ''}>CC</option>
    <option value="bcc" ${rule?.match?.visibility === 'bcc' ? 'selected' : ''}>BCC</option>
    <option value="list" ${rule?.match?.visibility === 'list' ? 'selected' : ''}>List</option>
  </select>
</div>`

// Read Status dropdown (D-06, D-12 — always enabled)
`<div class="form-group">
  <label>Read Status</label>
  <select id="m-readStatus">
    <option value="">—</option>
    <option value="read" ${rule?.match?.readStatus === 'read' ? 'selected' : ''}>Read</option>
    <option value="unread" ${rule?.match?.readStatus === 'unread' ? 'selected' : ''}>Unread</option>
  </select>
</div>`
```
[VERIFIED: pattern matches existing app.ts template approach]

### Save Handler Value Collection
```typescript
// Source: Pattern derived from app.ts lines 157-167
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
// Source: Pattern derived from app.ts renderSettings()
// After IMAP save button, within the same settings-card

const discoveryHtml = envelopeStatus.envelopeHeader
  ? `<p><span class="status-badge connected">${envelopeStatus.envelopeHeader}</span> detected</p>
     <button class="btn" id="s-rediscover">Re-run Discovery</button>`
  : `<p class="discovery-warning">No envelope header detected. Rules using Delivered-To and Recipient Field will be skipped.</p>
     <button class="btn btn-primary" id="s-rediscover">Run Discovery</button>`;

// Append to card innerHTML:
`<hr class="discovery-divider" />
 <h3 class="discovery-heading">Envelope Discovery</h3>
 ${discoveryHtml}`
```

### API Endpoints for Discovery
```typescript
// Source: Pattern derived from imap-config.ts

// Types
interface EnvelopeStatus {
  envelopeHeader: string | null;
}

// GET /api/config/envelope — returns current envelope header status
app.get('/api/config/envelope', async () => {
  const config = deps.configRepo.getConfig();
  return { envelopeHeader: config.imap.envelopeHeader ?? null };
});

// POST /api/config/envelope/discover — creates temporary ImapClient, probes headers, persists result
app.post('/api/config/envelope/discover', async (request, reply) => {
  const config = deps.configRepo.getConfig();
  const imapConfig = config.imap;
  const client = new ImapClient(imapConfig, (cfg) =>
    new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.tls, auth: cfg.auth, logger: false }) as any
  );
  await client.connect();
  const header = await probeEnvelopeHeaders(client);
  await client.disconnect();
  await deps.configRepo.updateImapConfig({ ...imapConfig, envelopeHeader: header ?? undefined });
  return { envelopeHeader: header };
});
```

### generateBehaviorDescription() (D-14)
```typescript
// Source: New file rule-display.ts (referenced in CONTEXT.md)
// Generates human-readable summary for the rule list table Match column

export function generateBehaviorDescription(match: Record<string, string>): string {
  const parts: string[] = [];
  if (match.sender) parts.push(`sender: ${match.sender}`);
  if (match.recipient) parts.push(`to: ${match.recipient}`);
  if (match.subject) parts.push(`subject: ${match.subject}`);
  if (match.deliveredTo) parts.push(`delivered-to: ${match.deliveredTo}`);
  if (match.visibility) parts.push(`visibility: ${match.visibility}`);
  if (match.readStatus) parts.push(`status: ${match.readStatus}`);
  return parts.join(', ');
}
```

### CSS Additions
```css
/* Source: New styles following existing patterns in styles.css */

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
| UI-01a | Rule modal includes deliveredTo text input | unit (API) | `npx vitest run test/unit/web/frontend.test.ts -t "deliveredTo"` | Wave 0 |
| UI-01b | Rule modal includes visibility dropdown | unit (API) | `npx vitest run test/unit/web/frontend.test.ts -t "visibility"` | Wave 0 |
| UI-01c | Rule modal includes readStatus dropdown | unit (API) | `npx vitest run test/unit/web/frontend.test.ts -t "readStatus"` | Wave 0 |
| UI-01d | Rules with new fields can be created/updated via API | unit (API) | `npx vitest run test/unit/web/api.test.ts -t "new match fields"` | Wave 0 |
| UI-01e | generateBehaviorDescription includes new fields | unit | `npx vitest run test/unit/web/rule-display.test.ts` | Wave 0 |
| UI-01f | Disabled state when envelope unavailable | manual | Visual verification | manual-only: DOM testing requires browser environment |
| UI-03a | GET /api/config/envelope returns header status | unit (API) | `npx vitest run test/unit/web/api.test.ts -t "envelope status"` | Wave 0 |
| UI-03b | POST /api/config/envelope/discover triggers discovery | unit (API) | `npx vitest run test/unit/web/api.test.ts -t "trigger discovery"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/unit/web/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/web/rule-display.test.ts` -- covers UI-01e (generateBehaviorDescription)
- [ ] API route tests for discovery endpoints in `test/unit/web/api.test.ts` -- covers UI-03a, UI-03b
- [ ] API route tests for new match fields in rules CRUD -- covers UI-01d

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
| XSS via innerHTML template interpolation | Tampering | Pre-existing risk across all modal fields. Out of scope for Phase 8 (see resolved Q3 below). Accepted in threat model T-08-03. |
| CSRF on discovery trigger | Tampering | Low risk -- single-user app on localhost. No mitigation needed. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 6 will have added `envelopeHeader` to imap config schema and implemented discovery | Architecture Patterns | Discovery status API cannot be built without the backend discovery mechanism |
| A2 | ConfigRepository will have a method to access `envelopeHeader` | Code Examples | Need to read config differently if getter doesn't exist |
| A3 | Discovery can be triggered programmatically from a route handler | Code Examples | If discovery requires IMAP connection lifecycle management, the POST endpoint shape changes |

## Open Questions (RESOLVED)

1. **How does the POST discovery endpoint actually trigger discovery?** (RESOLVED)
   - **Resolution:** The route handler creates its own temporary ImapClient directly. No ServerDeps extension needed. `src/index.ts` shows the pattern at lines 33 and 42: `new ImapClient(config.imap, createImapFlow)` where `createImapFlow` constructs an `ImapFlow` from config fields (host, port, tls, auth). The POST handler in `src/web/routes/envelope.ts` reproduces this pattern inline -- it reads imap config from `deps.configRepo.getConfig()`, creates a temporary `ImapClient` with an inline `ImapFlow` factory, calls `client.connect()`, runs `probeEnvelopeHeaders(client)`, calls `client.disconnect()`, persists the result via `deps.configRepo.updateImapConfig()`, and returns the status. The `createImapFlow` factory in `src/index.ts` is only 4 lines and trivially reproducible in the route handler. Plan 01 Task 2 action reflects this exact approach.

2. **Should `generateBehaviorDescription()` replace the inline `matchStr` in the rules table?** (RESOLVED)
   - **Resolution:** Yes, replace it. Line 84 of app.ts (`Object.entries(rule.match).map(...)`) is replaced with `generateBehaviorDescription(rule.match)` imported from `rule-display.ts`. This provides human-readable labels ("delivered-to" instead of "deliveredTo", "field: direct" instead of "visibility: direct"). Plan 02 Task 1 Step 4 implements this replacement.

3. **Existing XSS risk in rule modal template interpolation** (RESOLVED)
   - **Resolution:** Out of scope for Phase 8. This is a pre-existing risk across all modal fields (sender, subject, name all use unescaped `value="${...}"`). New fields follow the same pattern for consistency. Fixing would require refactoring the entire modal from innerHTML to the `h()` DOM factory, which is a separate concern. Noted as a known risk in the threat model (T-08-03, disposition: accept).

## Sources

### Primary (HIGH confidence)
- `src/web/frontend/app.ts` -- Full rule modal and settings page implementation [VERIFIED: read file]
- `src/web/frontend/api.ts` -- API wrapper with typed request function [VERIFIED: read file]
- `src/web/frontend/styles.css` -- Complete CSS stylesheet [VERIFIED: read file]
- `src/config/schema.ts` -- Zod schemas including Phase 7 additions (deliveredTo, visibility, readStatus already present) [VERIFIED: read file]
- `src/shared/types.ts` -- Shared API types [VERIFIED: read file]
- `src/web/routes/imap-config.ts` -- IMAP config route pattern [VERIFIED: read file]
- `src/config/repository.ts` -- ConfigRepository class [VERIFIED: read file]
- `src/web/server.ts` -- Server setup and dependency injection [VERIFIED: read file]
- `esbuild.mjs` -- Frontend build configuration [VERIFIED: read file]

### Secondary (MEDIUM confidence)
- `.planning/phases/06-extended-message-data/06-CONTEXT.md` -- Phase 6 decisions on discovery mechanism [VERIFIED: read file]
- `.planning/phases/07-extended-matchers/07-CONTEXT.md` -- Phase 7 decisions on field names and schema [VERIFIED: read file]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, existing code fully inspected
- Architecture: HIGH -- all patterns verified from source code
- Pitfalls: HIGH -- derived from actual code patterns and known HTML/JS edge cases

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable -- vanilla TS with no framework churn)
