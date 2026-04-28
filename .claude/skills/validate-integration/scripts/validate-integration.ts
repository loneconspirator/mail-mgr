#!/usr/bin/env tsx
/**
 * validate-integration.ts
 *
 * Runs the deterministic checks from specs/README.md for a single integration:
 *   1. Referenced integration-test file exists (existence only — running tests
 *      is the skill's job).
 *   2. IX <-> integration-test bi-directional link.
 *   3. IX <-> architecture bi-directional link. The integration's
 *      `architecture-section:` must resolve (file exists and the anchor
 *      matches a heading in that file). When the architecture file declares
 *      `covers-integrations:`, the IX ID must appear in it.
 *   4. IX.modules <-> MOD.integrations bi-directional link, both directions.
 *   5. IX.use-cases <-> UC.integrations bi-directional link, both directions.
 *   6. IX.starting-states resolve to existing SS-### spec files.
 *   7. Each named interaction (IX-###.N) declared in the body appears in at
 *      least one test name within the referenced integration test file
 *      (string presence). The fuzzier "tests exercise what this document
 *      describes" check is left to the orchestrating skill.
 *
 * Output: JSON on stdout.
 *   { ok: boolean, integration: "...", findings: [ { id, severity, message, ... } ] }
 *
 * Exit code: 0 if all checks pass, 1 if any "error" finding present, 2 if
 * the script itself failed (bad arguments, unreadable target, etc.).
 *
 * Usage:
 *   tsx validate-integration.ts <IX-### | path/to/integration.md> [--specs-root <dir>]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

type Severity = 'error' | 'warning' | 'info';

interface Finding {
  id: string;
  severity: Severity;
  message: string;
  detail?: string;
}

interface Frontmatter {
  id?: string;
  title?: string;
  'integration-test'?: string | null;
  'acceptance-test'?: string | null;
  'starting-states'?: string[];
  integrations?: string[];
  'use-cases'?: string[];
  modules?: string[];
  'architecture-section'?: string | null;
  'covers-modules'?: string[];
  'covers-integrations'?: string[];
  [k: string]: unknown;
}

interface SpecFile {
  filePath: string;
  frontmatter: Frontmatter;
  body: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function readSpec(filePath: string): SpecFile {
  const raw = fs.readFileSync(filePath, 'utf8');
  const m = FM_RE.exec(raw);
  if (!m) {
    throw new Error(`No YAML frontmatter found in ${filePath}`);
  }
  const fm = parseYaml(m[1]) as Frontmatter;
  return { filePath, frontmatter: fm ?? {}, body: m[2] ?? '' };
}

function listSpecFiles(specsRoot: string, subdir: string): string[] {
  const dir = path.join(specsRoot, subdir);
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  return out;
}

function findIntegrationFile(specsRoot: string, idOrPath: string): string {
  if (idOrPath.endsWith('.md') && fs.existsSync(idOrPath)) {
    return path.resolve(idOrPath);
  }
  const candidate = path.resolve(idOrPath);
  if (fs.existsSync(candidate) && candidate.endsWith('.md')) {
    return candidate;
  }
  const target = idOrPath.toUpperCase();
  for (const f of listSpecFiles(specsRoot, 'integrations')) {
    try {
      const spec = readSpec(f);
      if (typeof spec.frontmatter.id === 'string' && spec.frontmatter.id.toUpperCase() === target) {
        return f;
      }
    } catch {
      // skip unparseable files
    }
  }
  throw new Error(
    `Could not find integration for "${idOrPath}". Tried direct path and ID lookup under ${path.join(specsRoot, 'integrations')}.`,
  );
}

function loadSpecsByID(specsRoot: string, subdir: string): Map<string, SpecFile> {
  const out = new Map<string, SpecFile>();
  for (const f of listSpecFiles(specsRoot, subdir)) {
    try {
      const spec = readSpec(f);
      const id = spec.frontmatter.id;
      if (typeof id === 'string') out.set(id.toUpperCase(), spec);
    } catch {
      // ignore
    }
  }
  return out;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

function fileExists(repoRoot: string, p: string): boolean {
  if (path.isAbsolute(p)) return fs.existsSync(p);
  return fs.existsSync(path.resolve(repoRoot, p));
}

function readIfExists(repoRoot: string, p: string): string | null {
  const full = path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

// A real (implemented) test declaration: it/test/describe/bench possibly
// chained with .each/.concurrent/.sequential/.only — but NOT .todo or .skip.
const REAL_TEST_DECL_RE =
  /\b(?:it|test|describe|bench)(?:\s*\.\s*(?:each|concurrent|sequential|only)\s*(?:\([^)]*\))?)*\s*\(/;

const STUB_TEST_DECL_RE =
  /\b(?:(?:it|test|describe)\s*\.\s*(?:todo|skip|skipIf|runIf)|xit|xtest|xdescribe)\s*\(/;

type TestRefKind = 'implemented' | 'stub-only' | 'comment-only' | 'absent';

function classifyTestReference(testSrc: string, id: string): TestRefKind {
  const lines = testSrc.split(/\r?\n/);
  let anyMatch = false;
  let anyImplemented = false;
  let anyStub = false;
  for (const line of lines) {
    if (!line.includes(id)) continue;
    anyMatch = true;
    if (STUB_TEST_DECL_RE.test(line)) {
      anyStub = true;
      continue;
    }
    if (REAL_TEST_DECL_RE.test(line)) {
      anyImplemented = true;
    }
  }
  if (!anyMatch) return 'absent';
  if (anyImplemented) return 'implemented';
  if (anyStub) return 'stub-only';
  return 'comment-only';
}

/**
 * Extract IX-###.N sub-IDs declared in the integration body. We treat the
 * integration's own ID prefix as the only valid interaction prefix; any
 * IX-###.N in the body whose prefix matches counts as a declared named
 * interaction.
 */
