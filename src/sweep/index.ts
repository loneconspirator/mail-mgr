import type { ImapClient, ReviewMessage } from '../imap/index.js';
import type { ActivityLog } from '../log/index.js';
import type { Rule, ReviewConfig, SweepConfig } from '../config/index.js';
import type pino from 'pino';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
