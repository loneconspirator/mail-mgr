#!/usr/bin/env tsx
/**
 * validate-invariant.ts
 *
 * Runs the deterministic checks from specs/README.md for a single invariant:
 *   1. Each `enforcement[].ref` resolves to an existing file. The ref may
 *      include a `#anchor` for source-code symbols (e.g.
 *      `src/imap/client.ts#withMailboxSwitch`); the anchor is informational
 *      and is checked for string presence in the referenced file.
 *   2. Each enforcement ref bi-directionally references this invariant —
 *      the file at `ref` must mention the INV ID somewhere (a comment, a
 *      describe/it title, a migration filename, etc.). This is the link
 *      from code/test back to spec.
 *   3. INV.modules <-> MOD.invariants-enforced bi-directional link, both
 *      directions. (Per specs/README.md the "Module → Invariant" link
 *      lives on the module side as `invariants-enforced` in frontmatter.)
 *   4. INV <-> FM bi-directional link. Any `FM-###` whose
 *      `invariants-protected:` frontmatter includes this INV ID must be
 *      named in the invariant body's "Known violation modes" section, and
 *      every FM-### the INV body lists must in turn list this INV in its
 *      `invariants-protected:` frontmatter.
 *   5. If `architecture-section:` is set, the file exists and the anchor
 *      resolves to a heading. Optional — invariants need not claim an
 *      architecture relevance.
 *
 *   The fuzzy "Statement reads as a precise property" and "Why this
 *   exists is a real justification" judgments are intentionally left to
 *   the orchestrating skill, since they require reading prose.
 *
 * Output: JSON on stdout.
 *   { ok: boolean, invariant: "...", findings: [ { id, severity, message, ... } ] }
 *
 * Exit code: 0 if all checks pass, 1 if any "error" finding present, 2 if
 * the script itself failed (bad arguments, unreadable target, etc.).
 *
 * Usage:
 *   tsx validate-invariant.ts <INV-### | path/to/invariant.md> [--specs-root <dir>]
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

interface EnforcementEntry {
  type?: string;
  ref?: string;
  [k: string]: unknown;
}

interface Frontmatter {
  id?: string;
  title?: string;
  enforcement?: EnforcementEntry[];
  modules?: string[];
  'origin-ref'?: string | null;
  'architecture-section'?: string | null;
  'covers-modules'?: string[];
  'covers-integrations'?: string[];
  'invariants-enforced'?: string[];
  'invariants-protected'?: string[];
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

function findInvariantFile(specsRoot: string, idOrPath: string): string {
  if (idOrPath.endsWith('.md') && fs.existsSync(idOrPath)) {
    return path.resolve(idOrPath);
  }
  const candidate = path.resolve(idOrPath);
  if (fs.existsSync(candidate) && candidate.endsWith('.md')) {
    return candidate;
  }
  const target = idOrPath.toUpperCase();
  for (const f of listSpecFiles(specsRoot, 'invariants')) {
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
    `Could not find invariant for "${idOrPath}". Tried direct path and ID lookup under ${path.join(specsRoot, 'invariants')}.`,
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

/**
 * GitHub-flavored anchor slug for a heading. Same algorithm used in the
 * sibling validate-* scripts: punctuation is stripped (without inserting a
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

/**
 * Split a `path[#fragment]` reference. The fragment is optional; for
 * source-code refs it typically names a function or symbol the human
 * reader is expected to find; for markdown files it's a heading slug.
 */
function parseRef(ref: string): { file: string; fragment: string | null } {
  const hashIdx = ref.indexOf('#');
  if (hashIdx === -1) return { file: ref, fragment: null };
  return { file: ref.slice(0, hashIdx), fragment: ref.slice(hashIdx + 1) };
}

/**
 * Pull FM-### IDs out of the invariant body's "Known violation modes"
 * section. Returns the unique IDs in order of first appearance.
 */
