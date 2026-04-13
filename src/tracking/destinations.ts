import type { ImapClient, ImapFlowLike } from '../imap/index.js';
import type { ActivityLog } from '../log/index.js';
import type pino from 'pino';

/** Folder info returned by listFolders. */
export interface FolderInfo {
  path: string;
  flags: string[];
}

export interface DestinationResolverDeps {
  client: ImapClient;
  activityLog: ActivityLog;
  /** Returns all IMAP folders (flat list with path and flags). */
  listFolders: () => Promise<FolderInfo[]>;
  logger?: pino.Logger;
}

/** Hardcoded common folder names for fast-pass resolution. */
const COMMON_FOLDERS = [
  'Archive',
  'All Mail',
  'Trash',
  'Deleted Items',
  'Junk',
  'Spam',
  '[Gmail]/All Mail',
  '[Gmail]/Trash',
  '[Gmail]/Spam',
];

/**
 * Two-tier destination resolver for user-initiated moves.
 * Fast pass checks recent folders and common names.
 * Deep scan searches all folders by Message-ID on a longer cycle.
 */
export class DestinationResolver {
  private deps: DestinationResolverDeps;
  private pendingDeepScan: Map<string, { messageId: string; sourceFolder: string }> = new Map();

  constructor(deps: DestinationResolverDeps) {
    this.deps = deps;
  }

  /**
   * Fast-pass destination resolution.
   * Checks recent folders from activity log + hardcoded common folder names.
   * Returns the folder path where the message was found, or null.
   */
  async resolveFast(messageId: string, sourceFolder: string): Promise<string | null> {
    const recentFolders = this.deps.activityLog.getRecentFolders(10);

    // Build deduplicated candidate list, excluding source folder
    const candidates = new Set<string>();
    for (const folder of recentFolders) {
      if (folder !== sourceFolder) {
        candidates.add(folder);
      }
    }
    for (const folder of COMMON_FOLDERS) {
      if (folder !== sourceFolder) {
        candidates.add(folder);
      }
    }

    for (const folder of candidates) {
      const found = await this.searchFolderForMessage(folder, messageId);
      if (found) {
        return folder;
      }
    }

    return null;
  }

  /**
   * Enqueue a message for deep scan (searched on next runDeepScan cycle).
   */
  enqueueDeepScan(messageId: string, sourceFolder: string): void {
    this.pendingDeepScan.set(messageId, { messageId, sourceFolder });
  }

  /**
   * Deep scan: search all IMAP folders for pending messages.
   * Skips non-selectable folders, source folders, and common folders already checked in fast pass.
   * Per D-06: messages not found are dropped entirely (removed from pendingDeepScan).
   * Returns a Map of messageId -> destinationFolder for resolved messages.
   */
  async runDeepScan(): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    if (this.pendingDeepScan.size === 0) {
      return results;
    }

    const allFolders = await this.deps.listFolders();
    const commonSet = new Set(COMMON_FOLDERS);

    for (const [messageId, entry] of this.pendingDeepScan) {
      let found = false;

      for (const folder of allFolders) {
        // Skip non-selectable folders
        if (folder.flags.includes('\\Noselect')) {
          continue;
        }
        // Skip source folder
        if (folder.path === entry.sourceFolder) {
          continue;
        }
        // Skip folders already checked in fast pass
        if (commonSet.has(folder.path)) {
          continue;
        }

        const match = await this.searchFolderForMessage(folder.path, messageId);
        if (match) {
          results.set(messageId, folder.path);
          found = true;
          break;
        }
      }

      // D-06: Whether found or not, remove from pending (dropped if unresolvable)
      if (!found) {
        // Message not found anywhere -- dropped per D-06
      }
    }

    // Clear all pending entries after deep scan completes
    this.pendingDeepScan.clear();

    return results;
  }

  /**
   * Search a single folder for a message by Message-ID.
   * Uses envelope.messageId matching via IMAP fetch.
   * NOTE: ImapFlow's search() with Message-ID header should be investigated
   * for better performance on large folders. Currently iterates envelopes.
   */
  private async searchFolderForMessage(folder: string, messageId: string): Promise<boolean> {
    try {
      return await this.deps.client.withMailboxLock(folder, async (flow: ImapFlowLike) => {
        for await (const msg of flow.fetch('1:*', { uid: true, envelope: true }, { uid: true })) {
          const envelope = (msg as { envelope?: { messageId?: string } }).envelope;
          if (envelope?.messageId === messageId) {
            return true;
          }
        }
        return false;
      });
    } catch (err) {
      this.deps.logger?.debug({ folder, messageId, error: err }, 'Failed to search folder');
      return false;
    }
  }
}
