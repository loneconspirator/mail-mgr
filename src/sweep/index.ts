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

export function resolveSweepDestination(
  message: ReviewMessage,
  rules: Rule[],
  defaultArchiveFolder: string,
): SweepDestination {
  // Filter out skip rules, then evaluate
  const candidates = rules.filter((r) => r.action.type !== 'skip');
  const emailMsg = reviewMessageToEmailMessage(message);
  const matched = evaluateRules(candidates, emailMsg);

  if (!matched) {
    return { type: 'move', folder: defaultArchiveFolder };
  }

  switch (matched.action.type) {
    case 'move':
      return { type: 'move', folder: matched.action.folder };
    case 'delete':
      return { type: 'delete' };
    case 'review': {
      const folder = matched.action.folder ?? defaultArchiveFolder;
      return { type: 'move', folder };
    }
    default:
      return { type: 'move', folder: defaultArchiveFolder };
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
    // stub — implemented in Task 5
  }
}
