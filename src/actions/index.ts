import type { Action, Rule } from '../config/index.js';
import type { ImapClient } from '../imap/index.js';
import type { EmailMessage } from '../imap/index.js';

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
  client: ImapClient,
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
      return executeMove(client, message, action.folder, base);
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
