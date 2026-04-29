---
created: 2026-04-29T06:43:51.149Z
title: Populate architecture covers-integrations frontmatter
area: docs
files:
  - specs/architecture.md
---

## Problem

`specs/architecture.md` declares both `covers-modules: []` and `covers-integrations: []` (empty arrays). The `/validate` sweep on 2026-04-28 emitted `IX-ARCHITECTURE-NOT-MENTIONED` warnings against IX-009, IX-010, IX-011, IX-012 — and the same warning is suppressed for the others only because they happen to be name-mentioned in prose. The empty list is a project-wide gap that affects roughly half the integrations.

The architecture file does describe most integrations by ID or by behavior in the body (e.g. UC-001 chain section names IX-001 → IX-005, Action Folders section names IX-007/IX-008), but the frontmatter doesn't declare what it covers, so the validator's primary back-link check is never satisfied.

## Solution

Walk every artifact in `specs/integrations/` and `specs/modules/` once and decide which the architecture file should claim coverage of. Realistically: all of them, since this is the single architecture doc for the project.

Update `specs/architecture.md` frontmatter:

```yaml
---
title: Mail-Mgr System Architecture
covers-modules: [MOD-0001, MOD-0002, MOD-0003, MOD-0004, MOD-0005, MOD-0006,
                 MOD-0007, MOD-0008, MOD-0009, MOD-0010, MOD-0011, MOD-0012,
                 MOD-0013, MOD-0014, MOD-0015, MOD-0016, MOD-0017, MOD-0018,
                 MOD-0019]
covers-integrations: [IX-001, IX-002, IX-003, IX-004, IX-005, IX-006,
                      IX-007, IX-008, IX-009, IX-010, IX-011, IX-012]
---
```

While doing this, also confirm each ID is referenced (by name, ID, or section anchor) somewhere in the architecture body — if any aren't, add a one-liner so the back-link is more than just frontmatter bookkeeping.

Re-run `/validate` to confirm the `IX-ARCHITECTURE-NOT-MENTIONED` and `MOD-ARCHITECTURE-NOT-LINKED-BACK` warnings clear across the board.
