import { randomUUID } from 'node:crypto';

export type FolderPurpose = 'rule-target' | 'action-folder' | 'review' | 'sweep-target';

export interface BuildSentinelOpts {
  folderPath: string;
  folderPurpose: FolderPurpose;
  bodyText?: string;
}

export interface SentinelMessage {
  /** RFC 2822 raw message for IMAP APPEND */
  raw: string;
  /** Full Message-ID with angle brackets: <uuid@mail-manager.sentinel> */
  messageId: string;
  /** IMAP flags to set on APPEND */
  flags: string[];
}

/**
 * Construct an RFC 2822-compliant sentinel message for IMAP APPEND.
 *
 * Sentinels are lightweight marker messages planted in folders so that
 * Mail Manager can detect renames and track folder identity over time.
 */
export function buildSentinelMessage(opts: BuildSentinelOpts): SentinelMessage {
  // Guard: INBOX never gets a sentinel
  if (opts.folderPath.toUpperCase() === 'INBOX') {
    throw new Error('Cannot create sentinel for INBOX');
  }

  // Guard: prevent header injection via CR/LF in folder path
  if (/[\r\n]/.test(opts.folderPath)) {
    throw new Error('Folder path contains invalid characters');
  }

  const uuid = randomUUID();
  const messageId = `<${uuid}@mail-manager.sentinel>`;
  const date = new Date().toUTCString();
  const body = opts.bodyText ?? purposeBody(opts.folderPath, opts.folderPurpose);

  const headers = [
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    `From: mail-manager@localhost`,
    `To: mail-manager@localhost`,
    `Subject: [Mail Manager] Sentinel: ${opts.folderPath}`,
    `X-Mail-Mgr-Sentinel: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
  ];

  const raw = headers.join('\r\n') + '\r\n\r\n' + body;

  return { raw, messageId, flags: ['\\Seen'] };
}

/**
 * Generate descriptive body text for a sentinel message based on folder purpose.
 */
export function purposeBody(folderPath: string, purpose: FolderPurpose): string {
  switch (purpose) {
    case 'rule-target':
      return `This message is a Mail Manager sentinel. It tracks the folder '${folderPath}' so that folder renames can be automatically detected and all references updated. Please do not delete this message.`;
    case 'action-folder':
      return `This message is a Mail Manager sentinel. It tracks the action folder '${folderPath}'. Moving messages into this folder triggers automatic processing. If this folder is renamed, Mail Manager will detect the change and update its configuration. Please do not delete this message.`;
    case 'review':
      return `This message is a Mail Manager sentinel. It tracks the review folder '${folderPath}'. Messages are placed here for periodic review before archiving. Please do not delete this message.`;
    case 'sweep-target':
      return `This message is a Mail Manager sentinel. It tracks the sweep target folder '${folderPath}'. Reviewed messages are swept here after the review period. Please do not delete this message.`;
  }
}
