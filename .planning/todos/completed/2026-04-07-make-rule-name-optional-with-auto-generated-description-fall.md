---
created: 2026-04-07T00:56:33.724Z
title: Make rule name optional with auto-generated description fallback
area: general
files:
  - src/config/schema.ts:47
  - src/web/frontend/app.ts:126,150,204
  - src/log/index.ts:17,39
  - src/web/routes/activity.ts:22
  - test/unit/web/api.test.ts:137
---

## Problem

Rule `name` is currently a required field (`z.string().min(1)`) in the Zod schema. Users must provide a name when creating rules, but often the rule's parameters (match criteria + action) are self-descriptive enough. For example, a rule matching `sender: heathercoxrichardson@substack.com` with action `move → 2_Mailing List` doesn't need a separate name — the parameters tell you what it does.

Key touchpoints where name is required or displayed:
- **Schema**: `src/config/schema.ts:47` — `name: z.string().min(1)`
- **Frontend validation**: `src/web/frontend/app.ts:204` — `if (!name) { toast('Name is required', true); return; }`
- **UI display**: Rules table (`app.ts:126`), edit form (`app.ts:150`), delete confirmation (`app.ts:115`), activity feed (`app.ts:277-278`)
- **Activity log**: `src/log/index.ts` stores `rule_name` alongside `rule_id`
- **API tests**: `test/unit/web/api.test.ts:137` tests empty name validation

## Solution

1. Make `name` optional in the Zod schema (e.g., `z.string().optional()`)
2. Remove frontend validation requiring name
3. Everywhere a rule name is displayed, fall back to a generated description from the rule's parameters — e.g., `"move sender:heathercox...@substack.com → 2_Mailing List"` or similar compact summary of match + action
4. Update activity log handling to use the generated description when `rule_name` is null/empty
5. Update tests accordingly
