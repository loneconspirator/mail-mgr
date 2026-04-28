# Overview
This document represents a system to allow spec driven design based on active, working, continuously validated artifacts that humans and LLMs can use to describe the system, enact use case driven modifications, and maintain useful integration and acceptance tests to prevent regressions.
## Goal
AI driven development, even spec driven development can build rapidly, but wind up missing ruinous bugs. This system intends to both articulate system architecture and design in a way to be useful reference to an LLM for further development, but also identify the important interactions amongst internal system component, as well as user interactions, that should be covered by the test suite to prevent regressions.

AI development agents build from specs that establish a set of requirements well, can exhibit a bias toward heavily mocked unit tests that can miss important system level behaviors. With this system fully AI generated, reviewed and deployed code produces the right set of integration tests. And end to end acceptance tests that represent use cases can be painfully brittle; natural language use cases can help the AI agent maintain or replace those.

## Validator Design
To the greatest degree possible, AI validation commands should be both as concrete and deterministic as possible, as well as have narrowly defined acceptance criteria. "Evaluate for coherence" is vague, subjective, and prone to false acceptance. "Parse API schema and compare it to what the architecture claims it exposes" is going to provide more reliable results.

# The Concepts
## Use Cases
End To end operations are defined as a markdown file describing how a user interacts with the system. AI manages automated acceptance tests for these scripts in a test environment to ensure the application is working correctly. These are also use cases.
## Architecture
The architecture is comprised of modules and interactions that create the behavior defined in the use cases. The entirety of these interactions is the architecture and is described in one or more files of descriptive text and diagrams.
## Integrations
Interactions between two modules or a chain of interaction between several modules can be subdivided from the architecture for detailed explanation.
## Modules
These modules can be microservices, areas of the codebase, whatever. Their contract with each other, I.e. what defines “correctness” for each module and how they interact can be analyzed and tested for their ability the support the integrations and use cases.

Each modules fulfillment of the contract can be demonstrated as a unit by a suite of tests.

## Invariants
Disallowed states of the application and its data are articulated in order to ensure the  cade and test suite cover the enforcement mechanisms preventing this state. In addition to the hard factual conditions that should never exist, an invariant also describes why these conditions shouldn't occur, including any originating incident.
## Failure Modes
Things that can go wrong and how the system responds to them are articulated here
# File structure

All spec artifacts live under `./specs/` and are markdown files with YAML frontmatter. The frontmatter declares the artifact's identity and its links to other artifacts; the body contains prose, diagrams, and references to code or test files.
## Identity and references

Every artifact has a globally unique ID composed of a type prefix and a zero-padded number:

- `UC-###` — Use case
- `IX-###` — Integration
- `MOD-###` — Module
- `INV-###` — Invariant
- `FM-###` — Failure mode
- `SS-###` — Starting state

IDs are immutable once assigned. Renaming files is permitted; renaming IDs is not. Cross-artifact references use IDs, never file paths, so files can be reorganized without breaking the reference graph.

References between artifacts are declared in frontmatter. Inline prose references to other artifacts should also use IDs (e.g., "after the invite-revocation flow described in IX-014") so they remain greppable.

Bi-directional linking is enforced by validators: if `UC-007` declares `integrations: [IX-014]`, then `IX-014` must declare `use-cases: [UC-007, ...]`. The validators do not auto-repair; they fail and require the author to reconcile.

## Directory layout

```
./specs/
├── README.md                # this document
├── setup-instructions.md    # how to bring up the test environment
├── architecture.md          # system overview; manifest if architecture/ is used
├── architecture/            # optional, for systems too large for a single file
│   └── *.md
├── use-cases/
│   ├── *.md
│   └── <feature>/           # optional grouping, no functional effect
│       └── *.md
├── starting-states/         # referenced by use cases, integrations, and failure modes
│   └── *.md
├── integrations/
│   └── *.md
├── modules/
│   └── *.md
├── invariants/
│   └── *.md
└── failure-modes/
    └── *.md
```

## Artifact types

### Use case (`UC-###`)

A natural-language description of how a user (or external system) interacts with the application end-to-end. The use case is the source of truth for what the acceptance test must demonstrate.

**Frontmatter:**

yaml

```yaml
---
id: UC-007
title: District admin enrolls a student in a campaign
acceptance-test: spec/acceptance/uc_007_admin_enrolls_student_spec.rb
starting-states: [SS-002, SS-005]
integrations: [IX-014, IX-022]
---
```

