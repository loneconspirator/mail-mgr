import type { ConfigRepository } from '../config/repository.js';
import type { ImapClient } from '../imap/client.js';
import type { ActivityLog } from '../log/index.js';
import type { EmailMessage } from '../imap/messages.js';
import type { ActionType } from './registry.js';
import type { Logger } from 'pino';

export type ProcessResult =
  | { ok: true; action: ActionType; sender: string; ruleId?: string }
  | { ok: false; action: ActionType; error: string };

export function extractSender(message: EmailMessage): string | null {
  // TODO: implement
  return null;
}

export class ActionFolderProcessor {
  constructor(
    private readonly configRepo: ConfigRepository,
    private readonly client: ImapClient,
    private readonly activityLog: ActivityLog,
    private readonly logger: Logger,
    private readonly inboxFolder: string,
    private readonly trashFolder: string,
  ) {}

  async processMessage(message: EmailMessage, actionType: ActionType): Promise<ProcessResult> {
    // TODO: implement
    return { ok: false, action: actionType, error: 'Not implemented' };
  }
}
