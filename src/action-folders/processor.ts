import type { ConfigRepository } from '../config/repository.js';
import type { ImapClient } from '../imap/client.js';
import type { ActivityLog } from '../log/index.js';
import type { EmailMessage } from '../imap/messages.js';
import type { ActionType } from './registry.js';
import type { ActionResult } from '../actions/index.js';
import type { Rule } from '../config/schema.js';
import type { Logger } from 'pino';
import { ACTION_REGISTRY } from './registry.js';
import { findSenderRule } from '../rules/sender-utils.js';

export type ProcessResult =
  | { ok: true; action: ActionType; sender: string; ruleId?: string }
  | { ok: false; action: ActionType; error: string };

export function extractSender(message: EmailMessage): string | null {
  const raw = message.from?.address;
  if (!raw || !raw.includes('@')) return null;
  return raw.toLowerCase().trim();
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
    const actionDef = ACTION_REGISTRY[actionType];
    const sender = extractSender(message);
    const sourceFolder = this.getSourceFolder(actionType);

    if (!sender) {
      this.logger.error({ uid: message.uid }, 'Unparseable From address in action folder message');
      await this.client.moveMessage(message.uid, this.inboxFolder, sourceFolder);
      return { ok: false, action: actionType, error: 'Unparseable From address' };
    }

    const rules = this.configRepo.getRules();
    const destination = this.resolveDestination(actionDef.destination);
    let createdRule: Rule | undefined;

    if (actionDef.operation === 'create') {
      // Check for conflicting sender-only rule (opposite action type)
      const oppositeAction = actionDef.ruleAction === 'skip' ? 'delete' : 'skip';
      const conflict = findSenderRule(sender, oppositeAction, rules);

      if (conflict) {
        this.configRepo.deleteRule(conflict.id);
        const removalResult = this.buildActionResult(message, `remove-${conflict.action.type}`, conflict.id, destination);
        this.activityLog.logActivity(removalResult, message, conflict, 'action-folder');
      }

      // Check for existing same-type rule (idempotency per D-01, D-03)
      const duplicate = findSenderRule(sender, actionDef.ruleAction, rules);
      if (duplicate) {
        this.logger.debug({ sender, actionType }, 'Rule already exists for sender, skipping creation');
        const dupResult = this.buildActionResult(message, `duplicate-${actionDef.ruleAction}`, duplicate.id, destination);
        this.activityLog.logActivity(dupResult, message, duplicate, 'action-folder');
      } else {
        // Create the new rule
        const label = actionType === 'vip' ? 'VIP' : 'Block';
        createdRule = this.configRepo.addRule({
          name: `${label}: ${sender}`,
          match: { sender },
          action: { type: actionDef.ruleAction },
          enabled: true,
          order: this.configRepo.nextOrder(),
        });

        const createResult = this.buildActionResult(message, actionDef.ruleAction, createdRule.id, destination);
        this.activityLog.logActivity(createResult, message, createdRule, 'action-folder');
      }
    } else {
      // Remove operation
      const existing = findSenderRule(sender, actionDef.ruleAction, rules);
      if (existing) {
        this.configRepo.deleteRule(existing.id);
        const removeResult = this.buildActionResult(message, `remove-${existing.action.type}`, existing.id, destination);
        this.activityLog.logActivity(removeResult, message, existing, 'action-folder');
      } else {
        this.logger.info({ sender, actionType }, 'No matching rule found for undo, moving message to destination');
      }
    }

    // Move message (do NOT roll back rule changes on failure)
    try {
      await this.client.moveMessage(message.uid, destination, sourceFolder);
    } catch (err) {
      this.logger.error({ uid: message.uid, err }, 'Failed to move message after action folder processing');
      return { ok: false, action: actionType, error: 'Message move failed' };
    }

    return { ok: true, action: actionType, sender, ruleId: createdRule?.id };
  }

  private resolveDestination(destination: 'inbox' | 'trash'): string {
    return destination === 'inbox' ? this.inboxFolder : this.trashFolder;
  }

  private getSourceFolder(actionType: ActionType): string {
    const config = this.configRepo.getActionFolderConfig();
    const actionDef = ACTION_REGISTRY[actionType];
    return `${config.prefix}/${config.folders[actionDef.folderConfigKey]}`;
  }

  private buildActionResult(
    message: EmailMessage,
    action: string,
    ruleId: string,
    folder: string,
  ): ActionResult {
    return {
      success: true,
      messageUid: message.uid,
      messageId: message.messageId,
      action,
      folder,
      rule: ruleId,
      timestamp: new Date(),
    };
  }
}
