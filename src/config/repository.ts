import crypto from 'node:crypto';
import { loadConfig, saveConfig } from './loader.js';
import { ruleSchema, imapConfigSchema } from './schema.js';
import type { Config, Rule, ImapConfig } from './schema.js';

export class ConfigRepository {
  private config: Config;
  private readonly configPath: string;
  private rulesListeners: Array<(rules: Rule[]) => void> = [];
  private imapListeners: Array<(config: Config) => Promise<void>> = [];

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

  addRule(input: Omit<Rule, 'id'>): Rule {
    const newRule = { ...input, id: crypto.randomUUID() };
    const result = ruleSchema.safeParse(newRule);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    this.config.rules.push(result.data);
    this.persist();
    this.notifyRulesChange();
    return result.data;
  }

  updateRule(id: string, input: Omit<Rule, 'id'>): Rule | null {
    const idx = this.config.rules.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const updated = { ...input, id };
    const result = ruleSchema.safeParse(updated);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    this.config.rules[idx] = result.data;
    this.persist();
    this.notifyRulesChange();
    return result.data;
  }

  deleteRule(id: string): boolean {
    const idx = this.config.rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.config.rules.splice(idx, 1);
    this.persist();
    this.notifyRulesChange();
    return true;
  }

  reorderRules(pairs: Array<{ id: string; order: number }>): Rule[] {
    for (const pair of pairs) {
      const rule = this.config.rules.find((r) => r.id === pair.id);
      if (rule) rule.order = pair.order;
    }
    this.persist();
    this.notifyRulesChange();
    return this.getRules();
  }

  onRulesChange(fn: (rules: Rule[]) => void): void {
    this.rulesListeners.push(fn);
  }

  onImapConfigChange(fn: (config: Config) => Promise<void>): void {
    this.imapListeners.push(fn);
  }

  async updateImapConfig(input: ImapConfig): Promise<ImapConfig> {
    const result = imapConfigSchema.safeParse(input);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    this.config.imap = result.data;
    this.persist();
    for (const fn of this.imapListeners) {
      await fn(this.config);
    }
    return result.data;
  }

  private notifyRulesChange(): void {
    for (const fn of this.rulesListeners) {
      fn(this.getRules());
    }
  }

  private persist(): void {
    saveConfig(this.configPath, this.config);
  }
}
