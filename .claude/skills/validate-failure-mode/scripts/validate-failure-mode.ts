#!/usr/bin/env tsx
/**
 * validate-failure-mode.ts
 *
 * Runs the deterministic checks from specs/README.md for a single failure
 * mode:
 *   1. Referenced fault-injection-test (or integration-test fallback) file
 *      exists. Existence only — running the test is the orchestrating
 *      skill's job.
 *   2. FM <-> fault-injection-test bi-directional link. The test file must
 *      mention the FM ID, and only inside a real (non-stubbed) test
 *      declaration.
 *   3. FM.integrations <-> IX.failure-handling bi-directional link. Each
 *      `IX-###` listed in the FM's `integrations:` must mention this FM
 *      ID inside its body's "Failure Handling" section, and any IX whose
 *      Failure Handling body section names this FM must appear in the
 *      FM's `integrations:`.
 *   4. FM.invariants-protected <-> INV.known-violation-modes
 *      bi-directional link. Each `INV-###` in the FM's
 *      `invariants-protected:` must name this FM in its body's "Known
 *      violation modes" section, and any INV whose body names this FM
 *      must appear in the FM's `invariants-protected:`.
 *
 *   The fuzzy "Named components exist in architecture" criterion from
 *   specs/README.md is intentionally left to the orchestrating skill,
 *   since "named component" is a body-prose concept not bound to a
 *   single frontmatter field.
 *
 * Output: JSON on stdout.
 *   { ok: boolean, failureMode: "...", findings: [ { id, severity, message, ... } ] }
 *
 * Exit code: 0 if all checks pass, 1 if any "error" finding present, 2 if
 * the script itself failed (bad arguments, unreadable target, etc.).
 *
 * Usage:
 *   tsx validate-failure-mode.ts <FM-### | path/to/failure-mode.md> [--specs-root <dir>]
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
  'fault-injection-test'?: string | null;
  'integration-test'?: string | null;
  integrations?: string[];
  'invariants-protected'?: string[];
  'origin-ref'?: string | null;
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

function findFailureModeFile(specsRoot: string, idOrPath: string): string {
  if (idOrPath.endsWith('.md') && fs.existsSync(idOrPath)) {
    return path.resolve(idOrPath);
  }
  const candidate = path.resolve(idOrPath);
  if (fs.existsSync(candidate) && candidate.endsWith('.md')) {
    return candidate;
  }
  const target = idOrPath.toUpperCase();
  for (const f of listSpecFiles(specsRoot, 'failure-modes')) {
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
    `Could not find failure mode for "${idOrPath}". Tried direct path and ID lookup under ${path.join(specsRoot, 'failure-modes')}.`,
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

function slugify(heading: string): string {
  const lowered = heading.trim().toLowerCase();
  const stripped = lowered.replace(/[^\w\s-]/g, '');
  return stripped.replace(/\s/g, '-');
}

/**
 * Pull the body section under a heading whose slug matches `slug`. Returns
 * the body text up to (but not including) the next same-or-higher-level
 * heading. If the section is not present, returns null.
 */
function extractSection(body: string, slug: string): string | null {
  const lines = body.split(/\r?\n/);
  let inSection = false;
  let sectionLevel = 0;
  const captured: string[] = [];
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (m) {
      const level = m[1].length;
      const headingSlug = slugify(m[2]);
      if (!inSection) {
        if (headingSlug === slug) {
          inSection = true;
          sectionLevel = level;
        }
        continue;
      }
      // Already in section: a heading at the same or higher level ends it.
      if (level <= sectionLevel) {
        break;
      }
      captured.push(line);
      continue;
    }
    if (inSection) captured.push(line);
  }
  return inSection ? captured.join('\n') : null;
}