function extractDeclaredInteractions(body: string, ixId: string): string[] {
  const out = new Set<string>();
  const escaped = ixId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\.(\\d+)\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(`${ixId}.${m[1]}`);
  return [...out];
}

/**
 * GitHub-flavored anchor slug for a heading. Same algorithm used in the
 * validate-module script: punctuation is stripped (without inserting a
 * space) so that "Configuration & State" becomes "configuration--state".
 */
function slugify(heading: string): string {
  const lowered = heading.trim().toLowerCase();
  const stripped = lowered.replace(/[^\w\s-]/g, '');
  return stripped.replace(/\s/g, '-');
}

function extractHeadingSlugs(md: string): Set<string> {
  const slugs = new Set<string>();
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (m) slugs.add(slugify(m[1]));
  }
  return slugs;
}

function parseArchitectureRef(ref: string): { file: string; anchor: string | null } {
  const hashIdx = ref.indexOf('#');
  if (hashIdx === -1) return { file: ref, anchor: null };
  return { file: ref.slice(0, hashIdx), anchor: ref.slice(hashIdx + 1) };
}

interface Args {
  target: string;
  specsRoot: string;
  repoRoot: string;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let target = '';
  let specsRoot = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--specs-root') {
      specsRoot = args[++i];
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: validate-integration.ts <IX-### | path/to/integration.md> [--specs-root <dir>]');
      process.exit(0);
    } else if (!target) {
      target = a;
    }
  }
  if (!target) {
    console.error('Error: must supply an integration ID or path');
    process.exit(2);
  }
  if (!specsRoot) {
    let cur = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(cur, 'specs');
      if (fs.existsSync(path.join(candidate, 'integrations'))) {
        specsRoot = candidate;
        break;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    if (!specsRoot) {
      console.error('Error: could not locate specs/ directory; pass --specs-root');
      process.exit(2);
    }
  }
  const repoRoot = path.dirname(specsRoot);
  return { target, specsRoot: path.resolve(specsRoot), repoRoot: path.resolve(repoRoot) };
}

