---
name: validate-use-case
description: Validate a single use case spec (UC-###) against the rules in specs/README.md — bi-directional links, acceptance test existence and back-references, sub-variant coverage, and step-to-integration mapping. Use whenever a user-facing flow is added, edited, or has its acceptance test wired up; when reviewing a PR that touches specs/use-cases/, specs/integrations/, or an acceptance test file; or when the user says "validate", "check", "lint", or "audit" a use case by ID or filename.
allowed-tools:
  - Bash(npx tsx .claude/skills/validate-use-case/scripts/validate-use-case.ts *)
  - Bash(npx vitest run *)
  - Bash(npm test --)
  - Bash(.claude/skills/dev-env/start.sh *)
  - Bash(docker ps --filter name=greenmail *)
  - Bash(lsof -ti:3143)
  - Skill(dev-env)
  - Read
  - Grep
  - Glob
---

# validate-use-case

Validates a use case spec end-to-end against the rules described in `specs/README.md`. The deterministic structural checks live in a TypeScript script; the fuzzy semantic checks (does the test really exercise the flow? does each step map to a named interaction?) are performed by reading the spec, the test, and the integrations and judging.

The split is deliberate: deterministic checks must be reproducible across reviewers and CI runs and live in code where they can be authorized once and reused; semantic judgments need an LLM in the loop and live in this skill body.

## When to use

Trigger when:
- The user asks to validate, lint, audit, or check a use case by ID (`UC-001`) or by file path.
- A use case is being created or modified.
- An acceptance test file is being wired up to a use case.
- An integration referenced by a use case has its `use-cases:` frontmatter changed.
- A PR review touches `specs/use-cases/`, `specs/integrations/`, or any acceptance test path declared in a use case's frontmatter.

## Inputs

The user supplies one of:
- A use case ID, e.g. `UC-001`
- A path to a use case file, e.g. `specs/use-cases/uc-001-manual-move-to-rule-to-auto-filing.md`

If they don't, ask which one — do not guess.

## Workflow

### Step 1 — Run the deterministic validator

Run the script:

```bash
npx tsx .claude/skills/validate-use-case/scripts/validate-use-case.ts <UC-### or path>
```

The script performs these checks (and emits structured JSON):

| Check | What it does |
|---|---|
| `UC-FRONTMATTER-MISSING-ID` (error) | The use case file has no `id:` in its frontmatter. |
| `UC-ACCEPTANCE-TEST-UNSET` (warning) | `acceptance-test:` is null/empty — fine while a use case is new, but should be filled before the use case is considered "live". |
| `UC-ACCEPTANCE-TEST-MISSING` (error) | `acceptance-test:` points to a file that does not exist. |
| `UC-ACCEPTANCE-TEST-NOT-LINKED-BACK` (error) | The acceptance test file does not contain the use case ID anywhere. |
| `UC-INTEGRATION-MISSING` (error) | `integrations:` lists an `IX-###` that has no spec file. |
| `UC-INTEGRATION-NOT-LINKED-BACK` (error) | A listed integration's `use-cases:` frontmatter does not include this UC. |
| `UC-NO-NUMBERED-STEPS` (warning) | The body has no numbered list — main flow can't be checked. |
| `UC-NO-INTEGRATIONS` (warning) | The use case lists no integrations to map steps against. |
| `UC-STEP-DANGLING-INTERACTION-REF` (error) | A step cites `IX-###.N` but no listed integration declares that sub-ID. |
| `UC-STEP-NO-INTERACTION-REFS` (info) | No step cites any IX reference inline — the step-to-interaction mapping has to be inferred from prose. |
| `UC-SUBVARIANT-NOT-IN-TEST` (error) | A sub-variant ID like `UC-001.a` does not appear anywhere in the acceptance test source. |
| `UC-SUBVARIANTS-WITHOUT-TEST` (warning) | The use case declares sub-variants but has no `acceptance-test`. |

Exit codes: `0` (no errors), `1` (one or more errors), `2` (script failure / argument error).

Read the JSON. Each finding has `id`, `severity`, `message`, and often a `detail` field with concrete remediation guidance.

### Step 2 — Run the acceptance test, if it is wired up

If the report's `acceptanceTest` field is non-null and the script reported the file exists, run it. Use the project's vitest runner targeted at that file specifically. Example:

```bash
npx vitest run <path-from-acceptance-test-frontmatter>
```

Acceptance tests typically need GreenMail running on port 3143. Before running the test, check if GreenMail is up:

```bash
lsof -ti:3143
```

If nothing is listening, start the dev environment via the dev-env skill rather than freestyling docker commands:

```bash
.claude/skills/dev-env/start.sh
```

This is the only sanctioned way to bring up GreenMail for this skill — do not invoke `docker run` or compose directly. After the script reports readiness, re-run the vitest command.

Report whether the test passed. If it failed, surface the failure output verbatim — do not paraphrase test failures.

If `acceptanceTest` is null, skip this step and note that running the acceptance test was deferred because none is declared.

### Step 3 — Semantic checks (the part the script intentionally leaves to you)

These are the fuzzy criteria from `specs/README.md`:

#### 3a. Does each main-flow step map to at least one named interaction?

Read the use case body's main flow. Read the body of each integration listed in `integrations:`. For every numbered step, identify which integration's named interactions cover it. Steps that have no plausible mapping are findings. Variants and sub-variants count too — note which interactions cover each variant.

Be honest about uncertainty: if a step is ambiguous (e.g., "the user opens the UI"), say so rather than forcing a mapping.

Output a small table:

| Step | Description (short) | Mapped interactions |
|---|---|---|
| 1 | Email arrives in INBOX | IX-001.1 |
| ... | ... | ... |

If the structural check (`UC-STEP-DANGLING-INTERACTION-REF`) flagged a citation, your mapping must explain whether the citation is wrong or the integration is missing the sub-ID.

#### 3b. Does the acceptance test really simulate the use case?

Only when an acceptance test is declared and exists. Read it. Confirm:

- The test sets up the declared `starting-states:` (or a faithful equivalent).
- The test drives the actors named in the use case body.
- The test asserts the "Expected outcome" section's observable end state.
- Each sub-variant has its own scenario covering the variant's deviations.

This is judgment, not pattern-matching. If the test happens to mention the use case ID but exercises a different flow, that is still a finding.

If no acceptance test is declared, skip this with a note.

## Reporting

Produce a single report containing three sections — script findings, test run result, semantic check findings — plus an overall verdict.

```
# Use case validation: <UC-ID>

## Script findings (deterministic)
<one bullet per finding, grouped by severity>

## Acceptance test
<pass / fail / not declared, with details>

## Semantic findings
### Step-to-interaction map
<table>
### Acceptance test fidelity
<bullets, or "skipped — no test declared">

## Verdict
PASS  — no errors, warnings acceptable.
WARN  — no errors but warnings worth addressing.
FAIL  — at least one error finding, or the acceptance test failed, or a semantic check found a real defect.
```

## Notes

- The script reads `specs/` from the repo root. If invoked from a subdirectory it walks up looking for `specs/use-cases/`. Pass `--specs-root <dir>` to override.
- Renaming a use case file is fine. Renaming its `id:` frontmatter is not — IDs are immutable per `specs/README.md`. If you find a renamed ID, that's a finding even though the script will not catch it directly (because it follows the new ID).
- Do not edit the use case, the integrations, or the acceptance test as part of validation. Validation reports findings; remediation is a separate task the user authorizes.
