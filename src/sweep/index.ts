import type { ImapClient, ReviewMessage } from '../imap/index.js';
import { reviewMessageToEmailMessage } from '../imap/index.js';
import { evaluateRules } from '../rules/index.js';
import type { ActivityLog } from '../log/index.js';
import type { Rule, ReviewConfig, SweepConfig } from '../config/index.js';
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
