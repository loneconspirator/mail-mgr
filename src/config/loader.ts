import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { configSchema } from './schema.js';
import type { Config } from './schema.js';

const ENV_VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g;

/**
 * Resolve the config file path from DATA_PATH env var.
 */
export function getConfigPath(): string {
  return path.join(process.env.DATA_PATH || './data', 'config.yml');
}

/**
 * Recursively substitute ${VAR_NAME} in all string values.
 * Throws if a referenced env var is not set.
 */
export function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(ENV_VAR_RE, (_match, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`Environment variable ${varName} is not set (referenced as \${${varName}} in config)`);
      }
      return value;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteEnvVars(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load and validate config from a YAML file.
 * Performs env var substitution before validation.
 */
export function loadConfig(configPath: string): Config {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  const substituted = substituteEnvVars(parsed);
  const result = configSchema.safeParse(substituted);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid config at ${configPath}:\n${issues}`);
  }
  return result.data;
}

/**
 * Read the raw YAML text to extract original ${VAR} references
 * so we can preserve them on save.
 */
function extractEnvVarRefs(yamlText: string): Map<string, string> {
  const refs = new Map<string, string>();
  const lines = yamlText.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\w+)\s*:\s*(\$\{[A-Za-z_][A-Za-z0-9_]*})$/);
    if (match) {
      refs.set(match[1], match[2]);
    }
  }
  return refs;
}

/**
 * Recursively restore ${VAR} references in an object before serialization.
 */
function restoreEnvVarRefs(
  obj: unknown,
  refs: Map<string, string>,
): unknown {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string' && refs.has(key)) {
        result[key] = refs.get(key)!;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = restoreEnvVarRefs(value, refs);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}

/**
 * Save config to a YAML file atomically.
 * Preserves ${VAR} references from the original file if it exists.
 */
export function saveConfig(configPath: string, config: Config): void {
  const result = configSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Cannot save invalid config:\n${issues}`);
  }

  // Read original file to preserve env var references
  let refs = new Map<string, string>();
  try {
    const originalText = fs.readFileSync(configPath, 'utf-8');
    refs = extractEnvVarRefs(originalText);
  } catch {
    // File doesn't exist yet — no refs to preserve
  }

  const toWrite = restoreEnvVarRefs(result.data, refs);
  const yaml = stringifyYaml(toWrite, { lineWidth: 0 });

  // Atomic write: temp file + rename
  const dir = path.dirname(configPath);
  const tmpPath = path.join(dir, `.config.yml.${process.pid}.tmp`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmpPath, yaml, 'utf-8');
  fs.renameSync(tmpPath, configPath);
}

/**
 * If the config file doesn't exist, copy the bundled default into place.
 */
export function ensureConfig(configPath: string): void {
  if (fs.existsSync(configPath)) {
    return;
  }
  const defaultPath = path.resolve(
    __dirname,
    '../../config/default.yml',
  );
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(defaultPath, configPath);
}
