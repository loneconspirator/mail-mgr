---
name: validate-invariant
description: Validate a single invariant spec (INV-###) against the rules in specs/README.md — every `enforcement[].ref` exists and references the invariant back; INV↔modules bi-directional via `modules:` ↔ module `invariants-enforced`; INV↔failure-modes bi-directional via the body's "Known violation modes" section ↔ FM `invariants-protected`; optional architecture link resolves; and the fuzzy check that the Statement is precise and the enforcement mechanisms actually uphold it. Use whenever an invariant spec is added, edited, or has its `enforcement`, `modules`, or `architecture-section` changed; when an enforcement target file (db migration, property test, audit job, code-discipline reference) changes shape; when reviewing a PR that touches `specs/invariants/`, `specs/failure-modes/`, `specs/modules/`, or any path declared as an `enforcement.ref`; or when the user says "validate", "check", "lint", or "audit" an invariant by ID or filename.
allowed-tools:
  - Bash(npx tsx .claude/skills/validate-invariant/scripts/validate-invariant.ts *)
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

# validate-invariant

Validates an invariant spec end-to-end against the rules described in `specs/README.md`. The deterministic structural checks live in a TypeScript script; the fuzzy semantic check (does the stated property actually correspond to the enforcement mechanisms, and do those mechanisms really uphold it?) is performed by reading the spec, each enforcement target, and the linked failure modes and judging.

The split is deliberate: deterministic checks must be reproducible across reviewers and CI runs and live in code where they can be authorized once and reused; semantic judgments need an LLM in the loop and live in this skill body.

## When to use

Trigger when:
- The user asks to validate, lint, audit, or check an invariant by ID (`INV-001`) or by file path.
- An invariant spec is being created or modified.
- An `enforcement[].ref` is being wired up to a real test, migration, audit job, or source-code symbol.
- A module's `invariants-enforced` frontmatter changes — both directions of the link must still match.
- A failure mode's `invariants-protected` frontmatter changes — the invariant body's "Known violation modes" section must still cite it.
- A PR review touches `specs/invariants/`, `specs/failure-modes/`, `specs/modules/`, or any path declared as an `enforcement.ref`.

## Inputs

The user supplies one of:
- An invariant ID, e.g. `INV-001`
- A path to an invariant file, e.g. `specs/invariants/inv-001-imap-idle-returns-to-inbox.md`

If they don't, ask which one — do not guess.

## Workflow

### Step 1 — Run the deterministic validator

Run the script:

```bash
npx tsx .claude/skills/validate-invariant/scripts/validate-invariant.ts <INV-### or path>
```

The script performs these checks (and emits structured JSON):

| Check | What it does |
|---|---|
| `INV-FRONTMATTER-MISSING-ID` (error) | The invariant file has no `id:` in its frontmatter. |
| `INV-ENFORCEMENT-EMPTY` (error) | The `enforcement` list is empty. Every invariant needs at least one mechanism (db-constraint, property-test, audit job, code-discipline reference, etc.). |
| `INV-ENFORCEMENT-TYPE-MISSING` (warning) | An entry in `enforcement` has no `type:` field. |
| `INV-ENFORCEMENT-REF-MISSING` (error) | An entry in `enforcement` has no `ref:` field. |
| `INV-ENFORCEMENT-FILE-MISSING` (error) | An `enforcement[].ref` points to a file that does not exist. |
| `INV-ENFORCEMENT-NOT-LINKED-BACK` (warning) | An enforcement target does not mention the invariant ID anywhere — the link from code/test back to spec is one-way. |
| `INV-ENFORCEMENT-ANCHOR-MISSING` (error) | A `#anchor` on a markdown enforcement ref does not match any heading slug. |
| `INV-ENFORCEMENT-SYMBOL-MISSING` (warning) | A `#fragment` on a code enforcement ref (e.g. `src/x.ts#someSymbol`) is not present anywhere in the file. |
| `INV-MODULE-MISSING` (error) | `modules:` lists a `MOD-####` that has no spec file. |
| `INV-MODULE-NOT-LINKED-BACK` (error) | A listed module's `invariants-enforced` frontmatter does not include this INV. |
| `INV-MODULE-MISSING-FORWARD-REF` (error) | A module lists this invariant in its `invariants-enforced` but the invariant does not list that module in its `modules`. |
| `INV-FM-MISSING` (error) | The body's "Known violation modes" section names an `FM-###` that has no spec file. |
| `INV-FM-NOT-LINKED-BACK` (error) | The body cites an FM but that FM does not list this INV in its `invariants-protected:`. |
| `INV-FM-MISSING-FORWARD-REF` (error) | An FM lists this INV in `invariants-protected:` but the INV body's "Known violation modes" section does not name it. |
| `INV-ARCHITECTURE-FILE-MISSING` (error) | `architecture-section:` (when set) points at a file that does not exist. |
| `INV-ARCHITECTURE-ANCHOR-MISSING` (error) | The `#anchor` in `architecture-section` does not match any heading slug. |
| `INV-WHY-MISSING` (warning) | The body has no "Why this exists" section — per `specs/README.md`, the absence of a justification is itself a smell. |

Exit codes: `0` (no errors), `1` (one or more errors), `2` (script failure / argument error).

Read the JSON. Each finding has `id`, `severity`, `message`, and often a `detail` field with concrete remediation guidance.

### Step 2 — Run the enforcement tests, if any are wired up

**Skip this entire step if the caller passed `--skip-tests`** (the `/validate` orchestrator does this so it can run the whole test suite once in parallel instead of one-file-at-a-time per validator). When skipping, note in the report that the enforcement-test run was deferred to the orchestrator's full-suite run.

For each `enforcement` entry whose `type` is `property-test`, `fault-injection-test`, `production-audit`, or any other test-shaped mechanism, and whose `ref` resolves to a `.test.ts` / `.spec.ts` file (with optional fragment), run vitest scoped to that file:

```bash
npx vitest run <path-from-enforcement-ref>
```

Some tests need GreenMail running on port 3143 (anything that touches the IMAP layer). Before running, check if GreenMail is up:

```bash
lsof -ti:3143
```

If nothing is listening and the test interacts with IMAP, start the dev environment via the dev-env skill rather than freestyling docker commands:

```bash
.claude/skills/dev-env/start.sh
```

This is the only sanctioned way to bring up GreenMail for this skill — do not invoke `docker run` or compose directly. After the script reports readiness, re-run the vitest command.

Report whether each test passed. If one failed, surface the failure output verbatim — do not paraphrase test failures.

For `code-discipline` and `db-constraint` enforcement entries, no test run applies — note in the report that these are static and were checked only for file existence and back-reference.

### Step 3 — Semantic checks (the part the script intentionally leaves to you)

These are the fuzzy criteria from `specs/README.md`:

> - Statement reads as a precise property (ideally expressible as a logical predicate).
> - Why this exists is a real justification, not a placeholder.
> - Each enforcement mechanism actually upholds the property described in the Statement.

#### 3a. Is the Statement precise enough to enforce?

Read the body's **Statement**. Confirm it is concrete (e.g. "after any non-INBOX operation, the active mailbox is INBOX and IDLE is armed") rather than aspirational ("the system stays responsive"). Aspirational invariants are fine to surface as a finding, not to silently accept.

#### 3b. Do the listed enforcement mechanisms actually uphold the property?

For each enforcement entry, open the referenced file (and the symbol/heading if a fragment is given) and judge whether the mechanism plausibly upholds the Statement.

Findings here are typically one of:

- `semantic: enforcement[N] type=<X> ref=<Y> does not actually constrain <property>`
- `semantic: enforcement target exists but does not test the path the Statement names`
- `semantic: enforcement[N] is the wrong shape for type=<X> (e.g. type=property-test but ref points at a fixture, not a test)`

Output a small table:

| Enforcement | Type | Ref | Does it uphold the Statement? | Notes |
|---|---|---|---|---|
| 0 | code-discipline | `src/imap/client.ts#withMailboxSwitch` | yes | helper's `finally` re-opens INBOX and re-arms IDLE |
| 1 | fault-injection-test | `test/integration/fm-001-...test.ts` | yes | exercises the success and error paths of each scheduled consumer |

#### 3c. Is the FM↔INV linkage coherent?

For each FM listed in the body's "Known violation modes" section, read the FM's body. Confirm that the FM's trigger, if it occurred, would actually breach the invariant's Statement. If an FM is listed but is unrelated to the Statement, that's a finding.

This is judgment, not pattern-matching. The structural script can confirm the IDs cross-reference correctly; only reading the prose can confirm the failure mode is in fact a violation mode.

If no FMs are linked, skip this with a note.

## Reporting

Produce a single report containing four sections — script findings, enforcement test runs, semantic checks, plus an overall verdict.

```
# Invariant validation: <INV-ID>

## Script findings (deterministic)
<one bullet per finding, grouped by severity>

## Enforcement tests
<pass / fail / not-applicable per enforcement entry, with details>

## Semantic findings
### Statement precision
<bullets, or "Statement is precise">
### Enforcement coverage
<table>
### FM linkage coherence
<bullets, or "skipped — no FMs linked">

## Verdict
PASS  — no errors, warnings acceptable.
WARN  — no errors but warnings worth addressing.
FAIL  — at least one error finding, an enforcement test failed, or a semantic check found a real defect.
```

## Notes

- The script reads `specs/` from the repo root. If invoked from a subdirectory it walks up looking for `specs/invariants/`. Pass `--specs-root <dir>` to override.
- Renaming an invariant file is fine. Renaming its `id:` frontmatter is not — IDs are immutable per `specs/README.md`. If you find a renamed ID, that's a finding even though the script will not catch it directly (because it follows the new ID).
- An `enforcement.ref` may include a `#fragment`. For markdown files the fragment is a heading slug and is checked exactly. For source-code files the fragment is treated as a symbol or section name and is checked by string presence — this is intentionally a soft check, since renaming a symbol mid-refactor should produce a finding rather than a silent pass.
- The "Known violation modes" section is body prose, not frontmatter. The script slugs heading text and looks for `Known violation modes` (or `known-violation-modes`); other phrasings will not be detected. Keep the heading stable.
- Do not edit the invariant spec, the enforcement targets, the modules, or the failure modes as part of validation. Validation reports findings; remediation is a separate task the user authorizes.
