import crypto from 'node:crypto';
import { loadConfig, saveConfig } from './loader.js';
import { ruleSchema } from './schema.js';
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

  addRule(input: Omit<Rule, 'id'>): Rule {
    const newRule = { ...input, id: crypto.randomUUID() };
    const result = ruleSchema.safeParse(newRule);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    this.config.rules.push(result.data);
    this.persist();
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
    return result.data;
  }

  deleteRule(id: string): boolean {
    const idx = this.config.rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.config.rules.splice(idx, 1);
    this.persist();
    return true;
  }

  reorderRules(pairs: Array<{ id: string; order: number }>): Rule[] {
    for (const pair of pairs) {
      const rule = this.config.rules.find((r) => r.id === pair.id);
      if (rule) rule.order = pair.order;
    }
    this.persist();
    return this.getRules();
  }

  private persist(): void {
    saveConfig(this.configPath, this.config);
  }
}
