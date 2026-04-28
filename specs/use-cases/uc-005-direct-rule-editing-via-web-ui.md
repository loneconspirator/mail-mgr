---
id: UC-005
title: User authors, edits, deletes, and reorders rules directly via the web UI
acceptance-test: test/acceptance/uc_005_direct_rule_editing_via_web_ui.test.ts
starting-states: []
integrations: [IX-001, IX-002, IX-011]
---

## Actors

- **User** — the mailbox owner, interacting with the mail-mgr web UI to manage rules.
- **Mail-mgr** — the background system (WebServer, ConfigRepository, Monitor, ReviewSweeper, BatchEngine, FolderCache).
- **Mail server** — the upstream IMAP server.

## Preconditions

- Mail-mgr is running and connected to the IMAP server.
- The folder cache is populated and contains the destination folders the user intends to use.
- An existing rule R0 exists: `match: { sender: "*@bulk.example.com" }`, `action: { type: "delete" }`, `order: 100`. This rule will be the shadowing context for the reorder variant.
- The user wants to file a sender-and-subject combination that is not yet covered by any rule: messages from `alerts@example.com` with subject matching `*OUTAGE*` should go to "Critical".

## Main Flow

### Phase 1: User creates a multi-field rule

1. The user opens the web UI, clicks "New rule", and fills in the editor:
    - Match: `sender: "alerts@example.com"`, `subject: "*OUTAGE*"`.
    - Action: `move` to "Critical".
    - Name: `"Outage alerts"`.
    - Enabled: true.
2. On submit, the browser sends `POST /api/rules` with the rule body (no `id` field; `order` may be omitted to receive the next available).
3. WebServer calls `ConfigRepository.addRule(input)`, which validates against `ruleSchema`, generates a UUID for `id`, assigns `order = nextOrder()`, persists the updated rules to YAML, and fires the `rulesChange` listener.
4. WebServer checks the rule's destination folder against FolderCache via `checkFolderWarnings`. "Critical" exists, so no warning is attached.
5. The response returns 201 with the created rule (including the generated id and order).

### Phase 2: Rule changes hot-reload across subsystems

6. The `rulesChange` listener fan-out calls:
    - `Monitor.updateRules(newRules)` — the next `newMail` arrival evaluates against the new rule set.
    - `ReviewSweeper.updateRules(newRules)` — the next sweep tick uses the new rule set.
    - `BatchEngine.updateRules(newRules)` — the next batch dry-run/execute uses the new rule set.
    - SentinelLifecycle reconciles which destination folders need sentinels planted.
7. No restart, no IMAP reconnection.

### Phase 3: A matching message arrives and is filed by the new rule

8. An email arrives in INBOX from `alerts@example.com` with subject "PROD OUTAGE p0".
9. Monitor processes the arrival via IX-001; RuleEvaluator returns the new "Outage alerts" rule on its first run.
10. ActionExecutor moves the message to "Critical" via IX-002. ActivityLog records the move with source `arrival` and the new rule's id.

### Phase 4: User edits the rule and the change takes effect immediately

11. The user changes the rule's destination folder from "Critical" to "P0 Alerts" via the editor.
12. The browser sends `PUT /api/rules/{id}` with the full rule body (the frontend always sends the complete rule).
13. WebServer calls `ConfigRepository.updateRule(id, input)`, which validates, replaces the in-memory rule, persists, and fires `rulesChange`.
14. The next arrival from `alerts@example.com` is filed to "P0 Alerts".

### Phase 5: User reorders rules to fix a shadowing problem

15. The user notices that R0 (the bulk-delete rule, `*@bulk.example.com`) sits *above* a newly imported rule R1 that should rescue messages from `notify@bulk.example.com`. Without reordering, R0 deletes those rescues first.
16. The user drags R1 above R0 in the UI.
17. The browser sends `PUT /api/rules/reorder` with the array `[{ id: R1.id, order: R0.order }, { id: R0.id, order: R0.order + 1 }, ...]` for any rules whose order shifted.
18. WebServer calls `ConfigRepository.reorderRules(pairs)`, which applies all updates atomically, persists, and fires `rulesChange`.
19. The next arrival from `notify@bulk.example.com` is now caught by R1 first and survives.

### Phase 6: User deletes the original rule

20. The user clicks "Delete" on R0.
21. The browser sends `DELETE /api/rules/{R0.id}`.
22. WebServer calls `ConfigRepository.deleteRule(id)`, which removes the rule, persists, and fires `rulesChange`.
23. WebServer responds 204. The next bulk-sender arrival is no longer auto-deleted.

## Expected Outcome

- Configuration on disk reflects all five mutations (create, hot-reload-checked update, reorder, delete) in YAML.
- Monitor, ReviewSweeper, and BatchEngine all hold the latest rule set without restart.
- ActivityLog contains entries from Phase 3 (arrival via the created rule).
- No IMAP reconnection occurred during any of the rule changes.

## Variants

### UC-005.a: Validation failure returns 400 without mutation

The user submits a rule whose action is `move` but with no `folder` field. ConfigRepository's `ruleSchema` rejects the input. WebServer returns 400 with `{ error: "Validation failed", details: [...] }`. No file write, no listener fired, no in-memory change.

### UC-005.b: Destination folder warning surfaces in response

The user submits a rule with `move` to "Triage" but FolderCache reports the folder does not exist on the IMAP server. ConfigRepository still creates the rule (rules can reference folders that will be auto-created on first action — see IX-002.6). WebServer attaches `warnings: ["Destination folder \"Triage\" not found on server"]` to the response payload. The UI surfaces the warning so the user can fix the typo or create the folder before the first match.

### UC-005.c: Update of a non-existent rule returns 404

The user's editor was open on a rule that another tab deleted. On submit, `PUT /api/rules/{stale-id}` calls `updateRule`, which returns null. WebServer responds 404; the UI prompts the user to reload.

### UC-005.d: Bulk delete by name prefix

The user wants to remove all rules created by a one-off import labeled `"Imported-2024:*"`. The UI sends `DELETE /api/rules?namePrefix=Imported-2024:`. WebServer requires a prefix of at least 2 characters, finds all rules whose `name` starts with the prefix, deletes each, and returns `{ deleted: N, names: [...] }`. The change fires a single batch of `rulesChange` events (one per delete in the current implementation). If the prefix matches no rules, 404 is returned and nothing is deleted.

### UC-005.e: Toggle enabled without other edits

The user clicks the on/off toggle on a rule row. The frontend sends `PUT /api/rules/{id}` with the full existing rule and `enabled` flipped. RuleEvaluator skips disabled rules; the message either falls through to the next rule or stays in INBOX. Re-enabling reverses the effect on the next arrival.

### UC-005.f: Reorder with a stale id

The user drags rules in a tab whose rule list is stale (another change has happened since load). The submitted reorder array references an id that no longer exists. ConfigRepository's `reorderRules` ignores unknown ids and applies the rest. The UI should reload after reorder to surface drift; this UC does not require coordinated UIs.

### UC-005.g: Hot-reload during a running batch

The user edits a rule while a `BatchEngine.execute()` run is in progress. `BatchEngine.updateRules()` swaps the rules array; messages already evaluated in the prior chunk are unaffected, but the next chunk uses the new rule set. This is the same intentional behavior as UC-004.g, viewed from the editor side.
