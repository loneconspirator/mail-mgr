import type { FolderPurpose } from './format.js';
import type { Config } from '../config/schema.js';

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
