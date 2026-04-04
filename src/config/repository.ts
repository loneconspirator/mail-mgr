import { loadConfig, saveConfig } from './loader.js';
import type { Config, Rule, ImapConfig } from './schema.js';

export class ConfigRepository {
  private config: Config;
  private readonly configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.config = loadConfig(configPath);
  }

  getConfig(): Config {
    return this.config;
  }

  getRules(): Rule[] {
    return [...this.config.rules].sort((a, b) => a.order - b.order);
  }

  getImapConfig(): ImapConfig {
    return this.config.imap;
  }
}