**Body:**

- **Actors** — who or what initiates and participates.
- **Preconditions** — narrative restatement of the starting states; the IDs are authoritative, the prose is for human reading.
- **Main flow** — numbered steps describing the interaction.
- **Expected outcome** — observable end state.
- **Variants** — alternative paths or known edge cases that the acceptance test should also cover.

The body is prose, but each variant should have a stable sub-identifier (`UC-007.a`, `UC-007.b`) so the acceptance test can name which variant each scenario covers.

### Integration (`IX-###`)

A chain of interaction between modules that, together, fulfill some part of one or more use cases. Integrations are the layer at which integration tests live.

**Frontmatter:**

yaml

```yaml
---
id: IX-014
title: Invite acceptance produces enrollment with idempotency
integration-test: spec/integration/ix_014_invite_to_enrollment_spec.rb
modules: [MOD-0002, MOD-0007, MOD-0024]
starting-states: [SS-002]
use-cases: [UC-007, UC-009]
architecture-section: architecture.md#enrollment-flow
---
```

**Body:**

- **Participants** — which modules are involved and in what role.
- **Named interactions** — each step in the chain has a sub-ID (`IX-014.1`, `IX-014.2`) and a one-line description. The integration test must contain a `describe` or `it` block whose name contains the sub-ID.
- **Sequence diagram** — Mermaid or similar, optional but encouraged.
- **Preconditions and postconditions** — what must be true before and after.
- **Failure handling** — for each named failure mode this integration is responsible for, link the `FM-###`.

### Module (`MOD-####`)

A bounded unit of code with a defined interface. Could be a microservice, a Rails engine, a Packwerk pack, or a service object — the system is agnostic. What matters is that the module has a contract expressible as a schema.

**Frontmatter:**

yaml

```yaml
---
id: MOD-0007
title: Enrollments service
interface-schema: app/contracts/enrollments_schema.rb
unit-test-path: spec/models/enrollments/
integrations: [IX-014, IX-018, IX-022]
invariants-enforced: [INV-005, INV-012]
architecture-section: architecture.md#enrollment-service
---
```

**Body:**

- **Responsibility** — one paragraph on what this module owns.
- **Interface summary** — human-readable list of public operations. Each operation must appear in the referenced schema; the validator parses both and diffs.
- **Dependencies** — other modules consumed, by ID.
- **Notes** — implementation guidance an agent should respect (e.g., "all writes go through `EnrollmentRecorder` to ensure event emission").

### Starting state (`SS-###`)

A precondition bundle: services that must be running, fixtures that must be loaded, configuration that must be set. Multiple artifacts can reference the same starting state.

**Frontmatter:**

yaml

```yaml
---
id: SS-002
title: District with active campaign and pending invites
mutually-exclusive-with: [SS-003]
fixtures: spec/fixtures/starting_states/ss_002.rb
---
```

**Body:**

- **Services running** — list of processes (web, SolidQueue, external stubs).
- **Data conditions** — what records exist, in what state.
- **Configuration** — env vars, feature flags.
- **Mutual exclusions** — explanation of why this state cannot coexist with the listed others. The validator fails any artifact that references two mutually exclusive starting states.

### Invariant (`INV-###`)

A property that must always hold. Articulates both the property and its enforcement mechanism.

**Frontmatter:**

yaml

```yaml
---
id: INV-003
title: Enrollment requires invite
enforcement:
  - type: db-constraint
    ref: db/migrate/20260114_add_enrollment_invite_fk.rb
  - type: property-test
    ref: spec/properties/enrollment_invariants_spec.rb
  - type: production-audit
    ref: app/jobs/audits/enrollment_audit_job.rb
modules: [MOD-0007, MOD-0002]
origin-ref: postmortems/2025-09-12-orphaned-enrollments.md  # optional
---
```

**Body:**

- **Statement** — the property, stated precisely. Ideally expressible as a logical predicate.
- **Why this exists** — context. If the invariant emerged from an incident, design discussion, or audit, this section explains the reasoning. Required prose; the absence of a justification is itself a smell.
- **Enforcement** — narrative description of how each enforcement mechanism upholds the property.
- **Known violation modes** — failure modes (`FM-###`) that would breach this invariant if unhandled.

### Failure mode (`FM-###`)

An adversarial condition the system must respond to correctly. Each failure mode names the trigger, the required behavior, and the test that exercises it.

**Frontmatter:**

yaml

