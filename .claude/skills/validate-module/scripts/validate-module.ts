#!/usr/bin/env tsx
/**
 * validate-module.ts
 *
 * Runs the deterministic checks from specs/README.md for a single module:
 *   1. Referenced interface-schema file exists and parses (TypeScript: tsc
 *      --noEmit on the schema file alone).
 *   2. Schema file <-> module spec bi-directional link (the schema file
 *      mentions the module ID somewhere — typically a top-of-file doc
 *      comment).
 *   3. Architecture <-> module bi-directional link. The module's
 *      `architecture-section:` must resolve (file exists and the anchor
 *      matches a heading in that file). When the architecture file declares
 *      `covers-modules:`, the module ID must appear in it.
 *   4. Integrations <-> module bi-directional link. Every integration listed
 *      in the module's `integrations:` must list this module ID in its
 *      `modules:` frontmatter, and every integration that lists this module
 *      ID must appear in the module's `integrations:`.
 *   5. unit-test-path resolves (file or directory).
 *
 *   The fuzzy "module interface that architecture and integrations claim is
 *   covered by the schema" check is intentionally left to the orchestrating
 *   skill, since it requires reading prose and code.
 *
 * Output: JSON on stdout.
 *   { ok: boolean, module: "...", findings: [ { id, severity, message, ... } ] }
 *
 * Exit code: 0 if all checks pass, 1 if any "error" finding present, 2 if
 * the script itself failed (bad arguments, unreadable target, etc.).
 *
 * Usage:
 *   tsx validate-module.ts <MOD-#### | path/to/module.md> [--specs-root <dir>]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  'interface-schema'?: string | null;
  'unit-test-path'?: string | null;
  integrations?: string[];
  'use-cases'?: string[];
  modules?: string[];
  'invariants-enforced'?: string[];
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

function findModuleFile(specsRoot: string, idOrPath: string): string {
  if (idOrPath.endsWith('.md') && fs.existsSync(idOrPath)) {
    return path.resolve(idOrPath);
  }
  const candidate = path.resolve(idOrPath);
  if (fs.existsSync(candidate) && candidate.endsWith('.md')) {
    return candidate;
  }
  const target = idOrPath.toUpperCase();
  for (const f of listSpecFiles(specsRoot, 'modules')) {
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
    `Could not find module for "${idOrPath}". Tried direct path and ID lookup under ${path.join(specsRoot, 'modules')}.`,
  );
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

function fileExists(repoRoot: string, p: string): boolean {
  if (path.isAbsolute(p)) return fs.existsSync(p);
  return fs.existsSync(path.resolve(repoRoot, p));
}

function readIfExists(repoRoot: string, p: string): string | null {
  const full = path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

function statKind(repoRoot: string, p: string): 'file' | 'dir' | 'missing' {
  const full = path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
  if (!fs.existsSync(full)) return 'missing';
  return fs.statSync(full).isDirectory() ? 'dir' : 'file';
}

/**
 * GitHub-flavored anchor slug for a heading: lowercase; drop characters that
 * GitHub strips (most punctuation, including '&'); replace each whitespace
 * run with a single '-' BUT preserve adjacent dashes that result from a
 * dropped character between spaces (e.g. "Configuration & State" becomes
 * "configuration--state", because the '&' is stripped while leaving the two
 * surrounding spaces, each replaced by a dash).
 *
 * The trick: strip the punctuation first WITHOUT collapsing it to nothing in
 * a way that merges its neighboring spaces. Replace each non-allowed
 * character with a single space, then lowercase, then replace each
 * whitespace character with a dash (no collapsing of runs).
 */
