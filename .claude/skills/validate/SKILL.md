---
name: validate
description: Sweep-validate every spec artifact against the rules in specs/README.md by fanning out one fresh-context subagent per artifact and running the full test suite once in parallel. Each subagent invokes the matching per-type validator skill (validate-use-case, validate-integration, validate-module, validate-invariant, validate-failure-mode) with --skip-tests so tests are not duplicated. Optional argument restricts the sweep to one type (UC, IX, MOD, INV, FM) or a single artifact ID/path. Use whenever the user asks to "validate everything", "validate the specs", "audit the spec graph", or runs `/validate`.
allowed-tools:
  - Bash(npm test*)
  - Bash(npx vitest run*)
  - Bash(.claude/skills/dev-env/start.sh *)
  - Bash(lsof -ti:3143)
  - Bash(ls specs/*)
  - Bash(find specs -name '*.md'*)
  - Skill(dev-env)
  - Read
  - Grep
  - Glob
  - Agent
---

# validate

Orchestrates a full-graph spec validation sweep. Calls the per-artifact validators (`validate-use-case`, `validate-integration`, `validate-module`, `validate-invariant`, `validate-failure-mode`) once per artifact, each in a **fresh subagent context** so the orchestrator's own context stays manageable. Runs the project test suite **exactly once, in parallel** with the static/semantic agents — the per-artifact validators are told to skip their own test runs (via `--skip-tests`) to avoid duplicate work and port collisions on GreenMail (3143).

## Why this design

- Per-artifact validators each do meaningful semantic reasoning — running them inline would blow up this skill's context. Subagents keep findings small and structured on return.
- Each per-artifact validator's "Step 2 — run the test" would run `npx vitest run <single file>` against the same suite. Doing that 30+ times serialised is slow; in parallel it would race the GreenMail port. Running `npm test` once covers all of them and we let the agents focus on static + semantic checks only.
- Keeping the orchestrator's own tool surface narrow: the heavy reading happens in subagents, not here.

## When to use

Trigger when:
- The user says "validate", "validate everything", "audit the specs", "lint the specs", "run validators", or types `/validate`.
- A large spec change has just landed (multiple files in `specs/`) and a holistic check is wanted before a commit / PR.
- Pre-merge or pre-release sanity sweep.

For a single artifact, prefer the matching per-type skill directly (`validate-use-case`, `validate-integration`, `validate-module`, `validate-invariant`, `validate-failure-mode`) — but `/validate UC-001` also works and just dispatches a single subagent.

## Inputs

`/validate [<filter>]`

| Filter | Behavior |
|---|---|
| (none) | Sweep all use cases, integrations, modules, invariants, and failure modes. |
| `UC` | All use cases only. |
| `IX` | All integrations only. |
| `MOD` | All modules only. |
| `INV` | All invariants only. |
| `FM` | All failure modes only. |
| `UC-###`, `IX-###`, `MOD-####`, `INV-###`, `FM-###` | Just that one artifact. |
| `specs/<path>.md` | Just that one artifact (type inferred from directory). |

## Workflow

### Step 1 — Inventory the artifacts in scope

List the files under the relevant directories using Glob:

- `specs/use-cases/**/*.md` for UC
- `specs/integrations/*.md` for IX
- `specs/modules/*.md` for MOD
- `specs/invariants/*.md` for INV
- `specs/failure-modes/*.md` for FM

If a filter narrows scope, restrict the inventory accordingly. Resolve a single ID (e.g. `MOD-0019`, `INV-001`, `FM-001`) by grep'ing for `^id: <ID>` in the matching directory.

Show the user the inventory before fanning out: "About to validate N artifacts (V use cases, W integrations, X modules, Y invariants, Z failure modes) and run the full test suite. Proceeding."

### Step 2 — Fan out subagents AND start `npm test`, all in one parallel batch

In a single message, dispatch:

1. **One `Agent` call per artifact**, `subagent_type: "general-purpose"`, `run_in_background: true`. Each subagent's prompt instructs it to invoke the matching per-type validate skill with `--skip-tests` and return a short structured summary.
2. **One `Bash` call** running `npm test`, also `run_in_background: true`. This is the single full-suite test pass that covers what every per-artifact validator's Step 2 would have done individually.

Why all in one message: maximises real parallelism. The agents are I/O- and reasoning-bound (script + reads), the test run is CPU/IMAP-bound — they don't compete for resources, and dispatching them together avoids serial waiting.

#### GreenMail readiness

Acceptance and IMAP-touching integration tests need GreenMail on port 3143. **Before** kicking off `npm test`, check:

```bash
lsof -ti:3143
```

If nothing is listening, bring up the dev environment first:

```bash
.claude/skills/dev-env/start.sh
```

Wait for the script to report ready, then dispatch the parallel batch. (Don't `docker run` directly — use the dev-env skill.)

#### Subagent prompt template

Each subagent prompt should include:

- **What it is**: "You are validating a single spec artifact in a fresh context as part of a `/validate` sweep."
- **The artifact**: ID and absolute file path.
- **The skill to invoke** — chosen by ID prefix:
  - `UC-###` → `validate-use-case`
  - `IX-###` → `validate-integration`
  - `MOD-####` → `validate-module`
  - `INV-###` → `validate-invariant`
  - `FM-###` → `validate-failure-mode`

  Pass the artifact ID and the literal flag `--skip-tests`.
- **The orchestrator-imposed rule**: "**Do NOT run any tests yourself.** The orchestrator is running `npm test` once for the whole suite. Your job is the deterministic script run, the static checks, and the semantic checks only."
- **Return format** (so the orchestrator can collate without re-reading everything):

  ```
  Verdict: PASS | WARN | FAIL
  Artifact: <ID> — <title>

  ## Script findings
  - <severity>: <id> — <one-line>
  ...

  ## Semantic findings
  - <one-line>
  ...

  ## Notes
  <anything else worth surfacing in <5 lines>
  ```

Example concrete prompt for a UC subagent:

> You are validating spec artifact `UC-001` in a fresh context as part of a `/validate` sweep.
>
> File: `/Users/mike/git/mail-mgr/specs/use-cases/uc-001-manual-move-to-rule-to-auto-filing.md`
>
> Invoke the `validate-use-case` skill with input `UC-001 --skip-tests`. Follow that skill's workflow exactly EXCEPT for Step 2 (test run): the `/validate` orchestrator is running the full test suite separately, so you MUST NOT run `vitest`, `npm test`, or start GreenMail. Static + semantic checks only.
>
> Return a structured summary in the format below — keep it short, this gets collated with ~30 sibling reports:
> ```
> Verdict: PASS | WARN | FAIL
> Artifact: UC-001 — <title>
>
> ## Script findings
> - <severity>: <id> — <one-line>
>
> ## Semantic findings
> - <one-line per finding, or "no defects">
>
> ## Notes
> <≤5 lines>
> ```

### Step 3 — Wait for everything to finish, collate

You'll be notified as each background task finishes. Do not poll. When all subagents and `npm test` have returned:

- Read each subagent's structured summary.
- Read the test run's exit code and last ~50 lines of output for failure summaries.

### Step 4 — Produce the final report

Single report, top-down:

```
# /validate sweep — <date>

## Test suite
<PASS / FAIL with counts; if FAIL, list failing test files verbatim>

## Use cases (N)
| ID | Verdict | Headline finding (if any) |
|---|---|---|
| UC-001 | PASS | — |
| UC-002 | FAIL | acceptance-test missing |
| ... | ... | ... |

## Integrations (N)
<same shape>

## Modules (N)
<same shape>

## Invariants (N)
<same shape>

## Failure modes (N)
<same shape>

## Overall verdict
PASS  — every artifact PASS, test suite PASS.
WARN  — at least one WARN, no FAIL anywhere.
FAIL  — any artifact FAIL, or test suite FAIL.
```

Then for each artifact with verdict `WARN` or `FAIL`, include the subagent's full structured summary in a "Details" section below the tables. Don't include details for PASS — they're noise.

## Notes

- Subagents are dispatched with `subagent_type: "general-purpose"`. They have access to `Skill`, `Bash`, `Read`, `Grep`, `Glob` etc., which is what the per-type validate skills need.
- If a subagent comes back having ignored the `--skip-tests` instruction and run vitest anyway, that's fine — its result is still valid, just slower. Don't re-dispatch.
- If `npm test` fails because the dev environment isn't up and Step 2's GreenMail-readiness check was skipped, surface that explicitly: "test suite failed to run because GreenMail is not on :3143 — run `.claude/skills/dev-env/start.sh` and re-run `/validate`."
- This skill does not edit any spec, test, or source file. It only reports. Remediation is a separate, user-authorized step.
- For very large sweeps (>30 artifacts), the parallel agent count is high. That's intentional — each is small and short-lived. If the harness throttles, work through whatever batches the harness produces; do not add artificial batching here.
