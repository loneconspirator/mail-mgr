import type { Rule } from '../config/index.js';
import type { ImapClient, EmailMessage } from '../imap/index.js';

export interface ActionContext {
  client: ImapClient;
  reviewFolder: string;
  trashFolder: string;
}

export interface ActionResult {
  success: boolean;
  messageUid: number;
  messageId: string;
  action: string;
  folder?: string;
  rule: string;
  timestamp: Date;
  error?: string;
}

/**
 * Execute the action from a matched rule on a message.
 * For "move" actions: moves the message by UID to the target folder,
 * auto-creating the folder if it doesn't exist.
 */
export async function executeAction(
  ctx: ActionContext,
  message: EmailMessage,
  rule: Rule,
): Promise<ActionResult> {
  const { action } = rule;
  const base = {
    messageUid: message.uid,
    messageId: message.messageId,
    rule: rule.id,
    timestamp: new Date(),
  };

  switch (action.type) {
    case 'move':
      return executeMove(ctx.client, message, action.folder, base);
    case 'review': {
      return executeMove(ctx.client, message, ctx.reviewFolder, base).then((r) => ({ ...r, action: 'review' }));
    }
    case 'skip':
      return { ...base, success: true, action: 'skip' };
    case 'delete':
      return executeMove(ctx.client, message, ctx.trashFolder, base).then((r) => ({ ...r, action: 'delete' }));
    default:
      return { ...base, success: false, action: 'unknown', error: `Unknown action type` };
  }
}

async function executeMove(
  client: ImapClient,
  message: EmailMessage,
  folder: string,
  base: Omit<ActionResult, 'success' | 'action' | 'folder' | 'error'>,
): Promise<ActionResult> {
  try {
    await client.moveMessage(message.uid, folder);
    return { ...base, success: true, action: 'move', folder };
  } catch (firstErr) {
    // If move failed, try creating the folder and retry once
    try {
      await client.createMailbox(folder);
      await client.moveMessage(message.uid, folder);
      return { ...base, success: true, action: 'move', folder };
    } catch (retryErr) {
      const error = retryErr instanceof Error ? retryErr.message : String(retryErr);
      return { ...base, success: false, action: 'move', folder, error };
    }
  }
}
