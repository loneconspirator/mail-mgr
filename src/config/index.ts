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
  reviewActionSchema,
  skipActionSchema,
  deleteActionSchema,
  sweepConfigSchema,
  reviewConfigSchema,
} from './schema.js';
export type {
  Config,
  Rule,
  ImapConfig,
  ImapAuth,
  ServerConfig,
  Action,
  MoveAction,
  ReviewAction,
  SkipAction,
  DeleteAction,
  EmailMatch,
  SweepConfig,
  ReviewConfig,
} from './schema.js';
