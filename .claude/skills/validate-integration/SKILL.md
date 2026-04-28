---
name: validate-integration
description: Validate a single integration spec (IX-###) against the rules in specs/README.md — bi-directional links to architecture, modules, and use cases; integration-test existence and back-reference; and named-interaction (IX-###.N) coverage in the test file. Use whenever an integration spec is added, edited, or has its `integration-test`, `architecture-section`, `modules`, or `use-cases` changed; when reviewing a PR that touches `specs/integrations/`, `specs/architecture.md`, or any integration test file; or when the user says "validate", "check", "lint", or "audit" an integration by ID or filename.
allowed-tools:
  - Bash(npx tsx .claude/skills/validate-integration/scripts/validate-integration.ts *)
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

# validate-integration

Validates an integration spec end-to-end against the rules described in `specs/README.md`. The deterministic structural checks live in a TypeScript script; the fuzzy semantic check (do the integration tests really exercise what the spec describes?) is performed by reading the spec, the architecture section, the participating modules, and the test file and judging.

The split is deliberate: deterministic checks must be reproducible across reviewers and CI runs and live in code where they can be authorized once and reused; semantic judgments need an LLM in the loop and live in this skill body.

## When to use

Trigger when:
- The user asks to validate, lint, audit, or check an integration by ID (`IX-014`) or by file path.
- An integration spec is being created or modified.
- An integration test file is being wired up to an integration.
- A module's `integrations:` frontmatter changes — both directions of the link must still match.
- A use case's `integrations:` frontmatter changes.
- The architecture file's `covers-integrations:` list changes, or a section header referenced by an integration's `architecture-section` is renamed.
- A PR review touches `specs/integrations/`, `specs/architecture.md`, `specs/modules/`, `specs/use-cases/`, or any path declared as an integration's `integration-test`.

## Inputs

The user supplies one of:
- An integration ID, e.g. `IX-014`
- A path to an integration file, e.g. `specs/integrations/ix-001-arrival-detection-and-rule-evaluation.md`

If they don't, ask which one — do not guess.

## Workflow

### Step 1 — Run the deterministic validator

Run the script:

```bash
npx tsx .claude/skills/validate-integration/scripts/validate-integration.ts <IX-### or path>
```

The script performs these checks (and emits structured JSON):

| Check | What it does |
|---|---|
| `IX-FRONTMATTER-MISSING-ID` (error) | The integration file has no `id:` in its frontmatter. |
| `IX-INTEGRATION-TEST-UNSET` (warning) | `integration-test:` is null/empty — fine while an integration is new, but should be filled before it is considered "live". |
| `IX-INTEGRATION-TEST-MISSING` (error) | `integration-test:` points to a file that does not exist. |
| `IX-INTEGRATION-TEST-NOT-LINKED-BACK` (error) | The integration test file does not contain the integration ID anywhere. |
| `IX-INTEGRATION-TEST-NOT-IMPLEMENTED` (error) | The integration ID appears in the test only inside a stubbed declaration (`it.todo`, `it.skip`, `xit`, etc.) — there is no real test body. |
| `IX-ARCHITECTURE-UNSET` (warning) | `architecture-section:` is null/empty — the cross-reference graph from integration to architecture is incomplete. |
| `IX-ARCHITECTURE-FILE-MISSING` (error) | `architecture-section:` points to a file that does not exist. |
| `IX-ARCHITECTURE-ANCHOR-MISSING` (error) | The `#anchor` in `architecture-section` does not match any heading slug in the referenced architecture file. |
| `IX-ARCHITECTURE-NOT-LINKED-BACK` (error) | The architecture file declares `covers-integrations:` but does not include this integration's ID. |
| `IX-ARCHITECTURE-NOT-MENTIONED` (warning) | The architecture file does not declare `covers-integrations:` and also does not mention this integration by ID or title. |
| `IX-MODULE-MISSING` (error) | `modules:` lists a `MOD-####` that has no spec file. |
| `IX-MODULE-NOT-LINKED-BACK` (error) | A listed module's `integrations:` frontmatter does not include this IX. |
| `IX-MODULE-MISSING-FORWARD-REF` (error) | A module lists this integration in its `integrations:` but the integration does not list that module in its `modules:`. |
| `IX-USE-CASE-MISSING` (error) | `use-cases:` lists a `UC-###` that has no spec file. |
| `IX-USE-CASE-NOT-LINKED-BACK` (error) | A listed use case's `integrations:` frontmatter does not include this IX. |
| `IX-USE-CASE-MISSING-FORWARD-REF` (error) | A use case lists this integration in its `integrations:` but the integration does not list that use case in its `use-cases:`. |
| `IX-STARTING-STATE-MISSING` (error) | `starting-states:` lists an `SS-###` that has no spec file. |
| `IX-NO-NAMED-INTERACTIONS` (warning) | The body declares no `IX-###.N` named interactions — coverage check is skipped. |
| `IX-NAMED-INTERACTION-NOT-IN-TEST` (error) | A named interaction `IX-###.N` is not referenced in the integration test file. |
| `IX-NAMED-INTERACTION-NOT-IMPLEMENTED` (error) | A named interaction appears in the test only inside a stubbed declaration or only in comments — no real test exercises it. |
| `IX-NAMED-INTERACTIONS-WITHOUT-TEST` (warning) | The integration declares named interactions but has no `integration-test`. |

Exit codes: `0` (no errors), `1` (one or more errors), `2` (script failure / argument error).

Read the JSON. Each finding has `id`, `severity`, `message`, and often a `detail` field with concrete remediation guidance.

### Step 2 — Run the integration test, if it is wired up

If the report's `integrationTest` field is non-null and the script reported the file exists, run it. Use the project's vitest runner targeted at that file specifically:

```bash
npx vitest run <path-from-integration-test-frontmatter>
```

Some integration tests need GreenMail running on port 3143 (any test that touches the IMAP layer). Before running the test, check if GreenMail is up:

```bash
lsof -ti:3143
```

If nothing is listening and the test interacts with IMAP, start the dev environment via the dev-env skill rather than freestyling docker commands:

```bash
.claude/skills/dev-env/start.sh
```

This is the only sanctioned way to bring up GreenMail for this skill — do not invoke `docker run` or compose directly. After the script reports readiness, re-run the vitest command.

Report whether the test passed. If it failed, surface the failure output verbatim — do not paraphrase test failures.

If `integrationTest` is null, skip this step and note that running the integration test was deferred because none is declared.

### Step 3 — Semantic checks (the part the script intentionally leaves to you)

These are the fuzzy criteria from `specs/README.md`:

> - The defined integration is correctly represented in the relevant architecture file
> - The integration tests exercise what this document describes

#### 3a. Is the integration correctly represented in the architecture file?

Open the file pointed at by `architecture-section` and read the relevant section (the heading whose slug matches the anchor). Confirm:

- The participants the integration declares (`Participants` body section) appear as components in that architecture section, by ID or by name.
- The interaction described in the architecture section is consistent with the integration's body — sequence, direction, and responsibilities should match. The architecture is allowed to be higher level (it doesn't have to enumerate every IX-###.N), but it must not contradict the integration.
- If the integration declares a sequence diagram, spot-check that the actors line up with the architecture's component map.

Findings here are typically one of:

- `semantic: architecture section <anchor> does not name participant <MOD-####> declared in IX body`
- `semantic: architecture describes <X> but IX body describes <Y> — these contradict`
- `semantic: architecture omits a step that the IX names as critical (IX-###.N)`

#### 3b. Do the integration tests exercise what the spec describes?

Only when an integration test is declared and exists. Read it. Confirm:

- The test sets up the declared `starting-states:` (or a faithful equivalent).
- The test drives the participating modules in their declared roles — the participants in the body's `Participants` section should be the units under test or their stand-ins.
- Each named interaction (`IX-###.N`) has a test case whose name or body really exercises it; not just mentions the ID.
- The test asserts the integration's `Postconditions`.
- For each named failure mode the integration is responsible for (linked from the body), the test or a sibling fault-injection test exercises it.

This is judgment, not pattern-matching. The structural script can confirm the IX-###.N strings appear in the test file, but it can't tell whether the assertion really proves the named interaction happened. That's your job.

If no integration test is declared, skip this with a note.

Output a small table:

| Interaction | Description (short) | Test case(s) that cover it | Notes |
|---|---|---|---|
| IX-001.1 | IDLE newMail triggers fetch | `it('IX-001.1: fetches messages with UID > lastUid')` | matches |
| IX-001.2 | Sentinel guard | `it('skips sentinel messages')` (mentions IX-001.2 in body) | matches but test name does not include the ID; fine if `describe` ancestor names it |
| ... | ... | ... | ... |

## Reporting

Produce a single report containing four sections — script findings, test run result, architecture fidelity, test fidelity — plus an overall verdict.

```
# Integration validation: <IX-ID>

## Script findings (deterministic)
<one bullet per finding, grouped by severity>

## Integration test
<pass / fail / not declared, with details>

## Semantic findings
### Architecture fidelity
<bullets, or "skipped — no architecture-section declared">
### Named interaction coverage
<table>
### Test fidelity
<bullets, or "skipped — no test declared">

## Verdict
PASS  — no errors, warnings acceptable.
WARN  — no errors but warnings worth addressing.
FAIL  — at least one error finding, or the integration test failed, or a semantic check found a real defect.
```

## Notes

- The script reads `specs/` from the repo root. If invoked from a subdirectory it walks up looking for `specs/integrations/`. Pass `--specs-root <dir>` to override.
- Renaming an integration file is fine. Renaming its `id:` frontmatter is not — IDs are immutable per `specs/README.md`. If you find a renamed ID, that's a finding even though the script will not catch it directly (because it follows the new ID).
- The named-interaction coverage check is string-presence-based: an interaction is "covered" if its `IX-###.N` ID appears anywhere in the test file outside a stub declaration. That's a low bar on purpose — the structural pass is the floor; the real coverage judgment is in step 3b.
- Do not edit the integration spec, the architecture, the modules, the use cases, or the test as part of validation. Validation reports findings; remediation is a separate task the user authorizes.