function slugify(heading: string): string {
  const lowered = heading.trim().toLowerCase();
  // Drop disallowed characters entirely (no space replacement) — GitHub does
  // not insert a space when stripping punctuation. This is what makes
  // "Configuration & State" become "configuration--state": the '&' vanishes
  // but the two spaces around it remain, each becoming a dash.
  const stripped = lowered.replace(/[^\w\s-]/g, '');
  // Replace each whitespace character (not a run) with '-' so adjacent
  // spaces produce adjacent dashes.
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
 * Parse the architecture-section value of a module. It can be a single file
 * path with optional `#anchor` (e.g. `architecture.md#core-processing`), or
 * a path to a file inside `architecture/` if the architecture is split.
 */
function parseArchitectureRef(ref: string): { file: string; anchor: string | null } {
  const hashIdx = ref.indexOf('#');
  if (hashIdx === -1) return { file: ref, anchor: null };
  return { file: ref.slice(0, hashIdx), anchor: ref.slice(hashIdx + 1) };
}

interface TscOutcome {
  ok: boolean;
  exitCode: number;
  output: string;
  ranTsc: boolean;
}

/**
 * Best-effort parse check for the interface-schema file. For a TS/JS file we
 * shell out to `npx tsc --noEmit --allowJs` against the single file in
 * isolation. This won't replicate the project tsconfig (and intentionally
 * doesn't — we only care that the file is syntactically parseable and
 * resolvable as a module shape; deep type errors are noisy here). For
 * non-TS/JS files we just confirm it's UTF-8 readable.
 */
function checkSchemaParses(repoRoot: string, schemaPath: string): TscOutcome {
  const full = path.isAbsolute(schemaPath) ? schemaPath : path.resolve(repoRoot, schemaPath);
  if (!fs.existsSync(full)) {
    return { ok: false, exitCode: -1, output: 'file does not exist', ranTsc: false };
  }
  const ext = path.extname(full).toLowerCase();
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.mjs' || ext === '.cts' || ext === '.mts') {
    const args = ['tsc', '--noEmit', '--allowJs', '--target', 'esnext', '--module', 'esnext', '--moduleResolution', 'bundler', '--skipLibCheck', full];
    const res = spawnSync('npx', args, { cwd: repoRoot, encoding: 'utf8' });
    const stdout = res.stdout ?? '';
    const stderr = res.stderr ?? '';
    return {
      ok: res.status === 0,
      exitCode: res.status ?? -1,
      output: (stdout + stderr).trim(),
      ranTsc: true,
    };
  }
  // Fallback: just attempt to read the file as UTF-8.
  try {
    fs.readFileSync(full, 'utf8');
    return { ok: true, exitCode: 0, output: '', ranTsc: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, exitCode: -1, output: msg, ranTsc: false };
  }
}

