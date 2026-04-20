---
phase: quick-260420-dsq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/web/frontend/app.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "User never sees the word 'Skip' as a rule action label anywhere in the UI"
    - "User sees 'Leave in Place' in the rule action dropdown, activity log, rules list, and batch stats"
    - "Backend API, config schema, and storage still use 'skip' internally"
  artifacts:
    - path: "src/web/frontend/app.ts"
      provides: "All user-facing skip->leave-in-place renames"
  key_links:
    - from: "src/web/frontend/app.ts"
      to: "action select dropdown"
      via: "option value='skip' with display text"
      pattern: "option value=\"skip\""
---

<objective>
Rename all user-facing displays of "Skip" to "Leave in Place" in the frontend UI. Backend/API/storage remains "skip" unchanged. This is purely a display label rename.

Purpose: "Skip" is ambiguous — users don't know what it means. "Leave in Place" clearly communicates the action: the email stays where it is.
Output: Updated src/web/frontend/app.ts with all UI-facing "skip" labels changed.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/web/frontend/app.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rename all user-facing "Skip" labels to "Leave in Place"</name>
  <files>src/web/frontend/app.ts</files>
  <action>
Rename every user-facing display of "Skip" to "Leave in Place" in app.ts. The `value="skip"` attributes and all TypeScript type references to 'skip' MUST remain unchanged — only the display text shown to the user changes.

Specific changes (line numbers approximate):

1. **Rule edit modal action dropdown** (~line 197):
   Change display text: `>Skip</option>` to `>Leave in Place</option>`
   Keep: `value="skip"` unchanged

2. **Rules list action display** (~line 107):
   The expression `rule.action.type` renders raw. Add a display mapping so 'skip' shows as 'Leave in Place':
   Change: `'folder' in rule.action ? \`${rule.action.type} -> ${rule.action.folder}\` : rule.action.type`
   To use a helper or inline map: when `rule.action.type === 'skip'`, display 'Leave in Place' instead of 'skip'.
   Similarly capitalize other types for consistency if they aren't already (e.g., 'delete' -> 'Delete', 'move' -> 'Move', 'review' -> 'Review').

3. **Empty state body text for priority senders view** (~line 440):
   Change: `'Sender-only rules with "skip" action will appear here. Create a rule with a single sender match and Skip action to add one.'`
   To: `'Sender-only rules with "Leave in Place" action will appear here. Create a rule with a single sender match and Leave in Place action to add one.'`

4. **Activity log action display** (~line 725):
   The `case 'skip'` display is `'— Inbox'` which is already a nice display — leave this AS IS since it describes the destination not the action name.

5. **Batch progress counters** (~lines 1211, 1239):
   Change: `'Skipped: '` to `'Left in Place: '`

6. **Batch results stat label** (~line 1281):
   Change: `'SKIPPED'` to `'LEFT IN PLACE'`

7. **Conflict checker rule name fallback** (~lines 1429, 1495):
   These use `conflict.rule.action.type` as fallback display. Apply the same display mapping from item 2 so 'skip' shows as 'Leave in Place'.

DO NOT change:
- Any `value="skip"` HTML attributes
- Any TypeScript type annotations ('skip' | 'delete' | ...)
- Any `{ type: 'skip' }` object constructions
- Any API parameter strings
- Backend files (batch/index.ts, config/schema.ts, etc.)
- The activity log action display (line 725) which already shows a nice "— Inbox" label
  </action>
  <verify>
    <automated>cd /Users/mike/git/mail-mgr && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
    - Rule action dropdown shows "Leave in Place" instead of "Skip"
    - Rules list shows "Leave in Place" for skip-type rules
    - Empty priority senders text references "Leave in Place" not "Skip"
    - Batch progress and results show "Left in Place" not "Skipped"
    - All value="skip" attributes and type annotations unchanged
    - TypeScript compiles without errors
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes — no type errors
2. Grep confirms no remaining user-facing "Skip" display labels: `grep -n "Skip\|SKIPPED\|Skipped" src/web/frontend/app.ts` should only show code-level references (value="skip", type checks), not display text
3. Grep confirms new labels exist: `grep -n "Leave in Place\|LEFT IN PLACE\|Left in Place" src/web/frontend/app.ts` shows all renamed locations
</verification>

<success_criteria>
- Zero user-facing instances of "Skip"/"Skipped"/"SKIPPED" as action labels in app.ts
- "Leave in Place" appears in dropdown, rules list, batch stats
- Backend/API unchanged — all 'skip' type values and type annotations intact
- TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/260420-dsq-rename-skip-rule-display-to-leave-in-pla/260420-dsq-SUMMARY.md`
</output>
