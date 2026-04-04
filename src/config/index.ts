export { loadConfig, saveConfig, ensureConfig, getConfigPath, substituteEnvVars } from './loader.js';
export { ConfigRepository } from './repository.js';
export {
  configSchema,
  ruleSchema,
  imapConfigSchema,
  imapAuthSchema,
  serverConfigSchema,
  emailMatchSchema,
  actionSchema,
  moveActionSchema,
} from './schema.js';
export type {
  Config,
  Rule,
  ImapConfig,
  ImapAuth,
  ServerConfig,
  Action,
  MoveAction,
  EmailMatch,
} from './schema.js';
