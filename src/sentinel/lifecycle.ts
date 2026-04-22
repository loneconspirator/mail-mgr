import type { FolderPurpose } from './format.js';
import type { Config } from '../config/schema.js';
import type { SentinelStore } from './store.js';
import type { ImapClient } from '../imap/index.js';
import { appendSentinel, findSentinel, deleteSentinel } from './imap-ops.js';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Enumerate all folders that need sentinel tracking based on config.
 * Returns a Map of folderPath -> FolderPurpose.
 *
 * Sources:
 * - Enabled rules with move/review actions that specify a folder
 * - review.folder (the review inbox)
 * - review.defaultArchiveFolder (sweep target)
 * - actionFolders paths (when enabled)
 *
 * INBOX is always excluded. First purpose wins when multiple sources
 * reference the same folder path.
 */
export function collectTrackedFolders(config: Config): Map<string, FolderPurpose> {
  const tracked = new Map<string, FolderPurpose>();

  function addIfValid(path: string, purpose: FolderPurpose): void {
    if (path.toUpperCase() === 'INBOX') return;
    if (tracked.has(path)) return;
    tracked.set(path, purpose);
  }

  // 1. Enabled rules with move or review actions
  for (const rule of config.rules) {
    if (!rule.enabled) continue;

    if (rule.action.type === 'move' && rule.action.folder) {
      addIfValid(rule.action.folder, 'rule-target');
    } else if (rule.action.type === 'review' && rule.action.folder) {
      addIfValid(rule.action.folder, 'review');
    }
  }

  // 2. Review folder
  addIfValid(config.review.folder, 'review');

  // 3. Sweep target
  addIfValid(config.review.defaultArchiveFolder, 'sweep-target');

  // 4. Action folders (when enabled)
  if (config.actionFolders.enabled) {
    const prefix = config.actionFolders.prefix;
    for (const folderName of Object.values(config.actionFolders.folders)) {
      addIfValid(`${prefix}/${folderName}`, 'action-folder');
    }
  }

  return tracked;
}

/**
 * Diff tracked folders against the sentinel store, planting missing
 * sentinels and removing orphaned ones. Per-folder errors are caught
 * so one bad folder doesn't abort the entire reconciliation.
 */
export async function reconcileSentinels(
  tracked: Map<string, FolderPurpose>,
  store: SentinelStore,
  client: ImapClient,
  logger: Logger,
): Promise<{ planted: number; removed: number; errors: number }> {
  let planted = 0;
  let removed = 0;
  let errors = 0;

  const existing = store.getAll();
  const existingFolders = new Set(existing.map((s) => s.folderPath));

  // Plant missing sentinels
  for (const [folder, purpose] of tracked) {
    if (existingFolders.has(folder)) continue;
    try {
      await appendSentinel(client, folder, purpose, store);
      planted++;
      logger.info({ folder, purpose }, 'Planted sentinel');
    } catch (err) {
      errors++;
      logger.warn({ err, folder }, 'Failed to plant sentinel');
    }
  }

  // Remove orphaned sentinels
  for (const sentinel of existing) {
    if (tracked.has(sentinel.folderPath)) continue;
    try {
      const uid = await findSentinel(client, sentinel.folderPath, sentinel.messageId);
      if (uid !== undefined) {
        await deleteSentinel(client, sentinel.folderPath, uid, store, sentinel.messageId);
      } else {
        // Sentinel not on IMAP — clean store only
        store.deleteByMessageId(sentinel.messageId);
      }
      removed++;
      logger.info({ folder: sentinel.folderPath }, 'Removed orphaned sentinel');
    } catch (err) {
      errors++;
      logger.warn({ err, folder: sentinel.folderPath }, 'Failed to remove orphaned sentinel');
    }
  }

  return { planted, removed, errors };
}
