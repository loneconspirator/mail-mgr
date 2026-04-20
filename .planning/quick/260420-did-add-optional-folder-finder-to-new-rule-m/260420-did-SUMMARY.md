# Quick Task 260420-did: Add optional folder finder to New Rule modal

**Date:** 2026-04-20
**Commit:** a31a7ce

## Accomplishments

1. Extended folder picker to Reviewed disposition view's "Add Sender" modal
2. Folder selection is optional for Reviewed (labeled "Folder (optional)") vs required for Archived
3. When a folder is selected in Reviewed view, it's included in the review action; otherwise plain review action is used

## Files Modified

- `src/web/frontend/app.ts` — Extended `openAddSenderModal` to show folder picker for `review` viewType alongside existing `move` support. Three surgical changes: conditional HTML rendering, picker wiring, and action construction with optional folder.
