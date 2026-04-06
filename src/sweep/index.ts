import type { ImapClient, ReviewMessage } from '../imap/index.js';
import { reviewMessageToEmailMessage } from '../imap/index.js';
import { evaluateRules } from '../rules/index.js';
import type { ActivityLog } from '../log/index.js';
import type { Rule, ReviewConfig, SweepConfig } from '../config/index.js';
import pinoLib from 'pino';
import type pino from 'pino';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SweepDestination =
  | { type: 'move'; folder: string }
  | { type: 'delete' };

export interface SweepResult {
  destination: SweepDestination;
  matchedRule: Rule | null;
}

export function resolveSweepDestination(
  message: ReviewMessage,
  rules: Rule[],
  defaultArchiveFolder: string,
): SweepResult {
  // Filter out skip rules and review rules without a folder (no useful sweep destination)
  const candidates = rules.filter(
    (r) => r.action.type !== 'skip' && !(r.action.type === 'review' && !r.action.folder),
  );
  const emailMsg = reviewMessageToEmailMessage(message);
  const matched = evaluateRules(candidates, emailMsg);

  if (!matched) {
    return { destination: { type: 'move', folder: defaultArchiveFolder }, matchedRule: null };
  }

  switch (matched.action.type) {
    case 'move':
      return { destination: { type: 'move', folder: matched.action.folder }, matchedRule: matched };
    case 'delete':
      return { destination: { type: 'delete' }, matchedRule: matched };
    case 'review': {
      const folder = matched.action.folder ?? defaultArchiveFolder;
      return { destination: { type: 'move', folder }, matchedRule: matched };
    }
    default:
      return { destination: { type: 'move', folder: defaultArchiveFolder }, matchedRule: matched };
  }
}

export function isEligibleForSweep(
  message: ReviewMessage,
  config: SweepConfig,
  now: Date,
): boolean {
  const ageDays = (now.getTime() - message.internalDate.getTime()) / MS_PER_DAY;
  const isRead = message.flags.has('\\Seen');
  const threshold = isRead ? config.readMaxAgeDays : config.unreadMaxAgeDays;
  return ageDays >= threshold;
}

export interface SweepDeps {
  client: ImapClient;
  activityLog: ActivityLog;
  rules: Rule[];
  reviewConfig: ReviewConfig;
  trashFolder: string;
  logger?: pino.Logger;
}

export interface SweepState {
  folder: string;
  totalMessages: number;
  unreadMessages: number;
  readMessages: number;
  nextSweepAt: string | null;
  lastSweep: {
    completedAt: string;
    messagesArchived: number;
    errors: number;
  } | null;
}

const INITIAL_DELAY_MS = 30_000;

export class ReviewSweeper {
  private readonly client: ImapClient;
  private readonly activityLog: ActivityLog;
  private rules: Rule[];
  private readonly reviewConfig: ReviewConfig;
  private readonly trashFolder: string;
  private readonly logger: pinoLib.Logger;

  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private sweepState: SweepState;

  constructor(deps: SweepDeps) {
    this.client = deps.client;
    this.activityLog = deps.activityLog;
    this.rules = deps.rules;
    this.reviewConfig = deps.reviewConfig;
    this.trashFolder = deps.trashFolder;
    this.logger = deps.logger ?? pinoLib({ name: 'sweep' });

    this.sweepState = {
      folder: this.reviewConfig.folder,
      totalMessages: 0,
      unreadMessages: 0,
      readMessages: 0,
      nextSweepAt: null,
      lastSweep: null,
    };
  }

  getState(): SweepState {
    return { ...this.sweepState };
  }

  updateRules(rules: Rule[]): void {
    this.rules = rules;
  }

  start(): void {
    this.stop();

    const intervalMs = this.reviewConfig.sweep.intervalHours * 60 * 60 * 1000;

    this.sweepState.nextSweepAt = new Date(Date.now() + INITIAL_DELAY_MS).toISOString();

    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      this.runSweep();

      this.sweepState.nextSweepAt = new Date(Date.now() + intervalMs).toISOString();
      this.intervalTimer = setInterval(() => {
        this.sweepState.nextSweepAt = new Date(Date.now() + intervalMs).toISOString();
        this.runSweep();
      }, intervalMs);
    }, INITIAL_DELAY_MS);
  }

  stop(): void {
    if (this.initialTimer !== null) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.sweepState.nextSweepAt = null;
  }

  restart(): void {
    this.stop();
    this.start();
  }

  async runSweep(): Promise<void> {
    if (this.running) {
      this.logger.debug('Sweep already running, skipping');
      return;
    }

    if (this.client.state !== 'connected') {
      this.logger.debug('Client not connected, skipping sweep');
      return;
    }

    this.running = true;
    const now = new Date();
    let archived = 0;
    let errors = 0;

    try {
      const messages = await this.client.fetchAllMessages(this.reviewConfig.folder);

      const readCount = messages.filter((m) => m.flags.has('\\Seen')).length;
      this.sweepState.totalMessages = messages.length;
      this.sweepState.readMessages = readCount;
      this.sweepState.unreadMessages = messages.length - readCount;

      for (const msg of messages) {
        if (!isEligibleForSweep(msg, this.reviewConfig.sweep, now)) {
          continue;
        }

        const { destination: dest, matchedRule } = resolveSweepDestination(msg, this.rules, this.reviewConfig.defaultArchiveFolder);
        const folder = dest.type === 'delete' ? this.trashFolder : dest.folder;
        const emailMsg = reviewMessageToEmailMessage(msg);

        try {
          await this.client.moveMessage(msg.uid, folder, this.reviewConfig.folder);

          const result = {
            success: true as const,
            messageUid: msg.uid,
            messageId: msg.envelope.messageId,
            action: dest.type === 'delete' ? 'delete' : 'move',
            folder,
            rule: matchedRule?.name ?? '',
            timestamp: new Date(),
          };
          this.activityLog.logActivity(result, emailMsg, matchedRule, 'sweep');
          archived++;
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.logger.error({ uid: msg.uid, error }, 'Failed to move message during sweep');

          const result = {
            success: false as const,
            messageUid: msg.uid,
            messageId: msg.envelope.messageId,
            action: dest.type === 'delete' ? 'delete' : 'move',
            folder,
            rule: matchedRule?.name ?? '',
            timestamp: new Date(),
            error,
          };
          this.activityLog.logActivity(result, emailMsg, matchedRule, 'sweep');
          errors++;
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Sweep fetch failed');
    } finally {
      this.running = false;
      this.sweepState.lastSweep = {
        completedAt: new Date().toISOString(),
        messagesArchived: archived,
        errors,
      };
    }
  }
}
