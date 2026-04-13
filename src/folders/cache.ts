import type { ImapClient } from '../imap/index.js';
import type { FolderNode, FolderTreeResponse } from '../shared/types.js';

export interface FolderCacheDeps {
  imapClient: ImapClient;
  ttlMs: number;
}

export class FolderCache {
  private tree: FolderNode[] | null = null;
  private lastFetched: number = 0;
  private readonly deps: FolderCacheDeps;

  constructor(deps: FolderCacheDeps) {
    this.deps = deps;
  }

  /** Return cached folder tree, refreshing if stale or forced. */
  async getTree(forceRefresh?: boolean): Promise<FolderNode[]> {
    if (!forceRefresh && this.tree && !this.isStale()) {
      return this.tree;
    }
    return this.refresh();
  }

  /** Force a fresh fetch from IMAP and update cache. */
  async refresh(): Promise<FolderNode[]> {
    try {
      this.tree = await this.deps.imapClient.listFolders();
      this.lastFetched = Date.now();
      return this.tree;
    } catch (err) {
      // If cache exists, return stale data on error
      if (this.tree) {
        return this.tree;
      }
      throw err;
    }
  }

  /** Check whether a folder path exists in the cached tree. */
  hasFolder(path: string): boolean {
    if (!this.tree) return false;
    return this.searchTree(this.tree, path);
  }

  /** Build the API response shape from cached state. */
  getResponse(): FolderTreeResponse {
    return {
      folders: this.tree ?? [],
      cachedAt: new Date(this.lastFetched).toISOString(),
      stale: this.isStale(),
    };
  }

  private isStale(): boolean {
    return this.tree === null || Date.now() - this.lastFetched >= this.deps.ttlMs;
  }

  private searchTree(nodes: FolderNode[], target: string): boolean {
    for (const node of nodes) {
      // Case-insensitive comparison for INBOX only
      if (target.toLowerCase() === 'inbox' || node.path.toLowerCase() === 'inbox') {
        if (node.path.toLowerCase() === target.toLowerCase()) return true;
      } else {
        if (node.path === target) return true;
      }
      if (this.searchTree(node.children, target)) return true;
    }
    return false;
  }
}
