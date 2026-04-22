import type { ConfigRepository } from '../config/repository.js';
import type { Config } from '../config/schema.js';
import { saveConfig } from '../config/loader.js';
import type { SentinelStore } from './store.js';
import type { ImapClient } from '../imap/index.js';
import type { ActivityLog } from '../log/index.js';
import type { ScanReport, FoundInDifferentFolder, NotFound } from './scanner.js';
import type { FolderPurpose } from './format.js';
import { appendSentinel } from './imap-ops.js';
import type pino from 'pino';

// ── Types ─────────────────────────────────────────────────────────────────

export interface SentinelHealerDeps {
  configRepo: ConfigRepository;
  configPath: string;
  sentinelStore: SentinelStore;
  client: ImapClient;
  activityLog: ActivityLog;
  logger: pino.Logger;
}

// ── Main entry point ──────────────────────────────────────────────────────

export async function handleScanReport(report: ScanReport, deps: SentinelHealerDeps): Promise<void> {
  // Cache folder list for not-found checks (avoid repeated listMailboxes calls)
  let folderList: string[] | null = null;

  for (const result of report.results) {
    try {
      if (result.status === 'found-in-place') {
        continue;
      }

      if (result.status === 'found-in-different-folder') {
        handleRename(result, deps);
      }

      if (result.status === 'not-found') {
        if (folderList === null) {
          const mailboxes = await deps.client.listMailboxes();
          folderList = mailboxes.map((mb) => mb.path);
        }
        await handleNotFound(result, deps, folderList);
      }
    } catch (err) {
      deps.logger.error({ err, messageId: result.messageId }, 'Error processing scan result');
    }
  }
}

// ── Rename handler ────────────────────────────────────────────────────────

function handleRename(result: FoundInDifferentFolder, deps: SentinelHealerDeps): void {
  const oldPath = result.expectedFolder;
  const newPath = result.actualFolder;
  const config = deps.configRepo.getConfig();
  const affectedRules: string[] = [];

  // Update rules with matching action.folder
  for (const rule of config.rules) {
    if ((rule.action.type === 'move' || rule.action.type === 'review') &&
        'folder' in rule.action && rule.action.folder === oldPath) {
      (rule.action as { folder: string }).folder = newPath;
      affectedRules.push(rule.name ?? rule.id);
    }
  }

  // Update review.folder
  if (config.review.folder === oldPath) {
    config.review.folder = newPath;
  }

  // Update review.defaultArchiveFolder
  if (config.review.defaultArchiveFolder === oldPath) {
    config.review.defaultArchiveFolder = newPath;
  }

  // Update action folder entries
  if (config.actionFolders.enabled) {
    const prefix = config.actionFolders.prefix;

    // Check if the prefix itself was renamed
    if (oldPath === prefix) {
      config.actionFolders.prefix = newPath;
    } else {
      // Check individual action folder paths
      const folders = config.actionFolders.folders as Record<string, string>;
      for (const key of Object.keys(folders)) {
        const fullPath = `${prefix}/${folders[key]}`;
        if (fullPath === oldPath) {
          // Extract new leaf name from newPath
          if (newPath.startsWith(prefix + '/')) {
            folders[key] = newPath.slice(prefix.length + 1);
          } else {
            folders[key] = newPath;
          }
        }
      }
    }
  }

  // Persist via saveConfig (not ConfigRepository methods) -- D-02
  saveConfig(deps.configPath, config);

  // Update sentinel store mapping -- D-03
  deps.sentinelStore.updateFolderPath(result.messageId, newPath);

  // Log to activity -- D-13
  deps.activityLog.logSentinelEvent({
    action: 'rename-healed',
    folder: newPath,
    details: JSON.stringify({ oldPath, newPath, affectedRules }),
  });

  deps.logger.info({ oldPath, newPath, affectedRules }, 'Folder rename healed');
}

// ── Not-found handler ─────────────────────────────────────────────────────

async function handleNotFound(
  result: NotFound,
  deps: SentinelHealerDeps,
  folderList: string[],
): Promise<void> {
  // Check if sentinel mapping still exists (dedup for subsequent scans -- D-06)
  const existing = deps.sentinelStore.getByMessageId(result.messageId);
  if (!existing) {
    return; // Already handled in a previous scan
  }

  const folderExists = folderList.some((p) => p === result.expectedFolder);

  if (folderExists) {
    // Folder exists but sentinel is missing -- replant
    await handleReplant(result, deps);
  } else {
    // Folder is gone -- handle folder loss (Task 2 will fill this in)
    await handleFolderLoss(result, deps);
  }
}

// ── Replant handler ───────────────────────────────────────────────────────

async function handleReplant(result: NotFound, deps: SentinelHealerDeps): Promise<void> {
  // Remove old mapping
  deps.sentinelStore.deleteByMessageId(result.messageId);

  // Plant new sentinel
  await appendSentinel(
    deps.client,
    result.expectedFolder,
    result.folderPurpose as FolderPurpose,
    deps.sentinelStore,
  );

  // Log to activity -- D-12
  deps.activityLog.logSentinelEvent({
    action: 'sentinel-replanted',
    folder: result.expectedFolder,
    details: 'Sentinel was missing but folder exists; replanted',
  });

  deps.logger.info({ folder: result.expectedFolder }, 'Sentinel replanted');
}

// ── Folder loss handler (stub for Task 2) ─────────────────────────────────

async function handleFolderLoss(result: NotFound, deps: SentinelHealerDeps): Promise<void> {
  // Will be implemented in Task 2
  deps.logger.warn({ folder: result.expectedFolder }, 'Folder lost -- handler not yet implemented');
}

// ── Sync callback wrapper ─────────────────────────────────────────────────

export function createScanCompleteHandler(deps: SentinelHealerDeps): (report: ScanReport) => void {
  return (report: ScanReport) => {
    handleScanReport(report, deps).catch((err) => {
      deps.logger.error({ err }, 'Sentinel healer failed');
    });
  };
}
