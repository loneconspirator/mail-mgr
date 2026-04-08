import type { ImapClient, ReviewMessage } from '../imap/index.js';
import { reviewMessageToEmailMessage } from '../imap/index.js';
import { evaluateRules } from '../rules/index.js';
import { executeAction } from '../actions/index.js';
import type { ActionContext } from '../actions/index.js';
import type { ActivityLog } from '../log/index.js';
import type { Rule } from '../config/index.js';
import pinoLib from 'pino';
import type pino from 'pino';

const CHUNK_SIZE = 25;

export type BatchStatus = 'idle' | 'dry-running' | 'previewing' | 'executing' | 'completed' | 'cancelled' | 'error';

export interface BatchDeps {
  client: ImapClient;
  activityLog: ActivityLog;
  rules: Rule[];
  reviewFolder: string;
  trashFolder: string;
  logger?: pino.Logger;
}

export interface BatchState {
  status: BatchStatus;
  sourceFolder: string | null;
  totalMessages: number;
  processed: number;
  moved: number;
  skipped: number;
  errors: number;
  cancelled: boolean;
  dryRunResults: DryRunGroup[] | null;
  completedAt: string | null;
}

export interface DryRunGroup {
  destination: string;
  action: string;
  count: number;
  messages: DryRunMessage[];
}

export interface DryRunMessage {
  uid: number;
  from: string;
  subject: string;
  date: string;
  ruleName: string;
}

export interface BatchResult {
  status: 'completed' | 'cancelled' | 'error';
  totalMessages: number;
  processed: number;
  moved: number;
  skipped: number;
  errors: number;
  completedAt: string;
}

export class BatchEngine {
  private deps: BatchDeps;
  private readonly logger: pino.Logger;
  private cancelRequested = false;
  private running = false;
  private state: BatchState;

  constructor(deps: BatchDeps) {
    this.deps = deps;
    this.logger = deps.logger ?? pinoLib({ name: 'batch' });
    this.state = this.makeIdleState();
  }

  /** Run a dry-run evaluation of all messages in the source folder. */
  async dryRun(sourceFolder: string): Promise<DryRunGroup[]> {
    if (this.running) {
      throw new Error('Batch already running');
    }

    this.running = true;
    this.state.status = 'dry-running';
    this.state.sourceFolder = sourceFolder;

    try {
      const messages = await this.deps.client.fetchAllMessages(sourceFolder);
      this.state.totalMessages = messages.length;

      const groupMap = new Map<string, DryRunGroup>();

      for (const raw of messages) {
        const msg = reviewMessageToEmailMessage(raw);
        const matched = evaluateRules(this.deps.rules, msg);

        let key: string;
        let destination: string;
        let action: string;
        let ruleName: string;

        if (!matched) {
          key = 'no-match';
          destination = 'No match';
          action = 'no-match';
          ruleName = '';
        } else {
          ruleName = matched.name;
          action = matched.action.type;
          destination = this.resolveDestination(matched);
          key = `${action}:${destination}`;
        }

        let group = groupMap.get(key);
        if (!group) {
          group = { destination, action, count: 0, messages: [] };
          groupMap.set(key, group);
        }

        group.count++;
        group.messages.push({
          uid: msg.uid,
          from: msg.from.address,
          subject: msg.subject,
          date: msg.date.toISOString(),
          ruleName,
        });
      }

      const groups = Array.from(groupMap.values());
      this.state.dryRunResults = groups;
      this.state.status = 'previewing';
      return groups;
    } catch (err) {
      this.state.status = 'error';
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** Execute batch rule application on all messages in the source folder. */
  async execute(sourceFolder: string): Promise<BatchResult> {
    if (this.running) {
      throw new Error('Batch already running');
    }

    this.running = true;
    this.cancelRequested = false;
    this.state = {
      ...this.makeIdleState(),
      status: 'executing',
      sourceFolder,
    };

    try {
      const messages = await this.deps.client.fetchAllMessages(sourceFolder);
      this.state.totalMessages = messages.length;

      const ctx: ActionContext = {
        client: this.deps.client,
        reviewFolder: this.deps.reviewFolder,
        trashFolder: this.deps.trashFolder,
      };

      for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
        if (this.cancelRequested) {
          this.state.status = 'cancelled';
          this.state.cancelled = true;
          break;
        }

        const chunk = messages.slice(i, i + CHUNK_SIZE);

        for (const raw of chunk) {
          const msg = reviewMessageToEmailMessage(raw);
          const matched = evaluateRules(this.deps.rules, msg);

          if (!matched) {
            this.state.skipped++;
            this.state.processed++;
            continue;
          }

          try {
            const result = await executeAction(ctx, msg, matched);
            this.deps.activityLog.logActivity(result, msg, matched, 'batch' as 'arrival' | 'sweep');

            if (result.success) {
              this.state.moved++;
            } else {
              this.state.errors++;
            }
          } catch (err) {
            this.state.errors++;
            this.logger.error(
              { uid: raw.uid, error: err instanceof Error ? err.message : String(err) },
              'Batch message failed',
            );
          }

          this.state.processed++;
        }

        // Yield between chunks
        if (i + CHUNK_SIZE < messages.length && !this.cancelRequested) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }

      if (this.state.status === 'executing') {
        this.state.status = 'completed';
      }

      return this.buildResult();
    } catch (err) {
      this.state.status = 'error';
      this.logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Batch execute failed');
      return this.buildResult();
    } finally {
      this.running = false;
      this.state.completedAt = new Date().toISOString();
    }
  }

  /** Request cancellation. Processing stops after the current chunk completes. */
  cancel(): void {
    if (this.running) {
      this.cancelRequested = true;
    }
  }

  /** Return a copy of the current batch state. */
  getState(): BatchState {
    return {
      ...this.state,
      dryRunResults: this.state.dryRunResults ? [...this.state.dryRunResults] : null,
    };
  }

  /** Replace the internal rules array. */
  updateRules(rules: Rule[]): void {
    this.deps.rules = rules;
  }

  private resolveDestination(rule: Rule): string {
    switch (rule.action.type) {
      case 'move':
        return rule.action.folder;
      case 'review':
        return this.deps.reviewFolder;
      case 'delete':
        return this.deps.trashFolder;
      case 'skip':
        return 'Skip';
      default:
        return 'Unknown';
    }
  }

  private makeIdleState(): BatchState {
    return {
      status: 'idle',
      sourceFolder: null,
      totalMessages: 0,
      processed: 0,
      moved: 0,
      skipped: 0,
      errors: 0,
      cancelled: false,
      dryRunResults: null,
      completedAt: null,
    };
  }

  private buildResult(): BatchResult {
    return {
      status: this.state.status as 'completed' | 'cancelled' | 'error',
      totalMessages: this.state.totalMessages,
      processed: this.state.processed,
      moved: this.state.moved,
      skipped: this.state.skipped,
      errors: this.state.errors,
      completedAt: this.state.completedAt!,
    };
  }
}
