#!/usr/bin/env tsx
/**
 * validate-use-case.ts
 *
 * Runs the deterministic checks from specs/README.md for a single use case:
 *   1. Acceptance test file referenced exists (existence only — running tests
 *      is a separate concern handled by the skill).
 *   2. UC <-> acceptance test bi-directional link.
 *   3. UC.integrations <-> IX.use-cases bi-directional link.
 *   4. (Structural part) Every numbered step in the main flow has a candidate
 *      mapping to at least one listed integration's named interactions, by
 *      cross-referencing IX-###.N references in step prose. The fuzzier
 *      semantic match is left to the orchestrating skill.
 *   5. UC and each sub-variant (UC-###.x) have an acceptance test reference
 *      that names them. Sub-variant references inside acceptance tests are
 *      checked by string presence of the sub-variant ID.
 *
 * Output: JSON on stdout.
 *   { ok: boolean, useCase: "...", findings: [ { id, severity, message, ... } ] }
 *
 * Exit code: 0 if all checks pass, 1 if any "error" finding present.
 *
 * Usage:
 *   tsx validate-use-case.ts <UC-### | path/to/use-case.md> [--specs-root <dir>]
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
  'acceptance-test'?: string | null;
  'integration-test'?: string | null;
  'starting-states'?: string[];
  integrations?: string[];
  'use-cases'?: string[];
  modules?: string[];
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

function findUseCaseFile(specsRoot: string, idOrPath: string): string {
  if (idOrPath.endsWith('.md') && fs.existsSync(idOrPath)) {
    return path.resolve(idOrPath);
  }
  const candidate = path.resolve(idOrPath);
  if (fs.existsSync(candidate) && candidate.endsWith('.md')) {
    return candidate;
  }
  // Treat as ID: scan use-cases dir for a file whose frontmatter id matches.
  const target = idOrPath.toUpperCase();
  for (const f of listSpecFiles(specsRoot, 'use-cases')) {
    try {
      const spec = readSpec(f);
      if (typeof spec.frontmatter.id === 'string' && spec.frontmatter.id.toUpperCase() === target) {
        return f;
      }
    } catch {
      // skip unparseable files
    }
  }
  throw new Error(`Could not find use case for "${idOrPath}". Tried direct path and ID lookup under ${path.join(specsRoot, 'use-cases')}.`);
}

function loadIntegrationsByID(specsRoot: string): Map<string, SpecFile> {
  const out = new Map<string, SpecFile>();
  for (const f of listSpecFiles(specsRoot, 'integrations')) {
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

function extractNumberedSteps(body: string): { num: number; line: string }[] {
  const out: { num: number; line: string }[] = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (m) out.push({ num: Number(m[1]), line: m[2] });
  }
  return out;
}

function extractSubVariantIDs(body: string, ucId: string): string[] {
  const out = new Set<string>();
  const escaped = ucId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\.([a-zA-Z0-9]+)\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(`${ucId}.${m[1]}`);
  return [...out];
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
// Also matches the .only variants because those are still implemented bodies.
const REAL_TEST_DECL_RE =
  /\b(?:it|test|describe|bench)(?:\s*\.\s*(?:each|concurrent|sequential|only)\s*(?:\([^)]*\))?)*\s*\(/;

// A stubbed test declaration: an it/test/describe variant that is explicitly
// not implemented — .todo / .skip, or the legacy x-prefixed forms.
const STUB_TEST_DECL_RE =
  /\b(?:(?:it|test|describe)\s*\.\s*(?:todo|skip|skipIf|runIf)|xit|xtest|xdescribe)\s*\(/;

/**
 * Classify how a use-case ID (or sub-variant ID) is referenced in a test
 * source file:
 *   'implemented' — at least one real `it(...)` / `describe(...)` / etc.
 *                   declaration on a line that mentions the ID.
 *   'stub-only'   — the ID is mentioned only on lines that hold a stubbed
 *                   declaration (it.todo / it.skip / xit / ...). Comments
 *                   alone don't count as a stub — but a comment-only mention
 *                   means there's no test at all.
 *   'comment-only' — the ID appears only in comments / strings, with no
 *                    test declaration of any kind on those lines.
 *   'absent'       — the ID is not present anywhere in the file.
 */
type TestRefKind = 'implemented' | 'stub-only' | 'comment-only' | 'absent';

