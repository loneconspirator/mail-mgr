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
import { isSentinel } from '../sentinel/index.js';

export type ProcessResult =
  | { ok: true; action: ActionType; sender: string; ruleId?: string }
  | { ok: false; action: ActionType; error: string };

export function extractSender(message: EmailMessage): string | null {
  const raw = message.from?.address;
  if (!raw || !raw.includes('@')) return null;
  return raw.toLowerCase().trim();
}

interface PendingActivity {
  action: string;
  ruleId: string;
  rule: Rule;
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
    // Sentinel guard -- returns before diagnostic log (D-07)
    if (isSentinel(message.headers)) {
      this.logger.debug({ uid: message.uid }, 'Skipping sentinel message');
      return { ok: true, action: actionType, sender: 'sentinel' };
    }

    const actionDef = ACTION_REGISTRY[actionType];
    const sender = extractSender(message);
    const sourceFolder = this.getSourceFolder(actionType);

    if (!sender) {
      this.logger.error({ uid: message.uid }, 'Unparseable From address in action folder message');
      await this.client.moveMessage(message.uid, this.inboxFolder, sourceFolder);
      return { ok: false, action: actionType, error: 'Unparseable From address' };
    }

    // D-07: Diagnostic logging -- after sender extraction, before business logic
    this.logger.info({
      uid: message.uid,
      messageId: message.messageId,
      sender,
      subject: message.subject,
      actionType,
      folder: sourceFolder,
    }, 'Processing action folder message');

    const rules = this.configRepo.getRules();
    const destination = this.resolveDestination(actionDef.destination);
    const pendingActivities: PendingActivity[] = [];
    let createdRule: Rule | undefined;

    if (actionDef.operation === 'create') {
      // Check for conflicting sender-only rule (opposite action type)
      const oppositeAction = actionDef.ruleAction === 'skip' ? 'delete' : 'skip';
      const conflict = findSenderRule(sender, oppositeAction, rules);

      if (conflict) {
        this.configRepo.deleteRule(conflict.id);
        pendingActivities.push({
          action: `remove-${conflict.action.type}`,
          ruleId: conflict.id,
          rule: conflict,
        });
      }

      // Check for existing same-type rule (idempotency per D-01, D-03)
      // D-06: duplicate path has its own move + log + return
      const duplicate = findSenderRule(sender, actionDef.ruleAction, rules);
      if (duplicate) {
        this.logger.debug({ sender, actionType }, 'Rule already exists for sender, skipping creation');

        // D-06: Handle any pending conflict activities before duplicate return
        try {
          await this.client.moveMessage(message.uid, destination, sourceFolder);
        } catch (err) {
          this.logger.error({ uid: message.uid, err }, 'Failed to move duplicate message');
          // Log pending conflict activities with failure
          for (const pending of pendingActivities) {
            const result = this.buildActionResult(message, pending.action, pending.ruleId, destination, false);
            this.activityLog.logActivity(result, message, pending.rule, 'action-folder');
          }
          const dupResult = this.buildActionResult(message, `duplicate-${actionDef.ruleAction}`, duplicate.id, destination, false);
          this.activityLog.logActivity(dupResult, message, duplicate, 'action-folder');
          return { ok: false, action: actionType, error: 'Message move failed' };
        }
        // Log pending conflict activities with success
        for (const pending of pendingActivities) {
          const result = this.buildActionResult(message, pending.action, pending.ruleId, destination, true);
          this.activityLog.logActivity(result, message, pending.rule, 'action-folder');
        }
        const dupResult = this.buildActionResult(message, `duplicate-${actionDef.ruleAction}`, duplicate.id, destination, true);
        this.activityLog.logActivity(dupResult, message, duplicate, 'action-folder');
        return { ok: true, action: actionType, sender, ruleId: duplicate.id };
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

        pendingActivities.push({
          action: actionDef.ruleAction,
          ruleId: createdRule.id,
          rule: createdRule,
        });
      }
    } else {
      // Remove operation
      const existing = findSenderRule(sender, actionDef.ruleAction, rules);
      if (existing) {
        this.configRepo.deleteRule(existing.id);
        pendingActivities.push({
          action: `remove-${existing.action.type}`,
          ruleId: existing.id,
          rule: existing,
        });
      } else {
        this.logger.info({ sender, actionType }, 'No matching rule found for undo, moving message to destination');
      }
    }

    // D-05: Move message THEN log activities (not before)
    try {
      await this.client.moveMessage(message.uid, destination, sourceFolder);
    } catch (err) {
      this.logger.error({ uid: message.uid, err }, 'Failed to move message after action folder processing');
      // Log pending activities with success: false
      for (const pending of pendingActivities) {
        const result = this.buildActionResult(message, pending.action, pending.ruleId, destination, false);
        this.activityLog.logActivity(result, message, pending.rule, 'action-folder');
      }
      return { ok: false, action: actionType, error: 'Message move failed' };
    }

    // Log all pending activities with success: true (after successful move)
    for (const pending of pendingActivities) {
      const result = this.buildActionResult(message, pending.action, pending.ruleId, destination, true);
      this.activityLog.logActivity(result, message, pending.rule, 'action-folder');
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
    success: boolean = true,
  ): ActionResult {
    return {
      success,
      messageUid: message.uid,
      messageId: message.messageId,
      action,
      folder,
      rule: ruleId,
      timestamp: new Date(),
    };
  }
}
