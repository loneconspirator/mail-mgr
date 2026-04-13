---
phase: quick
plan: 260412-sob
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tracking/index.ts
  - src/web/routes/status.ts
  - src/web/frontend/api.ts
  - src/web/frontend/app.ts
  - src/web/server.ts
  - src/shared/types.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "User can see a 'Trigger Deep Scan' button on the Settings page"
    - "Clicking the button fires a deep scan and shows a spinner while running"
    - "After completion, a toast shows how many messages were resolved"
    - "Button is disabled when MoveTracker is not enabled or no messages are pending"
  artifacts:
    - path: "src/tracking/index.ts"
      provides: "Public triggerDeepScan method on MoveTracker"
    - path: "src/web/routes/status.ts"
      provides: "POST /api/tracking/deep-scan and GET /api/tracking/status endpoints"
    - path: "src/web/frontend/api.ts"
      provides: "api.tracking.status() and api.tracking.triggerDeepScan() methods"
    - path: "src/web/frontend/app.ts"
      provides: "Move Tracking card on Settings page with deep scan button"
  key_links:
    - from: "src/web/frontend/app.ts"
      to: "/api/tracking/deep-scan"
      via: "fetch POST on button click"
      pattern: "api.tracking.triggerDeepScan"
    - from: "src/web/routes/status.ts"
      to: "MoveTracker.triggerDeepScan"
      via: "route handler calls tracker method"
      pattern: "getMoveTracker.*triggerDeepScan"
---

<objective>
Add a button to the Settings page that lets the user manually trigger the deep scan for
non-standard move destinations. The deep scan normally runs on a 15-minute interval timer.
This gives the user a way to force it immediately when they know they have pending
messages awaiting destination resolution.

Purpose: Users who move messages to uncommon folders want immediate feedback rather than
waiting up to 15 minutes for the automatic deep scan cycle.

Output: New API endpoint, public method on MoveTracker, and a UI card on the Settings page.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/tracking/index.ts
@src/tracking/destinations.ts
@src/web/server.ts
@src/web/routes/status.ts
@src/web/frontend/api.ts
@src/web/frontend/app.ts
@src/shared/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Expose triggerDeepScan on MoveTracker and add API routes</name>
  <files>src/tracking/index.ts, src/shared/types.ts, src/web/routes/status.ts, src/web/server.ts</files>
  <action>
1. In `src/tracking/index.ts`:
   - Make the existing `runDeepScan()` method public (change `private async runDeepScan` to `async runDeepScan`). It already returns `Promise<void>` which is fine internally, but we need to return the resolved count. Add a new public method:
     ```typescript
     async triggerDeepScan(): Promise<{ resolved: number }> {
       const results = await this.deps.destinationResolver.runDeepScan();
       for (const [messageId, destinationFolder] of results) {
         const entry = this.pendingDeepScanMeta.get(messageId);
         if (entry) {
           this.logSignal(entry, entry.sourceFolder, destinationFolder);
           this.pendingDeepScanMeta.delete(messageId);
         }
       }
       const resolved = results.size;
       this.pendingDeepScanMeta.clear();
       return { resolved };
     }
     ```
   - NOTE: This duplicates the logic from the private `runDeepScan`. Refactor private `runDeepScan` to call `triggerDeepScan` internally to avoid duplication:
     ```typescript
     private async runDeepScan(): Promise<void> {
       await this.triggerDeepScan();
     }
     ```

2. In `src/shared/types.ts`, add:
   ```typescript
   export interface MoveTrackerStatusResponse {
     enabled: boolean;
     lastScanAt: string | null;
     messagesTracked: number;
     signalsLogged: number;
     pendingDeepScan: number;
   }

   export interface DeepScanResponse {
     resolved: number;
   }
   ```

3. In `src/web/routes/status.ts`, add two new routes (keep the existing GET /api/status):
   - `GET /api/tracking/status` — calls `deps.getMoveTracker()?.getState()`, returns MoveTrackerStatusResponse. If tracker is undefined, return `{ enabled: false, lastScanAt: null, messagesTracked: 0, signalsLogged: 0, pendingDeepScan: 0 }`.
   - `POST /api/tracking/deep-scan` — calls `deps.getMoveTracker()?.triggerDeepScan()`. If tracker is undefined or not enabled, return 503 with `{ error: 'Move tracking is not enabled' }`. Otherwise return the `{ resolved: N }` result.

4. No changes needed to `src/web/server.ts` — status routes are already registered and have access to `deps.getMoveTracker()`.
  </action>
  <verify>
    <automated>cd /Users/mike/git/mail-mgr && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>MoveTracker has public triggerDeepScan method. GET /api/tracking/status and POST /api/tracking/deep-scan routes exist and compile cleanly.</done>