function classifyTestReference(testSrc: string, id: string): TestRefKind {
  const lines = testSrc.split(/\r?\n/);
  let anyMatch = false;
  let anyImplemented = false;
  let anyStub = false;
  for (const line of lines) {
    if (!line.includes(id)) continue;
    anyMatch = true;
    const isStub = STUB_TEST_DECL_RE.test(line);
    if (isStub) {
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
      console.log('Usage: validate-use-case.ts <UC-### | path/to/use-case.md> [--specs-root <dir>]');
      process.exit(0);
    } else if (!target) {
      target = a;
    }
  }
  if (!target) {
    console.error('Error: must supply a use case ID or path');
    process.exit(2);
  }
  // Default specsRoot: walk up from CWD looking for a `specs/` dir containing use-cases/.
  if (!specsRoot) {
    let cur = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(cur, 'specs');
      if (fs.existsSync(path.join(candidate, 'use-cases'))) {
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
  const ucPath = findUseCaseFile(args.specsRoot, args.target);
  const uc = readSpec(ucPath);
  const ucId = (uc.frontmatter.id ?? '').toString();

  if (!ucId) {
    findings.push({
      id: 'UC-FRONTMATTER-MISSING-ID',
      severity: 'error',
      message: `Use case file has no frontmatter id: ${path.relative(args.repoRoot, ucPath)}`,
    });
    return { ok: false, report: { useCase: null, file: ucPath, findings } };
  }

  // --- Check 1: acceptance test referenced exists ---
  const acceptanceTest = uc.frontmatter['acceptance-test'];
  if (acceptanceTest == null || acceptanceTest === '') {
    findings.push({
      id: 'UC-ACCEPTANCE-TEST-UNSET',
      severity: 'warning',
      message: `${ucId} has no acceptance-test frontmatter value`,
      detail: 'A use case should declare its acceptance test path. Until tests are wired up, this is a warning rather than an error.',
    });
  } else if (!fileExists(args.repoRoot, acceptanceTest)) {
    findings.push({
      id: 'UC-ACCEPTANCE-TEST-MISSING',
      severity: 'error',
      message: `${ucId} references acceptance-test that does not exist: ${acceptanceTest}`,
    });
  }

  // --- Check 2: bi-directional link UC <-> acceptance test ---
  if (typeof acceptanceTest === 'string' && acceptanceTest && fileExists(args.repoRoot, acceptanceTest)) {
    const testSrc = readIfExists(args.repoRoot, acceptanceTest) ?? '';
    if (!testSrc.includes(ucId)) {
      findings.push({
        id: 'UC-ACCEPTANCE-TEST-NOT-LINKED-BACK',
        severity: 'error',
        message: `${ucId} is not referenced anywhere in its acceptance test ${acceptanceTest}`,
        detail: 'The acceptance test must mention the use case ID (in describe/it titles or a comment) so reviewers can trace the link from test to spec.',
      });
    } else if (classifyTestReference(testSrc, ucId) === 'stub-only') {
      findings.push({
        id: 'UC-ACCEPTANCE-TEST-NOT-IMPLEMENTED',
        severity: 'error',
        message: `${ucId} is referenced in ${acceptanceTest} but only inside a stubbed/skipped test (it.todo, it.skip, xit, etc.)`,
        detail: 'The use case has a test declaration but no actual implementation. Replace the it.todo/it.skip/xit with a real test body that exercises the flow.',
      });
    }
  }

  // --- Check 3: UC.integrations <-> IX.use-cases bi-directional ---
  const ucIntegrations = asArray(uc.frontmatter.integrations).map(s => s.toUpperCase());
  const ixById = loadIntegrationsByID(args.specsRoot);

  for (const ixId of ucIntegrations) {
    const ix = ixById.get(ixId);
    if (!ix) {
      findings.push({
        id: 'UC-INTEGRATION-MISSING',
        severity: 'error',
        message: `${ucId} references integration ${ixId} which does not exist under specs/integrations/`,
      });
      continue;
    }
    const back = asArray(ix.frontmatter['use-cases']).map(s => s.toUpperCase());
    if (!back.includes(ucId.toUpperCase())) {
      findings.push({
        id: 'UC-INTEGRATION-NOT-LINKED-BACK',
        severity: 'error',
        message: `${ucId} declares integrations: [${ixId}] but ${ixId} does not list ${ucId} in its use-cases`,
        detail: `Edit ${path.relative(args.repoRoot, ix.filePath)} and add ${ucId} to its use-cases frontmatter.`,
      });
    }
  }

  // --- Check 4 (structural): step-to-integration coverage ---
  const steps = extractNumberedSteps(uc.body);
  if (steps.length === 0) {
    findings.push({
      id: 'UC-NO-NUMBERED-STEPS',
      severity: 'warning',
      message: `${ucId} body contains no numbered main-flow steps`,
      detail: 'Without numbered steps the structural step-to-interaction check is skipped. Ensure the main flow uses a numbered list.',
    });
  } else if (ucIntegrations.length === 0) {
    findings.push({
      id: 'UC-NO-INTEGRATIONS',
      severity: 'warning',
      message: `${ucId} declares no integrations; cannot map steps to named interactions`,
    });
  } else {
    // Build the set of valid IX-###.N sub-IDs from the listed integrations.
    const validInteractionRefs = new Set<string>();
    for (const ixId of ucIntegrations) {
      const ix = ixById.get(ixId);
      if (!ix) continue;
      const escaped = ixId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\.\\d+\\b`, 'g');
      const found = ix.body.match(re) ?? [];
      for (const f of found) validInteractionRefs.add(f);
    }
    // The README's check 4 is fuzzy ("maps to at least one"). The script
    // surfaces a structural finding: steps that explicitly cite IX-###.N
    // references that aren't in the valid set, and reports overall how many
    // steps cite *any* IX reference. The semantic mapping is the skill's job.
    const ixRefRe = /\b(IX-\d+(?:\.\d+)?)\b/g;
    let stepsWithAnyRef = 0;
    const danglingRefs: { step: number; ref: string }[] = [];
    for (const step of steps) {
      const refs = step.line.match(ixRefRe) ?? [];
      if (refs.length > 0) stepsWithAnyRef++;
      for (const ref of refs) {
        if (ref.includes('.') && !validInteractionRefs.has(ref)) {
          danglingRefs.push({ step: step.num, ref });
        }
      }
    }
    for (const d of danglingRefs) {
      findings.push({
        id: 'UC-STEP-DANGLING-INTERACTION-REF',
        severity: 'error',
        message: `${ucId} step ${d.step} cites ${d.ref} which is not a named interaction in any listed integration`,
      });
    }
    if (stepsWithAnyRef === 0) {
      findings.push({
        id: 'UC-STEP-NO-INTERACTION-REFS',
        severity: 'info',
        message: `${ucId} has ${steps.length} numbered steps but none cite an IX-### reference inline`,
        detail: 'The structural check found no inline IX-### citations. Mapping steps to named interactions is then a fuzzy/semantic check the skill must perform from prose.',
      });
    }
  }

  // --- Check 5: UC and each sub-variant referenced in acceptance test ---
  const subVariants = extractSubVariantIDs(uc.body, ucId);
  if (typeof acceptanceTest === 'string' && acceptanceTest && fileExists(args.repoRoot, acceptanceTest)) {
    const testSrc = readIfExists(args.repoRoot, acceptanceTest) ?? '';
    for (const sv of subVariants) {
      const kind = classifyTestReference(testSrc, sv);
      if (kind === 'absent') {
        findings.push({
          id: 'UC-SUBVARIANT-NOT-IN-TEST',
          severity: 'error',
          message: `${ucId} sub-variant ${sv} is not referenced in acceptance test ${acceptanceTest}`,
          detail: 'Each sub-variant should appear in the name or description of at least one test case so reviewers can confirm it is exercised.',
        });
      } else if (kind === 'stub-only') {
        findings.push({
          id: 'UC-SUBVARIANT-NOT-IMPLEMENTED',
          severity: 'error',
          message: `${ucId} sub-variant ${sv} appears in ${acceptanceTest} but only inside a stubbed/skipped test (it.todo, it.skip, xit, etc.)`,
          detail: 'The sub-variant has a placeholder test declaration but no implementation. Replace the it.todo/it.skip/xit with a real test body that exercises the variant.',
        });
      } else if (kind === 'comment-only') {
        findings.push({
          id: 'UC-SUBVARIANT-NOT-IMPLEMENTED',
          severity: 'error',
          message: `${ucId} sub-variant ${sv} is mentioned in ${acceptanceTest} but only in comments — no test declaration exercises it`,
          detail: 'Add an it(...) / describe(...) / test(...) block whose name or body references the sub-variant ID and exercises its scenario.',
        });
      }
    }
  } else if (subVariants.length > 0 && (!acceptanceTest || acceptanceTest === '')) {
    findings.push({
      id: 'UC-SUBVARIANTS-WITHOUT-TEST',
      severity: 'warning',
      message: `${ucId} declares sub-variants (${subVariants.join(', ')}) but no acceptance-test is set`,
    });
  }

  const errors = findings.filter(f => f.severity === 'error');
  const ok = errors.length === 0;

  return {
    ok,
    report: {
      useCase: ucId,
      file: path.relative(args.repoRoot, ucPath),
      acceptanceTest: acceptanceTest ?? null,
      integrations: ucIntegrations,
      subVariants,
      stepCount: steps.length,
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