function run(args: Args): { ok: boolean; report: object } {
  const findings: Finding[] = [];
  const ixPath = findIntegrationFile(args.specsRoot, args.target);
  const ix = readSpec(ixPath);
  const ixId = (ix.frontmatter.id ?? '').toString();

  if (!ixId) {
    findings.push({
      id: 'IX-FRONTMATTER-MISSING-ID',
      severity: 'error',
      message: `Integration file has no frontmatter id: ${path.relative(args.repoRoot, ixPath)}`,
    });
    return { ok: false, report: { integration: null, file: ixPath, findings } };
  }

  // --- Check 1: integration-test referenced exists ---
  const integrationTest = ix.frontmatter['integration-test'];
  if (integrationTest == null || integrationTest === '') {
    findings.push({
      id: 'IX-INTEGRATION-TEST-UNSET',
      severity: 'warning',
      message: `${ixId} has no integration-test frontmatter value`,
      detail: 'An integration should declare its integration-test path. Until tests are wired up, this is a warning rather than an error.',
    });
  } else if (!fileExists(args.repoRoot, integrationTest)) {
    findings.push({
      id: 'IX-INTEGRATION-TEST-MISSING',
      severity: 'error',
      message: `${ixId} references integration-test that does not exist: ${integrationTest}`,
    });
  }

  // --- Check 2: bi-directional link IX <-> integration-test ---
  let testSrc: string | null = null;
  if (typeof integrationTest === 'string' && integrationTest && fileExists(args.repoRoot, integrationTest)) {
    testSrc = readIfExists(args.repoRoot, integrationTest);
    if (testSrc !== null && !testSrc.includes(ixId)) {
      findings.push({
        id: 'IX-INTEGRATION-TEST-NOT-LINKED-BACK',
        severity: 'error',
        message: `${ixId} is not referenced anywhere in its integration test ${integrationTest}`,
        detail: 'The integration test must mention the integration ID (in describe/it titles or a comment) so reviewers can trace the link from test to spec.',
      });
    } else if (testSrc !== null && classifyTestReference(testSrc, ixId) === 'stub-only') {
      findings.push({
        id: 'IX-INTEGRATION-TEST-NOT-IMPLEMENTED',
        severity: 'error',
        message: `${ixId} is referenced in ${integrationTest} but only inside a stubbed/skipped test (it.todo, it.skip, xit, etc.)`,
        detail: 'The integration has a test declaration but no actual implementation. Replace the it.todo/it.skip/xit with a real test body that exercises the chain.',
      });
    }
  }

  // --- Check 3: architecture <-> integration bi-directional link ---
  const archRef = ix.frontmatter['architecture-section'];
  if (archRef == null || archRef === '') {
    findings.push({
      id: 'IX-ARCHITECTURE-UNSET',
      severity: 'warning',
      message: `${ixId} has no architecture-section frontmatter value`,
      detail: 'An integration should reference the section of architecture.md (or architecture/*.md) it appears in so the cross-reference graph is complete.',
    });
  } else {
    const { file: archFile, anchor } = parseArchitectureRef(archRef);
    const archResolved = path.isAbsolute(archFile)
      ? archFile
      : (fs.existsSync(path.resolve(args.specsRoot, archFile))
          ? path.resolve(args.specsRoot, archFile)
          : path.resolve(args.repoRoot, archFile));
    if (!fs.existsSync(archResolved)) {
      findings.push({
        id: 'IX-ARCHITECTURE-FILE-MISSING',
        severity: 'error',
        message: `${ixId} architecture-section points at ${archFile} which does not exist`,
      });
    } else {
      const archSrc = fs.readFileSync(archResolved, 'utf8');
      if (anchor) {
        const slugs = extractHeadingSlugs(archSrc);
        if (!slugs.has(anchor.toLowerCase())) {
          findings.push({
            id: 'IX-ARCHITECTURE-ANCHOR-MISSING',
            severity: 'error',
            message: `${ixId} architecture-section anchor #${anchor} not found among headings of ${archFile}`,
            detail: `Existing slugs: ${[...slugs].slice(0, 30).join(', ') || '(none)'}`,
          });
        }
      }

      let archSpec: SpecFile | null = null;
      try {
        archSpec = readSpec(archResolved);
      } catch {
        archSpec = null;
      }
      if (archSpec) {
        const covers = asArray(archSpec.frontmatter['covers-integrations']).map(s => s.toUpperCase());
        if (covers.length > 0 && !covers.includes(ixId.toUpperCase())) {
          findings.push({
            id: 'IX-ARCHITECTURE-NOT-LINKED-BACK',
            severity: 'error',
            message: `${ixId} declares architecture-section ${archRef} but ${archFile} does not list ${ixId} in covers-integrations`,
            detail: `Edit ${archFile} and add ${ixId} to its covers-integrations frontmatter.`,
          });
        } else if (covers.length === 0) {
          // The root architecture.md doesn't have to be split; covers-integrations
          // is only required for split architecture files. Fall back to a
          // string-presence check so an integration unmentioned in the body
          // is still flagged.
          if (!archSrc.includes(ix.frontmatter.title ?? '__no_title__') && !archSrc.includes(ixId)) {
            findings.push({
              id: 'IX-ARCHITECTURE-NOT-MENTIONED',
              severity: 'warning',
              message: `${ixId} ("${ix.frontmatter.title}") is not mentioned by ID or title in ${archFile}`,
              detail: 'The architecture file does not declare covers-integrations and also does not mention this integration by name. Add the integration to the relevant section, or set covers-integrations in the architecture file.',
            });
          }
        }
      }
    }
  }

  // --- Check 4: modules <-> integration bi-directional link ---
  const ixModules = asArray(ix.frontmatter.modules).map(s => s.toUpperCase());
  const modById = loadSpecsByID(args.specsRoot, 'modules');

  for (const modId of ixModules) {
    const mod = modById.get(modId);
    if (!mod) {
      findings.push({
        id: 'IX-MODULE-MISSING',
        severity: 'error',
        message: `${ixId} references module ${modId} which does not exist under specs/modules/`,
      });
      continue;
    }
    const back = asArray(mod.frontmatter.integrations).map(s => s.toUpperCase());
    if (!back.includes(ixId.toUpperCase())) {
      findings.push({
        id: 'IX-MODULE-NOT-LINKED-BACK',
        severity: 'error',
        message: `${ixId} declares modules: [${modId}] but ${modId} does not list ${ixId} in its integrations`,
        detail: `Edit ${path.relative(args.repoRoot, mod.filePath)} and add ${ixId} to its integrations frontmatter.`,
      });
    }
  }

  // Reverse direction: any module that lists this IX must be in the
  // integration's modules.
  for (const [modId, mod] of modById) {
    const modIntegrations = asArray(mod.frontmatter.integrations).map(s => s.toUpperCase());
    if (modIntegrations.includes(ixId.toUpperCase()) && !ixModules.includes(modId)) {
      findings.push({
        id: 'IX-MODULE-MISSING-FORWARD-REF',
        severity: 'error',
        message: `${modId} lists ${ixId} in integrations but ${ixId} does not list ${modId} in its modules`,
        detail: `Edit ${path.relative(args.repoRoot, ixPath)} and add ${modId} to its modules frontmatter.`,
      });
    }
  }

  // --- Check 5: use-cases <-> integration bi-directional link ---
  const ixUseCases = asArray(ix.frontmatter['use-cases']).map(s => s.toUpperCase());
  const ucById = loadSpecsByID(args.specsRoot, 'use-cases');

  for (const ucId of ixUseCases) {
    const uc = ucById.get(ucId);
    if (!uc) {
      findings.push({
        id: 'IX-USE-CASE-MISSING',
        severity: 'error',
        message: `${ixId} references use case ${ucId} which does not exist under specs/use-cases/`,
      });
      continue;
    }
    const back = asArray(uc.frontmatter.integrations).map(s => s.toUpperCase());
    if (!back.includes(ixId.toUpperCase())) {
      findings.push({
        id: 'IX-USE-CASE-NOT-LINKED-BACK',
        severity: 'error',
        message: `${ixId} declares use-cases: [${ucId}] but ${ucId} does not list ${ixId} in its integrations`,
        detail: `Edit ${path.relative(args.repoRoot, uc.filePath)} and add ${ixId} to its integrations frontmatter.`,
      });
    }
  }

  // Reverse direction: any UC that lists this IX must be in the
  // integration's use-cases.
  for (const [ucId, uc] of ucById) {
    const ucIntegrations = asArray(uc.frontmatter.integrations).map(s => s.toUpperCase());
    if (ucIntegrations.includes(ixId.toUpperCase()) && !ixUseCases.includes(ucId)) {
      findings.push({
        id: 'IX-USE-CASE-MISSING-FORWARD-REF',
        severity: 'error',
        message: `${ucId} lists ${ixId} in integrations but ${ixId} does not list ${ucId} in its use-cases`,
        detail: `Edit ${path.relative(args.repoRoot, ixPath)} and add ${ucId} to its use-cases frontmatter.`,
      });
    }
  }

  // --- Check 6: starting-states resolve ---
  const ixStartingStates = asArray(ix.frontmatter['starting-states']).map(s => s.toUpperCase());
  if (ixStartingStates.length > 0) {
    const ssById = loadSpecsByID(args.specsRoot, 'starting-states');
    for (const ssId of ixStartingStates) {
      if (!ssById.has(ssId)) {
        findings.push({
          id: 'IX-STARTING-STATE-MISSING',
          severity: 'error',
          message: `${ixId} references starting-state ${ssId} which does not exist under specs/starting-states/`,
        });
      }
    }
  }

  // --- Check 7: every named interaction (IX-###.N) appears in test ---
  const declaredInteractions = extractDeclaredInteractions(ix.body, ixId);
  if (declaredInteractions.length === 0) {
    findings.push({
      id: 'IX-NO-NAMED-INTERACTIONS',
      severity: 'warning',
      message: `${ixId} body declares no named interactions (IX-###.N)`,
      detail: 'An integration should enumerate its named interactions so the integration test can be checked for coverage.',
    });
  }

  if (testSrc !== null && declaredInteractions.length > 0) {
    for (const interactionId of declaredInteractions) {
      const kind = classifyTestReference(testSrc, interactionId);
      if (kind === 'absent') {
        findings.push({
          id: 'IX-NAMED-INTERACTION-NOT-IN-TEST',
          severity: 'error',
          message: `${interactionId} is not referenced in integration test ${integrationTest}`,
          detail: 'Each named interaction should appear in the name or description of at least one test case so reviewers can confirm it is exercised.',
        });
      } else if (kind === 'stub-only') {
        findings.push({
          id: 'IX-NAMED-INTERACTION-NOT-IMPLEMENTED',
          severity: 'error',
          message: `${interactionId} appears in ${integrationTest} but only inside a stubbed/skipped test (it.todo, it.skip, xit, etc.)`,
          detail: 'The interaction has a placeholder test declaration but no implementation. Replace the it.todo/it.skip/xit with a real test body that exercises the interaction.',
        });
      } else if (kind === 'comment-only') {
        findings.push({
          id: 'IX-NAMED-INTERACTION-NOT-IMPLEMENTED',
          severity: 'error',
          message: `${interactionId} is mentioned in ${integrationTest} but only in comments — no test declaration exercises it`,
          detail: 'Add an it(...) / describe(...) / test(...) block whose name or body references the interaction ID and exercises its scenario.',
        });
      }
    }
  } else if (declaredInteractions.length > 0 && (!integrationTest || integrationTest === '')) {
    findings.push({
      id: 'IX-NAMED-INTERACTIONS-WITHOUT-TEST',
      severity: 'warning',
      message: `${ixId} declares named interactions (${declaredInteractions.length}) but no integration-test is set`,
    });
  }

  const errors = findings.filter(f => f.severity === 'error');
  const ok = errors.length === 0;

  return {
    ok,
    report: {
      integration: ixId,
      title: ix.frontmatter.title ?? null,
      file: path.relative(args.repoRoot, ixPath),
      integrationTest: integrationTest ?? null,
      architectureSection: archRef ?? null,
      modules: ixModules,
      useCases: ixUseCases,
      startingStates: ixStartingStates,
      namedInteractions: declaredInteractions,
      findings,
    },
  };
}

function main() {
  const args = parseArgs(process.argv);
  try {
    const { ok, report } = run(args);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exit(ok ? 0 : 1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n');
    process.exit(2);
  }
}

main();