function extractIdsFromText(text: string, prefix: string): string[] {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}-\\d+\\b`, 'g');
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = m[0].toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
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
      console.log('Usage: validate-failure-mode.ts <FM-### | path/to/failure-mode.md> [--specs-root <dir>]');
      process.exit(0);
    } else if (!target) {
      target = a;
    }
  }
  if (!target) {
    console.error('Error: must supply a failure mode ID or path');
    process.exit(2);
  }
  if (!specsRoot) {
    let cur = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(cur, 'specs');
      if (fs.existsSync(path.join(candidate, 'failure-modes'))) {
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
  const fmPath = findFailureModeFile(args.specsRoot, args.target);
  const fm = readSpec(fmPath);
  const fmId = (fm.frontmatter.id ?? '').toString();

  if (!fmId) {
    findings.push({
      id: 'FM-FRONTMATTER-MISSING-ID',
      severity: 'error',
      message: `Failure mode file has no frontmatter id: ${path.relative(args.repoRoot, fmPath)}`,
    });
    return { ok: false, report: { failureMode: null, file: fmPath, findings } };
  }

  // --- Check 1: fault-injection-test referenced exists ---
  // Per specs/README.md a failure mode declares `fault-injection-test`. We
  // also accept `integration-test` as a fallback for simulated triggers
  // tested inside an existing integration test.
  const faultTest = fm.frontmatter['fault-injection-test'] ?? fm.frontmatter['integration-test'] ?? null;
  const faultTestField = fm.frontmatter['fault-injection-test'] != null
    ? 'fault-injection-test'
    : (fm.frontmatter['integration-test'] != null ? 'integration-test' : 'fault-injection-test');

  if (faultTest == null || faultTest === '') {
    findings.push({
      id: 'FM-TEST-UNSET',
      severity: 'warning',
      message: `${fmId} has no fault-injection-test (or integration-test) frontmatter value`,
      detail: 'A failure mode should declare the test that exercises its trigger. Until tests are wired up, this is a warning rather than an error.',
    });
  } else if (!fileExists(args.repoRoot, faultTest)) {
    findings.push({
      id: 'FM-TEST-MISSING',
      severity: 'error',
      message: `${fmId} references ${faultTestField} that does not exist: ${faultTest}`,
    });
  }

  // --- Check 2: bi-directional link FM <-> fault-injection-test ---
  let testSrc: string | null = null;
  if (typeof faultTest === 'string' && faultTest && fileExists(args.repoRoot, faultTest)) {
    testSrc = readIfExists(args.repoRoot, faultTest);
    if (testSrc !== null) {
      const kind = classifyTestReference(testSrc, fmId);
      if (kind === 'absent') {
        findings.push({
          id: 'FM-TEST-NOT-LINKED-BACK',
          severity: 'error',
          message: `${fmId} is not referenced anywhere in its ${faultTestField} ${faultTest}`,
          detail: 'The test file must mention the failure mode ID (in describe/it titles or a comment) so reviewers can trace the link from test to spec.',
        });
      } else if (kind === 'stub-only') {
        findings.push({
          id: 'FM-TEST-NOT-IMPLEMENTED',
          severity: 'error',
          message: `${fmId} is referenced in ${faultTest} but only inside a stubbed/skipped test (it.todo, it.skip, xit, etc.)`,
          detail: 'The failure mode has a placeholder test declaration but no implementation. Replace the it.todo/it.skip/xit with a real test body that exercises the trigger.',
        });
      } else if (kind === 'comment-only') {
        findings.push({
          id: 'FM-TEST-NOT-IMPLEMENTED',
          severity: 'error',
          message: `${fmId} is mentioned in ${faultTest} but only in comments — no test declaration exercises it`,
          detail: 'Add an it(...) / describe(...) / test(...) block whose name or body references the failure mode ID and exercises the trigger.',
        });
      }
    }
  }

  // --- Check 3: integrations <-> failure-mode bi-directional link ---
  // FM.integrations forward; the integration's body "Failure Handling"
  // section is the back-link.
  const fmIntegrations = asArray(fm.frontmatter.integrations).map(s => s.toUpperCase());
  const ixById = loadSpecsByID(args.specsRoot, 'integrations');

  for (const ixId of fmIntegrations) {
    const ix = ixById.get(ixId);
    if (!ix) {
      findings.push({
        id: 'FM-INTEGRATION-MISSING',
        severity: 'error',
        message: `${fmId} references integration ${ixId} which does not exist under specs/integrations/`,
      });
      continue;
    }
    const fhSection = extractSection(ix.body, 'failure-handling');
    if (fhSection == null) {
      findings.push({
        id: 'FM-INTEGRATION-NO-FAILURE-HANDLING',
        severity: 'error',
        message: `${fmId} declares integrations: [${ixId}] but ${ixId} has no "Failure Handling" body section`,
        detail: `Add a "## Failure Handling" section to ${path.relative(args.repoRoot, ix.filePath)} and document how this integration handles ${fmId}.`,
      });
      continue;
    }
    if (!fhSection.includes(fmId)) {
      findings.push({
        id: 'FM-INTEGRATION-NOT-LINKED-BACK',
        severity: 'error',
        message: `${fmId} declares integrations: [${ixId}] but ${ixId}'s "Failure Handling" section does not name ${fmId}`,
        detail: `Edit ${path.relative(args.repoRoot, ix.filePath)} and add a bullet for ${fmId} to its "Failure Handling" section.`,
      });
    }
  }

  // Reverse direction: any IX whose Failure Handling section names this FM
  // must appear in fm.integrations.
  for (const [ixId, ix] of ixById) {
    const fhSection = extractSection(ix.body, 'failure-handling');
    if (!fhSection) continue;
    const fmsCited = extractIdsFromText(fhSection, 'FM');
    if (fmsCited.includes(fmId.toUpperCase()) && !fmIntegrations.includes(ixId)) {
      findings.push({
        id: 'FM-INTEGRATION-MISSING-FORWARD-REF',
        severity: 'error',
        message: `${ixId} names ${fmId} in its "Failure Handling" section but ${fmId} does not list ${ixId} in its integrations`,
        detail: `Edit ${path.relative(args.repoRoot, fmPath)} and add ${ixId} to its integrations frontmatter.`,
      });
    }
  }

  // --- Check 4: invariants-protected <-> failure-mode bi-directional link ---
  const fmInvariants = asArray(fm.frontmatter['invariants-protected']).map(s => s.toUpperCase());
  const invById = loadSpecsByID(args.specsRoot, 'invariants');

  for (const invId of fmInvariants) {
    const inv = invById.get(invId);
    if (!inv) {
      findings.push({
        id: 'FM-INVARIANT-MISSING',
        severity: 'error',
        message: `${fmId} references invariant ${invId} which does not exist under specs/invariants/`,
      });
      continue;
    }
    const kvmSection = extractSection(inv.body, 'known-violation-modes');
    if (kvmSection == null) {
      findings.push({
        id: 'FM-INVARIANT-NO-KVM-SECTION',
        severity: 'error',
        message: `${fmId} declares invariants-protected: [${invId}] but ${invId} has no "Known violation modes" body section`,
        detail: `Add a "## Known violation modes" section to ${path.relative(args.repoRoot, inv.filePath)} and document ${fmId}.`,
      });
      continue;
    }
    if (!kvmSection.includes(fmId)) {
      findings.push({
        id: 'FM-INVARIANT-NOT-LINKED-BACK',
        severity: 'error',
        message: `${fmId} declares invariants-protected: [${invId}] but ${invId}'s "Known violation modes" section does not name ${fmId}`,
        detail: `Edit ${path.relative(args.repoRoot, inv.filePath)} and add a bullet for ${fmId} to its "Known violation modes" section.`,
      });
    }
  }

  // Reverse direction: any INV whose "Known violation modes" section names
  // this FM must appear in fm.invariants-protected.
  for (const [invId, inv] of invById) {
    const kvmSection = extractSection(inv.body, 'known-violation-modes');
    if (!kvmSection) continue;
    const fmsCited = extractIdsFromText(kvmSection, 'FM');
    if (fmsCited.includes(fmId.toUpperCase()) && !fmInvariants.includes(invId)) {
      findings.push({
        id: 'FM-INVARIANT-MISSING-FORWARD-REF',
        severity: 'error',
        message: `${invId} names ${fmId} in its "Known violation modes" section but ${fmId} does not list ${invId} in its invariants-protected`,
        detail: `Edit ${path.relative(args.repoRoot, fmPath)} and add ${invId} to its invariants-protected frontmatter.`,
      });
    }
  }

  // --- Body sanity: the README requires a "Why this exists" justification ---
  if (!/^#{1,6}\s+Why this exists\s*$/im.test(fm.body)) {
    findings.push({
      id: 'FM-WHY-MISSING',
      severity: 'warning',
      message: `${fmId} body has no "Why this exists" section`,
      detail: 'Per specs/README.md, capturing the reasoning prevents future agents from deleting the test as redundant. Add a "Why this exists" section.',
    });
  }

  const errors = findings.filter(f => f.severity === 'error');
  const ok = errors.length === 0;

  return {
    ok,
    report: {
      failureMode: fmId,
      title: fm.frontmatter.title ?? null,
      file: path.relative(args.repoRoot, fmPath),
      faultInjectionTest: faultTest,
      integrations: fmIntegrations,
      invariantsProtected: fmInvariants,
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