</task>

<task type="auto">
  <name>Task 2: Add frontend API methods and Move Tracking card with deep scan button</name>
  <files>src/web/frontend/api.ts, src/web/frontend/app.ts</files>
  <action>
1. In `src/web/frontend/api.ts`:
   - Import `MoveTrackerStatusResponse` and `DeepScanResponse` from shared types (add to existing import line).
   - Add a `tracking` namespace to the `api` object:
     ```typescript
     tracking: {
       status: () => request<MoveTrackerStatusResponse>('/api/tracking/status'),
       triggerDeepScan: () => request<DeepScanResponse>('/api/tracking/deep-scan', { method: 'POST' }),
     },
     ```

2. In `src/web/frontend/app.ts`, in the `renderSettings()` function, after the Review Status card block (around line 495, after `app.append(reviewCard)`), add a new Move Tracking card:
   - Fetch tracking status: add `api.tracking.status().catch(() => null)` to the existing `Promise.all` at the top of renderSettings (line ~382).
   - Build a new card after the review status card:
     ```typescript
     // Move Tracking card
     const trackingStatus = /* the value from Promise.all */;
     if (trackingStatus) {
       const trackingCard = h('div', { className: 'settings-card' });
       const pendingCount = trackingStatus.pendingDeepScan;
       const btnLabel = pendingCount > 0
         ? `Run Deep Scan (${pendingCount} pending)`
         : 'Run Deep Scan';
       const btnDisabled = !trackingStatus.enabled || pendingCount === 0;
       trackingCard.innerHTML = `
         <h2>Move Tracking</h2>
         <div class="review-stats">
           <div class="stat-item"><div class="stat-value">${trackingStatus.messagesTracked}</div><div class="stat-label">Tracked</div></div>
           <div class="stat-item"><div class="stat-value">${trackingStatus.signalsLogged}</div><div class="stat-label">Signals</div></div>
           <div class="stat-item"><div class="stat-value">${pendingCount}</div><div class="stat-label">Pending Deep Scan</div></div>
         </div>
         ${trackingStatus.lastScanAt ? `<p class="sweep-info">Last scan: ${new Date(trackingStatus.lastScanAt).toLocaleString()}</p>` : ''}
         <div class="form-actions">
           <button class="btn${btnDisabled ? '' : ' btn-primary'}" id="t-deep-scan" ${btnDisabled ? 'disabled' : ''}>${btnLabel}</button>
         </div>
       `;
       app.append(trackingCard);

       document.getElementById('t-deep-scan')?.addEventListener('click', async (e) => {
         const btn = e.target as HTMLButtonElement;
         const originalText = btn.textContent;
         btn.disabled = true;
         btn.innerHTML = '<span class="spinner"></span> Scanning...';
         try {
           const result = await api.tracking.triggerDeepScan();
           toast(`Deep scan complete: ${result.resolved} message(s) resolved`);
           renderSettings(); // re-render to update counts
         } catch (err: unknown) {
           toast(err instanceof Error ? err.message : String(err), true);
           btn.disabled = false;
           btn.innerHTML = originalText || 'Run Deep Scan';
         }
       });
     }
     ```
   - Follow the exact same spinner/disabled pattern used by the envelope discovery button (s-rediscover) already in the codebase for consistency.
  </action>
  <verify>
    <automated>cd /Users/mike/git/mail-mgr && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Settings page shows a Move Tracking card with stats and a "Run Deep Scan" button. Button shows spinner while scanning, shows toast with result count on completion, and re-renders the card to update pending count.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser -> POST /api/tracking/deep-scan | User-initiated scan trigger |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-quick-01 | D (Denial of Service) | POST /api/tracking/deep-scan | accept | Deep scan iterates all IMAP folders which is inherently expensive; the 15-min interval timer already does this. Manual trigger is no worse. No rate-limiting needed for single-user local app. |
</threat_model>

<verification>
1. TypeScript compiles: `npx tsc --noEmit`
2. Visit Settings page in browser, confirm Move Tracking card appears
3. If pendingDeepScan > 0, button is enabled and clickable
4. If pendingDeepScan == 0 or tracking disabled, button is disabled
</verification>

<success_criteria>
- Settings page displays Move Tracking card with tracked/signals/pending stats
- "Run Deep Scan" button triggers POST /api/tracking/deep-scan
- Toast shows resolution count on completion
- Button disabled when no pending messages or tracking disabled
</success_criteria>

<output>
After completion, create `.planning/quick/260412-sob-add-a-button-to-manually-trigger-the-dee/260412-sob-SUMMARY.md`
</output>
