import path from 'node:path';

// Placeholder — implemented in task 1.2
export function getConfigPath(): string {
  return path.join(process.env.DATA_PATH || './data', 'config.yml');
}

export function loadConfig(_path: string): any {
  throw new Error('Not implemented — see task 1.2');
}

export function saveConfig(_path: string, _config: any): void {
  throw new Error('Not implemented — see task 1.2');
}

export function ensureConfig(_path: string): void {
  // no-op placeholder
}