interface Args {
  target: string;
  specsRoot: string;
  repoRoot: string;
  skipParse: boolean;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let target = '';
  let specsRoot = '';
  let skipParse = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--specs-root') {
      specsRoot = args[++i];
    } else if (a === '--skip-parse') {
      skipParse = true;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: validate-module.ts <MOD-#### | path/to/module.md> [--specs-root <dir>] [--skip-parse]');
      process.exit(0);
    } else if (!target) {
      target = a;
    }
  }
  if (!target) {
    console.error('Error: must supply a module ID or path');
    process.exit(2);
  }
  if (!specsRoot) {
    let cur = process.cwd();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(cur, 'specs');
      if (fs.existsSync(path.join(candidate, 'modules'))) {
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
  return { target, specsRoot: path.resolve(specsRoot), repoRoot: path.resolve(repoRoot), skipParse };
}

function run(args: Args): { ok: boolean; report: object } {
  const findings: Finding[] = [];
  const modPath = findModuleFile(args.specsRoot, args.target);
  const mod = readSpec(modPath);
  const modId = (mod.frontmatter.id ?? '').toString();

  if (!modId) {
    findings.push({
      id: 'MOD-FRONTMATTER-MISSING-ID',
      severity: 'error',
      message: `Module file has no frontmatter id: ${path.relative(args.repoRoot, modPath)}`,
    });
    return { ok: false, report: { module: null, file: modPath, findings } };
  }

  // --- Check 1: referenced interface-schema exists & parses ---
  const schemaRef = mod.frontmatter['interface-schema'];
  let schemaParse: TscOutcome | null = null;
  if (schemaRef == null || schemaRef === '') {
    findings.push({
      id: 'MOD-SCHEMA-UNSET',
      severity: 'error',
      message: `${modId} has no interface-schema frontmatter value`,
      detail: 'Each module must declare the source-of-truth file for its interface (e.g. an index.ts barrel or a schema file).',
    });
  } else if (!fileExists(args.repoRoot, schemaRef)) {
    findings.push({
      id: 'MOD-SCHEMA-MISSING',
      severity: 'error',
      message: `${modId} references interface-schema that does not exist: ${schemaRef}`,
    });
  } else if (!args.skipParse) {
    schemaParse = checkSchemaParses(args.repoRoot, schemaRef);
    if (!schemaParse.ok) {
      findings.push({
        id: 'MOD-SCHEMA-PARSE-FAILED',
        severity: 'error',
        message: `${modId} interface-schema (${schemaRef}) failed to parse`,
        detail: schemaParse.output.length > 0 ? schemaParse.output.slice(0, 4000) : 'compiler returned non-zero exit code',
      });
    }
  }

  // --- Check 2: schema file <-> module spec bi-directional link ---
  if (typeof schemaRef === 'string' && schemaRef && fileExists(args.repoRoot, schemaRef)) {
    const schemaSrc = readIfExists(args.repoRoot, schemaRef) ?? '';
    if (!schemaSrc.includes(modId)) {
      findings.push({
        id: 'MOD-SCHEMA-NOT-LINKED-BACK',
        severity: 'warning',
        message: `${modId} is not referenced anywhere in its interface-schema file ${schemaRef}`,
        detail: 'The schema file should mention the module ID (typically in a top-of-file doc comment) so reviewers can trace the link from code to spec.',
      });
    }
  }

  // --- Check 3: architecture <-> module bi-directional link ---
  const archRef = mod.frontmatter['architecture-section'];
  if (archRef == null || archRef === '') {
    findings.push({
      id: 'MOD-ARCHITECTURE-UNSET',
      severity: 'warning',
      message: `${modId} has no architecture-section frontmatter value`,
      detail: 'A module should reference the section of architecture.md (or architecture/*.md) it appears in so the cross-reference graph is complete.',
    });
  } else {
    const { file: archFile, anchor } = parseArchitectureRef(archRef);
    // The README's example writes paths like `architecture.md#enrollment-flow`,
    // which are relative to specs/ (where architecture lives). Resolve there
    // first; fall back to repo root for backwards compat / absolute paths.
    const archResolved = path.isAbsolute(archFile)
      ? archFile
      : (fs.existsSync(path.resolve(args.specsRoot, archFile))
          ? path.resolve(args.specsRoot, archFile)
          : path.resolve(args.repoRoot, archFile));
    if (!fs.existsSync(archResolved)) {
      findings.push({
        id: 'MOD-ARCHITECTURE-FILE-MISSING',
        severity: 'error',
        message: `${modId} architecture-section points at ${archFile} which does not exist (looked in ${path.relative(args.repoRoot, args.specsRoot)} and ${path.relative(args.repoRoot, args.repoRoot) || '.'})`,
      });
    } else {
      const archSrc = fs.readFileSync(archResolved, 'utf8');
      if (anchor) {
        const slugs = extractHeadingSlugs(archSrc);
        if (!slugs.has(anchor.toLowerCase())) {
          findings.push({
            id: 'MOD-ARCHITECTURE-ANCHOR-MISSING',
            severity: 'error',
            message: `${modId} architecture-section anchor #${anchor} not found among headings of ${archFile}`,
            detail: `Existing slugs: ${[...slugs].slice(0, 30).join(', ') || '(none)'}`,
          });
        }
      }

      // Bi-directional: if the architecture file declares covers-modules, we
      // expect this module ID to be in it.
      let archSpec: SpecFile | null = null;
      try {
        archSpec = readSpec(archResolved);
      } catch {
        archSpec = null;
      }
      if (archSpec) {
        const covers = asArray(archSpec.frontmatter['covers-modules']).map(s => s.toUpperCase());
        if (covers.length > 0 && !covers.includes(modId.toUpperCase())) {
          findings.push({
            id: 'MOD-ARCHITECTURE-NOT-LINKED-BACK',
            severity: 'error',
            message: `${modId} declares architecture-section ${archRef} but ${archFile} does not list ${modId} in covers-modules`,
            detail: `Edit ${archFile} and add ${modId} to its covers-modules frontmatter.`,
          });
        } else if (covers.length === 0) {
          // The root architecture.md doesn't have to be split; covers-modules
          // is only required for split architecture files. Fall back to a
          // string-presence check so that a module unmentioned in the body
          // is still flagged.
          if (!archSrc.includes(mod.frontmatter.title ?? '__no_title__') && !archSrc.includes(modId)) {
            findings.push({
              id: 'MOD-ARCHITECTURE-NOT-MENTIONED',
              severity: 'warning',
              message: `${modId} ("${mod.frontmatter.title}") is not mentioned by ID or title in ${archFile}`,
              detail: 'The architecture file does not declare covers-modules and also does not mention this module by name. Add the module to the relevant section, or set covers-modules in the architecture file.',
            });
          }
        }
      }
    }
  }

  // --- Check 4: integrations <-> module bi-directional link ---
  const modIntegrations = asArray(mod.frontmatter.integrations).map(s => s.toUpperCase());
  const ixById = loadIntegrationsByID(args.specsRoot);

  for (const ixId of modIntegrations) {
    const ix = ixById.get(ixId);
    if (!ix) {
      findings.push({
        id: 'MOD-INTEGRATION-MISSING',
        severity: 'error',
        message: `${modId} references integration ${ixId} which does not exist under specs/integrations/`,
      });
      continue;
    }
    const back = asArray(ix.frontmatter.modules).map(s => s.toUpperCase());
    if (!back.includes(modId.toUpperCase())) {
      findings.push({
        id: 'MOD-INTEGRATION-NOT-LINKED-BACK',
        severity: 'error',
        message: `${modId} declares integrations: [${ixId}] but ${ixId} does not list ${modId} in its modules`,
        detail: `Edit ${path.relative(args.repoRoot, ix.filePath)} and add ${modId} to its modules frontmatter.`,
      });
    }
  }

  // Reverse direction: any IX that lists this module ID must be in the
  // module's integrations.
  for (const [ixId, ix] of ixById) {
    const ixModules = asArray(ix.frontmatter.modules).map(s => s.toUpperCase());
    if (ixModules.includes(modId.toUpperCase()) && !modIntegrations.includes(ixId)) {
      findings.push({
        id: 'MOD-INTEGRATION-MISSING-FORWARD-REF',
        severity: 'error',
        message: `${ixId} lists ${modId} in modules but ${modId} does not list ${ixId} in its integrations`,
        detail: `Edit ${path.relative(args.repoRoot, modPath)} and add ${ixId} to its integrations frontmatter.`,
      });
    }
  }

  // --- Check 5: unit-test-path resolves ---
  const unitTestPath = mod.frontmatter['unit-test-path'];
  if (unitTestPath == null || unitTestPath === '') {
    findings.push({
      id: 'MOD-UNIT-TEST-PATH-UNSET',
      severity: 'warning',
      message: `${modId} has no unit-test-path frontmatter value`,
    });
  } else {
    const kind = statKind(args.repoRoot, unitTestPath);
    if (kind === 'missing') {
      findings.push({
        id: 'MOD-UNIT-TEST-PATH-MISSING',
        severity: 'error',
        message: `${modId} unit-test-path does not exist: ${unitTestPath}`,
      });
    } else if (kind === 'dir') {
      // Empty directories are suspicious but legal.
      const full = path.resolve(args.repoRoot, unitTestPath);
      const entries = fs.readdirSync(full).filter(e => !e.startsWith('.'));
      if (entries.length === 0) {
        findings.push({
          id: 'MOD-UNIT-TEST-PATH-EMPTY',
          severity: 'warning',
          message: `${modId} unit-test-path ${unitTestPath} exists but is empty`,
        });
      }
    }
  }

  const errors = findings.filter(f => f.severity === 'error');
  const ok = errors.length === 0;

  return {
    ok,
    report: {
      module: modId,
      title: mod.frontmatter.title ?? null,
      file: path.relative(args.repoRoot, modPath),
      interfaceSchema: schemaRef ?? null,
      schemaParse: schemaParse
        ? { ranTsc: schemaParse.ranTsc, ok: schemaParse.ok, exitCode: schemaParse.exitCode }
        : null,
      unitTestPath: unitTestPath ?? null,
      architectureSection: archRef ?? null,
      integrations: modIntegrations,
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
