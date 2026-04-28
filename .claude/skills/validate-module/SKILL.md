---
name: validate-module
description: Validate a single module spec (MOD-####) against the rules in specs/README.md — interface-schema existence and parseability, schema↔module link, architecture↔module link, integration↔module bi-directional links, and the fuzzy check that the interface architecture/integrations claim is actually covered by the schema. Use whenever a module spec is added, edited, or has its `interface-schema`, `architecture-section`, or `integrations` changed; when a module's source file (e.g. `src/<module>/index.ts`) changes its public surface; when reviewing a PR that touches `specs/modules/`, `specs/integrations/`, `specs/architecture.md`, or any module's interface-schema file; or when the user says "validate", "check", "lint", or "audit" a module by ID or filename.
allowed-tools:
  - Bash(npx tsx .claude/skills/validate-module/scripts/validate-module.ts *)
  - Bash(npx tsc *)
  - Bash(npx vitest run *)
  - Read
  - Grep
  - Glob
---

# validate-module

Validates a module spec end-to-end against the rules described in `specs/README.md`. The deterministic structural checks live in a TypeScript script; the fuzzy semantic check (does the interface that architecture and integrations describe actually appear in the schema file?) is performed by reading the spec, the schema, the architecture section, and the listed integrations and judging.

The split is deliberate: deterministic checks must be reproducible across reviewers and CI runs and live in code where they can be authorized once and reused; semantic judgments need an LLM in the loop and live in this skill body.

## When to use

Trigger when:
- The user asks to validate, lint, audit, or check a module by ID (`MOD-0007`) or by file path.
- A module spec is being created or modified.
- A module's `interface-schema` file has its public surface changed (added/removed exports, renamed methods).
- An integration's `modules:` list changes — both directions of the link must still match.
- The architecture file's `covers-modules:` list changes, or a section header referenced by a module's `architecture-section` is renamed.
- A PR review touches `specs/modules/`, `specs/integrations/`, `specs/architecture.md`, or any path declared as a module's `interface-schema`.

## Inputs

The user supplies one of:
- A module ID, e.g. `MOD-0007`
- A path to a module file, e.g. `specs/modules/mod-0007-activity-log.md`

If they don't, ask which one — do not guess.

## Workflow

### Step 1 — Run the deterministic validator

Run the script:

```bash
npx tsx .claude/skills/validate-module/scripts/validate-module.ts <MOD-#### or path>
```

The script performs these checks (and emits structured JSON):

| Check | What it does |
|---|---|
| `MOD-FRONTMATTER-MISSING-ID` (error) | The module file has no `id:` in its frontmatter. |
| `MOD-SCHEMA-UNSET` (error) | `interface-schema:` is null/empty. Every module must declare a source-of-truth file for its interface. |
| `MOD-SCHEMA-MISSING` (error) | `interface-schema:` points to a file that does not exist. |
| `MOD-SCHEMA-PARSE-FAILED` (error) | The interface-schema file is `.ts/.tsx/.js/.mjs/.cts/.mts` and `tsc --noEmit` against it produced errors. The `detail` field includes compiler output. |
| `MOD-SCHEMA-NOT-LINKED-BACK` (warning) | The interface-schema file does not mention the module ID anywhere. The link from code back to spec is one-way. |
| `MOD-ARCHITECTURE-UNSET` (warning) | `architecture-section:` is null/empty — the cross-reference graph from module to architecture is incomplete. |
| `MOD-ARCHITECTURE-FILE-MISSING` (error) | `architecture-section:` points to a file that does not exist. |
| `MOD-ARCHITECTURE-ANCHOR-MISSING` (error) | The `#anchor` in `architecture-section` does not match any heading slug in the referenced architecture file. |
| `MOD-ARCHITECTURE-NOT-LINKED-BACK` (error) | The architecture file declares `covers-modules:` but does not include this module's ID. |
| `MOD-ARCHITECTURE-NOT-MENTIONED` (warning) | The architecture file does not declare `covers-modules:` and also does not mention this module by ID or title. |
| `MOD-INTEGRATION-MISSING` (error) | `integrations:` lists an `IX-###` that has no spec file. |
| `MOD-INTEGRATION-NOT-LINKED-BACK` (error) | A listed integration's `modules:` frontmatter does not include this module ID. |
| `MOD-INTEGRATION-MISSING-FORWARD-REF` (error) | An integration lists this module in its `modules:` but the module does not list that integration in its `integrations:`. |
| `MOD-UNIT-TEST-PATH-UNSET` (warning) | `unit-test-path:` is null/empty. |
| `MOD-UNIT-TEST-PATH-MISSING` (error) | `unit-test-path:` points to a file or directory that does not exist. |
| `MOD-UNIT-TEST-PATH-EMPTY` (warning) | `unit-test-path:` resolves to an empty directory. |

Exit codes: `0` (no errors), `1` (one or more errors), `2` (script failure / argument error).

Pass `--skip-parse` if `tsc` is too slow to be useful in the moment (e.g. when iterating quickly on the spec body and the schema is known good). Default behavior runs the parse check.

Read the JSON. Each finding has `id`, `severity`, `message`, and often a `detail` field with concrete remediation guidance.

### Step 2 — Run the module's unit tests, if the path resolves

If `unit-test-path` is set and resolves, run vitest scoped to that directory or file:

```bash
npx vitest run <unit-test-path>
```

Report pass/fail. If it failed, surface the failure output verbatim — do not paraphrase test failures. If `unit-test-path` is null or the script reported it as missing/empty, skip this step and note that running unit tests was deferred.

### Step 3 — Semantic check (the part the script intentionally leaves to you)

This is the fuzzy criterion from `specs/README.md`:

> module interface that architecture and integrations claim is covered by the schema

Read three things and judge whether the schema delivers what the rest of the system promises about this module.

#### 3a. Read the spec

- Frontmatter `architecture-section`, `integrations`, `invariants-enforced`.
- Body **Interface Summary** — the human-readable list of operations.
- Body **Dependencies** — other modules consumed.
- Body **Notes** — any constraints the schema must respect (e.g. "all writes go through `EnrollmentRecorder` to ensure event emission").

#### 3b. Read the architecture section

Open the file pointed at by `architecture-section` and read the relevant section (the heading whose slug matches the anchor). Capture every behavior, operation, or contract attributed to this module.

#### 3c. Read each listed integration

For every `IX-###` in `integrations:`, read the body. Identify which named interactions (`IX-###.N`) involve this module, and what method or interface call each interaction implies on this module. The integration's **Participants** section names the role this module plays.

#### 3d. Read the schema

Open the file pointed at by `interface-schema`. Identify the public surface — for a TypeScript barrel that's the `export`ed names, classes, functions, and their signatures.

#### 3e. Compare and report

Produce two tables.

**Interface coverage table** — for every operation listed in the spec body's Interface Summary, name the corresponding export in the schema:

| Spec interface entry | Schema export | Notes |
|---|---|---|
| `start()` | `Monitor.start` | matches |
| `processNewMessages()` | `Monitor.processNewMessages` | matches |
| ... | ... | ... |

Anything in the spec that has no corresponding export is a finding (`semantic: spec lists X but schema does not export it`). Anything exported that is not in the spec is a softer finding (`semantic: schema exports Y but spec does not document it`) — sometimes legitimate (private helpers), sometimes a gap.

**Integration claim coverage table** — for every named interaction that involves this module, name the schema operation it must call:

| Interaction | Implied call on this module | Schema export | Notes |
|---|---|---|---|
| IX-001.1 | fetch new messages by UID | `ImapClient.fetchNewMessages` | matches |
| IX-001.5 | match a rule against a message | `RuleMatcher.matchRule` | matches |
| ... | ... | ... | ... |

If an interaction implies a call that the schema does not expose, that is a real defect — the architecture and integrations promise behavior the module cannot deliver.

Be honest about uncertainty: if the spec says "log results" and the schema has both `logActivity` and `logSentinelEvent`, say which one(s) the integration step is talking about, or note that the integration is ambiguous.

## Reporting

Produce a single report containing four sections — script findings, schema parse, unit-test run, semantic checks — plus an overall verdict.

```
# Module validation: <MOD-ID>

## Script findings (deterministic)
<one bullet per finding, grouped by severity>

## Schema parse
<pass / fail / skipped, with details>

## Unit tests
<pass / fail / not declared, with details>

## Semantic findings
### Interface coverage
<table>
### Integration claim coverage
<table>
### Notes
<bullets, e.g. exports not documented, ambiguous mappings>

## Verdict
PASS  — no errors, warnings acceptable.
WARN  — no errors but warnings worth addressing.
FAIL  — at least one error finding, the schema failed to parse, unit tests failed, or a semantic check found a real defect.
```

## Notes

- The script reads `specs/` from the repo root. If invoked from a subdirectory it walks up looking for `specs/modules/`. Pass `--specs-root <dir>` to override.
- Renaming a module file is fine. Renaming its `id:` frontmatter is not — IDs are immutable per `specs/README.md`. If you find a renamed ID, that's a finding even though the script will not catch it directly (because it follows the new ID).
- The schema parse check is intentionally lenient: it runs `tsc --noEmit --allowJs --skipLibCheck` against the single file in isolation, not the whole project tsconfig. Its job is to confirm the file is syntactically and shape-wise parseable, not to reproduce the project's typecheck. If you want the project-level typecheck, run `npx tsc --noEmit` separately at the repo root.
- For modules whose `interface-schema` is a TS barrel (`src/foo/index.ts`), "schema" in the spec sense means the set of public exports. Do not get distracted by internal helpers exported only for tests.
- Do not edit the module spec, the integrations, the architecture, or the schema as part of validation. Validation reports findings; remediation is a separate task the user authorizes.
