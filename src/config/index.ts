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
  moveTrackingConfigSchema,
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
  MoveTrackingConfig,
  ReviewConfig,
} from './schema.js';