function extractKnownViolationModes(body: string): string[] {
  const lines = body.split(/\r?\n/);
  let inSection = false;
  const out: string[] = [];
  const seen = new Set<string>();
  const fmRe = /\bFM-\d+\b/g;
  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (heading) {
      const slug = slugify(heading[1]);
      // Match either the README-suggested "known-violation-modes" or the
      // current style "Known violation modes". Either slugs the same.
      inSection = slug === 'known-violation-modes';
      continue;
    }
    if (!inSection) continue;
    let m: RegExpExecArray | null;
    while ((m = fmRe.exec(line))) {
      const id = m[0].toUpperCase();
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
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
      console.log('Usage: validate-invariant.ts <INV-### | path/to/invariant.md> [--specs-root <dir>]');
      process.exit(0);
    } else if (!target) {
      target = a;
    }
  }
  if (!target) {
    console.error('Error: must supply an invariant ID or path');
    process.exit(2);
  }
  if (!specsRoot) {
    let cur = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(cur, 'specs');
      if (fs.existsSync(path.join(candidate, 'invariants'))) {
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
  const invPath = findInvariantFile(args.specsRoot, args.target);
  const inv = readSpec(invPath);
  const invId = (inv.frontmatter.id ?? '').toString();

  if (!invId) {
    findings.push({
      id: 'INV-FRONTMATTER-MISSING-ID',
      severity: 'error',
      message: `Invariant file has no frontmatter id: ${path.relative(args.repoRoot, invPath)}`,
    });
    return { ok: false, report: { invariant: null, file: invPath, findings } };
  }

  // --- Check 1 + 2: enforcement[].ref resolves and links back ---
  const enforcement = Array.isArray(inv.frontmatter.enforcement) ? inv.frontmatter.enforcement : [];
  if (enforcement.length === 0) {
    findings.push({
      id: 'INV-ENFORCEMENT-EMPTY',
      severity: 'error',
      message: `${invId} declares no enforcement entries`,
      detail: 'An invariant must list at least one enforcement mechanism (db-constraint, property-test, audit job, code-discipline reference, etc.) per specs/README.md.',
    });
  }

  for (let i = 0; i < enforcement.length; i++) {
    const entry = enforcement[i] ?? {};
    const refPos = `enforcement[${i}]`;
    const type = typeof entry.type === 'string' ? entry.type : '';
    const ref = typeof entry.ref === 'string' ? entry.ref : '';
    if (!type) {
      findings.push({
        id: 'INV-ENFORCEMENT-TYPE-MISSING',
        severity: 'warning',
        message: `${invId} ${refPos} has no type`,
      });
    }
    if (!ref) {
      findings.push({
        id: 'INV-ENFORCEMENT-REF-MISSING',
        severity: 'error',
        message: `${invId} ${refPos} (${type || 'no-type'}) has no ref`,
      });
      continue;
    }
    const { file: refFile, fragment } = parseRef(ref);
    if (!fileExists(args.repoRoot, refFile)) {
      findings.push({
        id: 'INV-ENFORCEMENT-FILE-MISSING',
        severity: 'error',
        message: `${invId} ${refPos} (${type || 'no-type'}) ref does not exist: ${ref}`,
      });
      continue;
    }
    const src = readIfExists(args.repoRoot, refFile) ?? '';
    if (!src.includes(invId)) {
      findings.push({
        id: 'INV-ENFORCEMENT-NOT-LINKED-BACK',
        severity: 'warning',
        message: `${invId} ${refPos} (${ref}) does not mention ${invId}`,
        detail: 'The enforcement target should reference the invariant ID (in a comment, describe/it title, migration name, etc.) so reviewers can trace the link from code/test back to spec.',
      });
    }
    if (fragment) {
      // For markdown enforcement refs we can verify the anchor matches a
      // heading slug; for code refs we treat the fragment as a symbol name
      // and just check for string presence.
      if (refFile.endsWith('.md')) {
        const slugs = extractHeadingSlugs(src);
        if (!slugs.has(fragment.toLowerCase())) {
          findings.push({
            id: 'INV-ENFORCEMENT-ANCHOR-MISSING',
            severity: 'error',
            message: `${invId} ${refPos} anchor #${fragment} not found among headings of ${refFile}`,
            detail: `Existing slugs: ${[...slugs].slice(0, 30).join(', ') || '(none)'}`,
          });
        }
      } else {
        if (!src.includes(fragment)) {
          findings.push({
            id: 'INV-ENFORCEMENT-SYMBOL-MISSING',
            severity: 'warning',
            message: `${invId} ${refPos} ref #${fragment} not found as a string in ${refFile}`,
            detail: 'The fragment after `#` is treated as a symbol or section name in the source file. If the symbol has been renamed, update the invariant or the code so they agree.',
          });
        }
      }
    }
  }

  // --- Check 3: modules <-> invariant bi-directional link ---
  const invModules = asArray(inv.frontmatter.modules).map(s => s.toUpperCase());
  const modById = loadSpecsByID(args.specsRoot, 'modules');

  for (const modId of invModules) {
    const mod = modById.get(modId);
    if (!mod) {
      findings.push({
        id: 'INV-MODULE-MISSING',
        severity: 'error',
        message: `${invId} references module ${modId} which does not exist under specs/modules/`,
      });
      continue;
    }
    const back = asArray(mod.frontmatter['invariants-enforced']).map(s => s.toUpperCase());
    if (!back.includes(invId.toUpperCase())) {
      findings.push({
        id: 'INV-MODULE-NOT-LINKED-BACK',
        severity: 'error',
        message: `${invId} declares modules: [${modId}] but ${modId} does not list ${invId} in its invariants-enforced`,
        detail: `Edit ${path.relative(args.repoRoot, mod.filePath)} and add ${invId} to its invariants-enforced frontmatter.`,
      });
    }
  }

  for (const [modId, mod] of modById) {
    const enforced = asArray(mod.frontmatter['invariants-enforced']).map(s => s.toUpperCase());
    if (enforced.includes(invId.toUpperCase()) && !invModules.includes(modId)) {
      findings.push({
        id: 'INV-MODULE-MISSING-FORWARD-REF',
        severity: 'error',
        message: `${modId} lists ${invId} in invariants-enforced but ${invId} does not list ${modId} in its modules`,
        detail: `Edit ${path.relative(args.repoRoot, invPath)} and add ${modId} to its modules frontmatter.`,
      });
    }
  }

  // --- Check 4: failure-modes <-> invariant bi-directional link ---
  const knownVioModes = extractKnownViolationModes(inv.body).map(s => s.toUpperCase());
  const fmById = loadSpecsByID(args.specsRoot, 'failure-modes');

  for (const fmId of knownVioModes) {
    const fm = fmById.get(fmId);
    if (!fm) {
      findings.push({
        id: 'INV-FM-MISSING',
        severity: 'error',
        message: `${invId} body's "Known violation modes" section names ${fmId} which does not exist under specs/failure-modes/`,
      });
      continue;
    }
    const protectedBy = asArray(fm.frontmatter['invariants-protected']).map(s => s.toUpperCase());
    if (!protectedBy.includes(invId.toUpperCase())) {
      findings.push({
        id: 'INV-FM-NOT-LINKED-BACK',
        severity: 'error',
        message: `${invId} body lists ${fmId} as a known violation mode but ${fmId} does not list ${invId} in its invariants-protected`,
        detail: `Edit ${path.relative(args.repoRoot, fm.filePath)} and add ${invId} to its invariants-protected frontmatter.`,
      });
    }
  }

  for (const [fmId, fm] of fmById) {
    const protectedBy = asArray(fm.frontmatter['invariants-protected']).map(s => s.toUpperCase());
    if (protectedBy.includes(invId.toUpperCase()) && !knownVioModes.includes(fmId)) {
      findings.push({
        id: 'INV-FM-MISSING-FORWARD-REF',
        severity: 'error',
        message: `${fmId} lists ${invId} in invariants-protected but ${invId} body does not name ${fmId} in its "Known violation modes" section`,
        detail: `Edit ${path.relative(args.repoRoot, invPath)} and add a bullet for ${fmId} to its "Known violation modes" section.`,
      });
    }
  }

  // --- Check 5: optional architecture-section resolves ---
  const archRef = inv.frontmatter['architecture-section'];
  if (archRef != null && archRef !== '') {
    const { file: archFile, fragment } = parseRef(archRef);
    const archResolved = path.isAbsolute(archFile)
      ? archFile
      : (fs.existsSync(path.resolve(args.specsRoot, archFile))
          ? path.resolve(args.specsRoot, archFile)
          : path.resolve(args.repoRoot, archFile));
    if (!fs.existsSync(archResolved)) {
      findings.push({
        id: 'INV-ARCHITECTURE-FILE-MISSING',
        severity: 'error',
        message: `${invId} architecture-section points at ${archFile} which does not exist`,
      });
    } else if (fragment) {
      const archSrc = fs.readFileSync(archResolved, 'utf8');
      const slugs = extractHeadingSlugs(archSrc);
      if (!slugs.has(fragment.toLowerCase())) {
        findings.push({
          id: 'INV-ARCHITECTURE-ANCHOR-MISSING',
          severity: 'error',
          message: `${invId} architecture-section anchor #${fragment} not found among headings of ${archFile}`,
          detail: `Existing slugs: ${[...slugs].slice(0, 30).join(', ') || '(none)'}`,
        });
      }
    }
  }

  // --- Body sanity: the README requires a "Why this exists" justification ---
  if (!/^#{1,6}\s+Why this exists\s*$/im.test(inv.body)) {
    findings.push({
      id: 'INV-WHY-MISSING',
      severity: 'warning',
      message: `${invId} body has no "Why this exists" section`,
      detail: 'Per specs/README.md, an invariant without a justification is itself a smell. Add a "Why this exists" section explaining the reasoning or originating incident.',
    });
  }

  const errors = findings.filter(f => f.severity === 'error');
  const ok = errors.length === 0;

  return {
    ok,
    report: {
      invariant: invId,
      title: inv.frontmatter.title ?? null,
      file: path.relative(args.repoRoot, invPath),
      enforcement: enforcement.map(e => ({ type: e.type ?? null, ref: e.ref ?? null })),
      modules: invModules,
      knownViolationModes: knownVioModes,
      architectureSection: archRef ?? null,
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
