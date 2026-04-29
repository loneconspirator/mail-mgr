---
name: validate-failure-mode
description: Validate a single failure mode spec (FM-###) against the rules in specs/README.md — fault-injection-test existence and back-reference; FM↔integrations bi-directional via FM `integrations:` ↔ each integration's body "Failure Handling" section; FM↔invariants bi-directional via FM `invariants-protected:` ↔ each invariant's body "Known violation modes" section; and the fuzzy check that named components in the body exist in the architecture and that the test really exercises the trigger. Use whenever a failure mode spec is added, edited, or has its `fault-injection-test`, `integrations`, or `invariants-protected` changed; when the fault-injection test file is wired up; when reviewing a PR that touches `specs/failure-modes/`, `specs/integrations/`, `specs/invariants/`, or any path declared as a `fault-injection-test`; or when the user says "validate", "check", "lint", or "audit" a failure mode by ID or filename.
allowed-tools:
  - Bash(npx tsx .claude/skills/validate-failure-mode/scripts/validate-failure-mode.ts *)
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

# validate-failure-mode

Validates a failure mode spec end-to-end against the rules described in `specs/README.md`. The deterministic structural checks live in a TypeScript script; the fuzzy semantic checks (do the named components exist in the architecture? does the test actually simulate the trigger?) are performed by reading the spec, the architecture, the linked integrations and invariants, and the test file and judging.

The split is deliberate: deterministic checks must be reproducible across reviewers and CI runs and live in code where they can be authorized once and reused; semantic judgments need an LLM in the loop and live in this skill body.

## When to use

Trigger when:
- The user asks to validate, lint, audit, or check a failure mode by ID (`FM-001`) or by file path.
- A failure mode spec is being created or modified.
- A fault-injection test file is being wired up.
- An integration's body "Failure Handling" section gains or loses a citation of an FM ID — both directions of the link must still match.
- An invariant's body "Known violation modes" section gains or loses an FM citation — likewise both directions.
- A PR review touches `specs/failure-modes/`, `specs/integrations/`, `specs/invariants/`, or any path declared as a `fault-injection-test`.

## Inputs

The user supplies one of:
- A failure mode ID, e.g. `FM-001`
- A path to a failure mode file, e.g. `specs/failure-modes/fm-001-scheduled-scan-strands-idle.md`

If they don't, ask which one — do not guess.

## Workflow

### Step 1 — Run the deterministic validator

Run the script:

```bash
npx tsx .claude/skills/validate-failure-mode/scripts/validate-failure-mode.ts <FM-### or path>
```

The script performs these checks (and emits structured JSON):

| Check | What it does |
|---|---|
| `FM-FRONTMATTER-MISSING-ID` (error) | The failure mode file has no `id:` in its frontmatter. |
| `FM-TEST-UNSET` (warning) | Neither `fault-injection-test:` nor `integration-test:` is set — fine while the FM is new, but should be filled before it is considered "live". |
| `FM-TEST-MISSING` (error) | The test path points to a file that does not exist. |
| `FM-TEST-NOT-LINKED-BACK` (error) | The test file does not contain the FM ID anywhere. |
| `FM-TEST-NOT-IMPLEMENTED` (error) | The FM ID appears in the test only inside a stubbed declaration (`it.todo`, `it.skip`, `xit`, etc.) or only in comments — no real test exercises it. |
| `FM-INTEGRATION-MISSING` (error) | `integrations:` lists an `IX-###` that has no spec file. |
| `FM-INTEGRATION-NO-FAILURE-HANDLING` (error) | A listed integration has no body "Failure Handling" section to back-link this FM in. |
| `FM-INTEGRATION-NOT-LINKED-BACK` (error) | A listed integration's "Failure Handling" section does not name this FM ID. |
| `FM-INTEGRATION-MISSING-FORWARD-REF` (error) | An integration's "Failure Handling" section names this FM but the FM does not list that integration in its `integrations:`. |
| `FM-INVARIANT-MISSING` (error) | `invariants-protected:` lists an `INV-###` that has no spec file. |
| `FM-INVARIANT-NO-KVM-SECTION` (error) | A listed invariant has no "Known violation modes" body section to back-link this FM in. |
| `FM-INVARIANT-NOT-LINKED-BACK` (error) | A listed invariant's "Known violation modes" section does not name this FM ID. |
| `FM-INVARIANT-MISSING-FORWARD-REF` (error) | An invariant's "Known violation modes" section names this FM but the FM does not list that invariant in its `invariants-protected:`. |
| `FM-WHY-MISSING` (warning) | The body has no "Why this exists" section — per `specs/README.md`, the absence of a justification is itself a smell and tempts future agents to delete the test as redundant. |

Exit codes: `0` (no errors), `1` (one or more errors), `2` (script failure / argument error).

Read the JSON. Each finding has `id`, `severity`, `message`, and often a `detail` field with concrete remediation guidance.

### Step 2 — Run the fault-injection test, if it is wired up

**Skip this entire step if the caller passed `--skip-tests`** (the `/validate` orchestrator does this so it can run the whole test suite once in parallel instead of one-file-at-a-time per validator). When skipping, note in the report that the fault-injection test run was deferred to the orchestrator's full-suite run.

If the report's `faultInjectionTest` field is non-null and the script reported the file exists, run it. Use the project's vitest runner targeted at that file specifically:

```bash
npx vitest run <path-from-fault-injection-test-frontmatter>
```

Many fault-injection tests need GreenMail running on port 3143 (anything that touches the IMAP layer). Before running, check if GreenMail is up:

```bash
lsof -ti:3143
```

If nothing is listening and the test interacts with IMAP, start the dev environment via the dev-env skill rather than freestyling docker commands:

```bash
.claude/skills/dev-env/start.sh
```

This is the only sanctioned way to bring up GreenMail for this skill — do not invoke `docker run` or compose directly. After the script reports readiness, re-run the vitest command.

Report whether the test passed. If it failed, surface the failure output verbatim — do not paraphrase test failures.

If `faultInjectionTest` is null, skip this step and note that running the test was deferred because none is declared.

### Step 3 — Semantic checks (the part the script intentionally leaves to you)

These are the fuzzy criteria from `specs/README.md`:

> - Named components exist in architecture.
> - Links are bi-directional. (Structural part covered by the script; the prose-level "the FM trigger really would breach the invariant" check is yours.)
> - The fault-injection test really simulates the trigger described.

#### 3a. Do the named components in the body exist in the architecture?

Read the FM body. Identify every component named — typically modules (`MOD-####`), but also concrete classes, helpers, or scheduled jobs (e.g. `ReviewSweeper`, `ActionFolderPoller`, `withMailboxSwitch`). For each, confirm it appears either:

- as a `MOD-####` listed in `specs/architecture.md` (or a relevant `architecture/*.md`), or
- as a named symbol in a module's spec body, or
- as an actual exported symbol in some module's `interface-schema`.

Findings here are typically:

- `semantic: FM body names <ComponentX> but it is not present in architecture.md or any module spec`
- `semantic: FM body names <SymbolY> but no module's interface-schema exports it`

Output a small table:

| Named in FM body | Where it should live | Found? | Notes |
|---|---|---|---|
| ReviewSweeper | MOD-0016 | yes | matches |
| ActionFolderPoller | MOD-0017 | yes | matches |
| `withMailboxSwitch` | MOD-0002 helper | yes (src/imap/client.ts) | matches |

#### 3b. Does the fault-injection test really simulate the trigger?

Only when the test exists. Read it. Confirm:

- The test sets up the conditions described in the body's **Trigger** section.
- The test drives the actual scheduled consumer / external condition the body names — it must not just call a helper directly if the body says "the regression risk is precisely that a future consumer bypasses the helper".
- The test asserts the behavior described in **Required behavior** as MUST/MUST NOT statements.
- For each MUST clause, there is a corresponding assertion. For each MUST NOT clause, there is a negative assertion or a guard.
- The test exercises the failure path described in **Test approach** — fault-injected as well as success path, when the body calls for both.

This is judgment, not pattern-matching. The structural script can confirm the FM ID appears in a real test declaration; only reading the prose can confirm the test really exercises the trigger.

If no test is declared, skip this with a note.

#### 3c. Is the FM↔INV linkage coherent?

For each invariant in `invariants-protected:`, read the invariant's Statement. Confirm that the FM's trigger, if it occurred, would actually breach that Statement. If an invariant is listed but is unrelated to this FM's trigger, that's a finding.

If no invariants are linked, skip this with a note.

## Reporting

Produce a single report containing four sections — script findings, test run result, architecture fidelity, test fidelity — plus an overall verdict.

```
# Failure mode validation: <FM-ID>

## Script findings (deterministic)
<one bullet per finding, grouped by severity>

## Fault-injection test
<pass / fail / not declared, with details>

## Semantic findings
### Named-component coverage
<table>
### Trigger fidelity
<bullets, or "skipped — no test declared">
### INV linkage coherence
<bullets, or "skipped — no INVs linked">

## Verdict
PASS  — no errors, warnings acceptable.
WARN  — no errors but warnings worth addressing.
FAIL  — at least one error finding, the fault-injection test failed, or a semantic check found a real defect.
```

## Notes

- The script reads `specs/` from the repo root. If invoked from a subdirectory it walks up looking for `specs/failure-modes/`. Pass `--specs-root <dir>` to override.
- Renaming a failure mode file is fine. Renaming its `id:` frontmatter is not — IDs are immutable per `specs/README.md`. If you find a renamed ID, that's a finding even though the script will not catch it directly (because it follows the new ID).
- The "Failure Handling" and "Known violation modes" sections are body prose, not frontmatter. The script slugs heading text and looks for `Failure Handling` (or `failure-handling`) and `Known violation modes` (or `known-violation-modes`); other phrasings will not be detected. Keep the headings stable.
- If the spec uses `integration-test:` instead of `fault-injection-test:` — the script accepts either, since some failure modes are simulated inside an existing integration test rather than a dedicated fault-injection test. The `fault-injection-test` field is preferred per `specs/README.md`.
- Do not edit the failure mode spec, the architecture, the integrations, the invariants, or the test as part of validation. Validation reports findings; remediation is a separate task the user authorizes.