```yaml
---
id: FM-007
title: SIS write succeeds, response lost
fault-injection-test: spec/integration/fm_007_sis_write_recovery_spec.rb
integrations: [IX-014]
invariants-protected: [INV-003, INV-008]
origin-ref: postmortems/2025-10-03-duplicate-enrollments.md  # optional
---
```

**Body:**

- **Trigger** — the precise external condition that produces the failure.
- **Required behavior** — what the system must do. Stated as MUST/MUST NOT for clarity.
- **Why this exists** — same intent as invariants. Captures the reasoning so future agents don't delete the test as redundant.
- **Test approach** — how the trigger is simulated (Toxiproxy, WebMock sequence, custom double).

### Architecture (`architecture.md` or `architecture/*.md`)

The system overview. Unlike the other artifact types, architecture is reference material rather than a discrete unit, so it doesn't have its own type prefix or numbered ID. Sections within it are addressable by anchor (`architecture.md#enrollment-flow`) for cross-references.

**Frontmatter (when split into multiple files):**

yaml

```yaml
---
title: Enrollment subsystem
covers-modules: [MOD-0007, MOD-0002, MOD-0024]
covers-integrations: [IX-014, IX-018, IX-022]
---
```

**Body:**

- **Component map** — diagram and prose listing all modules in scope, marked internal/external.
- **Interaction overview** — high-level description; details delegated to integration files.
- **Data flow** — where data originates, where it lives, where it goes.
- **Boundaries** — explicit statement of what is _not_ in scope of this architecture file (helps prevent the file from sprawling).

---

## Reference grammar summary

For quick reference, the bi-directional links the validators check:

|From → To|Field on source|Field on target|
|---|---|---|
|Use case → Integration|`integrations`|`use-cases`|
|Use case → Starting state|`starting-states`|(none; SS is referenced, not back-linked)|
|Integration → Module|`modules`|`integrations`|
|Integration → Architecture|`architecture-section`|`covers-integrations`|
|Module → Architecture|`architecture-section`|`covers-modules`|
|Module → Invariant|(via `invariants-enforced` in body)|`modules`|
|Failure mode → Integration|`integrations`|(validator checks integration's `failure-handling` body section)|
|Failure mode → Invariant|`invariants-protected`|(validator checks invariant's `known-violation-modes` body section)|

Starting states are intentionally one-directional: many things reference them, and back-linking would create churn every time a new use case is added. The validator instead confirms that each `SS-###` is referenced by at least one artifact (orphan detection).

# Correctness Check Agents
Each of these commands are agents that run with a fresh context. The filename or id will be the starting point for loading other relevant files.
- `validate` runs all of the below commands on all respective files, collating the findings and reporting changes needed
- `validate-use-case <filename-or-id-of-use-case>` ensures that:
	- Referenced acceptance test exists and passes.
	- Acceptance test and use case are linked bi-directionally
	- The integration paths the use case traces are linked bi-directionally
	- Every step in the main flow maps to at least one listed integration's named interactions
	- The use case and each sub-variant (`UC-###.N`) has an acceptance test that references it in it's name or description
	- Each acceptance tests that references the use case or a sub-variant correctly simulates the use case described (fuzzy criteria)
- `validate-integration <filename-or-id-of-integration>` ensures that:
	- The defined integration is correctly represented in the relevant architecture file
	- That the integration and architecture files link bi-directionally
	- Runs the referenced integration test file
	- Each named interaction (`IX-###.N`) appears in at least one test name within the integration test file.
	- The integration tests exercise what this document describes
- `validate-module <filename-or-id-of-module>` ensures that:
	- referenced schema files exists and parses
	- schema file and module spec link bi-directionally
	- architecture and module link bi-directionally
	- Integrations and module link bidirectionally
	- module interface that architecture and integrations claim is covered by the schema
- `validate-invariant <filename-or-id-of-invariate>` ensures that:
	- Referenced enforcement mechanism (DB constraint, property test, audit job) exists
	- Bi-directional link with the test/migration/job
	- If it claims architecture relevance, that link resolves.
- `validate-failure-mode <filename-or-id-of-failure-mode>` ensures that:
	- Referenced fault-injection or integration test exists and passes
	- Named components exist in architecture
	- Links are bi-directional.

# For Future Versions
- **Lifecycle specifications**: what are the actual workflows that this implements and how do they integrate with the development / deployment pipeline?
- **Change Management**: how does this system manage use case removal and cleanup, system refactors, including module combination or splitting?