---
created: 2026-04-29T06:43:51.149Z
title: Add MOD back-link comments to schema files
area: docs
files:
  - src/
  - specs/modules/
---

## Problem

The `validate-module` deterministic script emits `MOD-SCHEMA-NOT-LINKED-BACK` warnings when a module's `interface-schema` source file does not reference its `MOD-####` ID. Surfaced by `/validate` sweep on 2026-04-28 against MOD-0019; some other modules (MOD-0001 onward) have the comment, but coverage is uneven.

Today's commit fixed `src/batch/index.ts` for MOD-0019. The remaining gaps need a one-pass sweep so future `/validate` runs come back clean.

## Solution

For each module spec under `specs/modules/`, read its `interface-schema:` field, then check whether that source file mentions the module ID at the top:

```bash
for spec in specs/modules/mod-*.md; do
  schema=$(grep -m1 '^interface-schema:' "$spec" | sed 's/interface-schema: *//')
  id=$(grep -m1 '^id:' "$spec" | sed 's/id: *//')
  if ! grep -q "$id" "$schema"; then
    echo "MISSING: $id ($schema)"
  fi
done
```

For each missing one, add a header comment to the top of the schema file, matching the pattern used elsewhere:

```ts
// MOD-XXXX — <Title>
// See specs/modules/mod-xxxx-<slug>.md
```

(Or the equivalent JSDoc-style block if the file already uses one — match local style.)

Re-run `/validate` to confirm `MOD-SCHEMA-NOT-LINKED-BACK` clears for every module.

## Notes

This is paired with the `Populate architecture covers-integrations frontmatter` todo — both are part of cleaning up the recurring back-link warnings that the sweep keeps surfacing. Doing them together would let one `/validate` re-run confirm both are fixed.
