---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/web/frontend/app.ts
autonomous: true
must_haves:
  truths:
    - "Add Reviewed Sender modal shows an optional folder picker"
    - "Users can create a reviewed sender rule without selecting a folder"
    - "Users can create a reviewed sender rule with a selected folder"
    - "Selected folder is included in the review action when provided"
  artifacts:
    - path: "src/web/frontend/app.ts"
      provides: "openAddSenderModal with optional folder picker for review type"
      contains: "as-folder-picker"
  key_links:
    - from: "openAddSenderModal"
      to: "renderFolderPicker"
      via: "conditional render for review and move types"
      pattern: "viewType === 'review' || viewType === 'move'"
---

<objective>
Add an optional folder picker/browser to the "Add Reviewed Sender" modal in the Reviewed disposition view.

Purpose: Let users optionally assign a destination folder when adding a reviewed sender, reusing the existing folder picker component.
Output: Modified openAddSenderModal function that renders the folder picker for both 'review' and 'move' view types, with folder being optional for review and required for move.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/web/frontend/app.ts
@src/web/frontend/folder-picker.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add optional folder picker to Add Sender modal for review type</name>
  <files>src/web/frontend/app.ts</files>
  <action>
Modify the `openAddSenderModal` function (around line 321) to show the folder picker for `review` type in addition to `move`. Three changes needed:

1. **HTML template (line 337):** Change the conditional from `viewType === 'move'` to `viewType === 'move' || viewType === 'review'`. For the label, use "Destination Folder" for move and "Folder (optional)" for review:
   ```
   ${(viewType === 'move' || viewType === 'review') ? `<div class="form-group"><label>${viewType === 'move' ? 'Destination Folder' : 'Folder (optional)'}</label><div id="as-folder-picker"></div></div>` : ''}
   ```

2. **Folder picker wiring (line 348):** Change the `if (viewType === 'move')` condition to `if (viewType === 'move' || viewType === 'review')` so `renderFolderPicker` is called for both types.

3. **Action construction (line 402):** Change the review action line to include the folder when selected:
   ```typescript
   else if (viewType === 'review') action = selectedFolder ? { type: 'review', folder: selectedFolder } : { type: 'review' };
   ```

Do NOT change `updateSubmitState` — folder must remain optional for review (submit enabled with just sender), required for move (submit requires both sender and folder). The existing logic already handles this correctly since `updateSubmitState` only enforces folder for `viewType === 'move'`.
  </action>
  <verify>
    <automated>npm test -- --run test/unit/web/folder-picker.test.ts && npm run build</automated>
  </verify>
  <done>
    - Add Reviewed Sender modal shows a folder picker labeled "Folder (optional)"
    - Add Archived Sender modal still shows folder picker labeled "Destination Folder" (unchanged)
    - Folder selection is optional for review: submit enabled with just sender pattern
    - Folder selection is required for move: submit disabled until folder selected (unchanged)
    - When a folder is selected for review, the created rule action includes `{ type: 'review', folder: selectedFolder }`
    - When no folder is selected for review, the created rule action is `{ type: 'review' }` (unchanged behavior)
    - Build succeeds with no type errors
  </done>
</task>

</tasks>

<verification>
- `npm run build` succeeds
- `npm test` passes
- Manual: navigate to Reviewed view, click "+ Add Sender", confirm folder picker appears below sender input with "Folder (optional)" label
- Manual: add a sender without selecting folder — rule created with `{ type: 'review' }` action
- Manual: add a sender with a folder selected — rule created with `{ type: 'review', folder: 'SelectedFolder' }` action
</verification>

<success_criteria>
The Add Reviewed Sender modal includes an optional folder picker that reuses the existing folder-picker component. Users can still create review rules without a folder. The existing Add Archived Sender modal behavior is unchanged.
</success_criteria>

<output>
After completion, create `.planning/quick/260420-did-add-optional-folder-finder-to-new-rule-m/260420-did-SUMMARY.md`
</output>
