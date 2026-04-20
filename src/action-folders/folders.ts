import type { ImapClient } from '../imap/client.js';
import type { ActionFolderConfig } from '../config/schema.js';
import type { Logger } from 'pino';

/**
 * Check if a folder exists by calling status().
 * status() throws if the folder doesn't exist (IMAP STATUS requires existing mailbox).
 */
async function folderExists(client: ImapClient, path: string): Promise<boolean> {
  try {
    await client.status(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure all action folders exist on the IMAP server.
 * Uses status() to check existence, array-form mailboxCreate for separator safety.
 * Returns true if all folders exist/were created, false on any creation failure.
 * Per D-07: called lazily when monitoring starts, not during startup sequence.
 * Per D-08: check existence first via status(), only create if missing.
 * Per D-09: on failure, log error and return false for graceful degradation.
 */
export async function ensureActionFolders(
  client: ImapClient,
  config: ActionFolderConfig,
  logger: Logger,
): Promise<boolean> {
  const folderEntries: Array<{ key: string; name: string }> = [
    { key: 'vip', name: config.folders.vip },
    { key: 'block', name: config.folders.block },
    { key: 'undoVip', name: config.folders.undoVip },
    { key: 'unblock', name: config.folders.unblock },
  ];

  for (const entry of folderEntries) {
    const fullPath = `${config.prefix}/${entry.name}`;
    const exists = await folderExists(client, fullPath);
    if (exists) {
      logger.debug('Action folder already exists: %s', fullPath);
      continue;
    }
    try {
      await client.createMailbox([config.prefix, entry.name]);
      logger.info('Created action folder: %s', fullPath);
    } catch (err) {
      logger.error({ err }, 'Failed to create action folder: %s', fullPath);
      return false;
    }
  }
  return true;
}
