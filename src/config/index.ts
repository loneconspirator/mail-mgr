export { loadConfig, saveConfig, ensureConfig, getConfigPath } from './loader.js';
export { configSchema, ruleSchema, imapConfigSchema, serverConfigSchema } from './schema.js';
export type { Config, Rule, ImapConfig, ServerConfig, Action, MoveAction, EmailMatch } from './schema.js';
