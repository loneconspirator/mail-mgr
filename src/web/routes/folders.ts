import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import type { FolderNode } from '../../shared/types.js';

function findNode(nodes: FolderNode[], path: string): FolderNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findNode(node.children, path);
    if (found) return found;
  }
  return null;
}

export function registerFolderRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/folders', async (request, reply) => {
    const query = request.query as { refresh?: string };
    const forceRefresh = query.refresh === 'true';
    try {
      const cache = deps.getFolderCache();
      await cache.getTree(forceRefresh);
      return cache.getResponse();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return reply.status(503).send({ error: 'Folder list unavailable - IMAP not connected' });
    }
  });

  app.post('/api/folders/rename', async (request, reply) => {
    const { oldPath, newPath } = request.body as { oldPath?: string; newPath?: string };

    // Validate required fields
    if (!oldPath || !newPath) {
      return reply.status(400).send({ error: 'oldPath and newPath are required' });
    }

    // Validate newPath constraints: no control chars, not empty after trim, max 255 chars
    if (newPath.trim().length === 0) {
      return reply.status(400).send({ error: 'New name cannot be empty' });
    }
    if (newPath.length > 255) {
      return reply.status(400).send({ error: 'New name cannot exceed 255 characters' });
    }
    if (/[\x00-\x1f\x7f]/.test(newPath)) {
      return reply.status(400).send({ error: 'New name cannot contain control characters' });
    }

    // Get folder tree to find delimiter
    const cache = deps.getFolderCache();
    const tree = await cache.getTree();
    const selectedNode = findNode(tree, oldPath);
    const delimiter = selectedNode?.delimiter || (oldPath.includes('.') ? '.' : '/');

    // Validate newPath is a leaf name only (no delimiters, no path traversal)
    if (newPath.includes(delimiter) || newPath.includes('..')) {
      return reply.status(400).send({ error: 'New name cannot contain path separators or ".."' });
    }

    // Block INBOX rename (per D-04)
    if (oldPath.toLowerCase() === 'inbox') {
      return reply.status(403).send({ error: 'INBOX cannot be renamed' });
    }

    // Block Actions/ prefix rename (per D-04)
    const actionPrefix = deps.configRepo.getActionFolderConfig().prefix || 'Actions';
    if (oldPath === actionPrefix || oldPath.startsWith(actionPrefix + delimiter)) {
      return reply.status(403).send({ error: 'System folders cannot be renamed' });
    }

    // Build full new path by replacing leaf segment
    const parts = oldPath.split(delimiter);
    parts[parts.length - 1] = newPath;
    const fullNewPath = parts.join(delimiter);

    // Collision detection (per D-08)
    if (cache.hasFolder(fullNewPath)) {
      return reply.status(409).send({ error: `A folder named "${newPath}" already exists in this location` });
    }

    // Execute rename
    try {
      await cache.renameFolder(oldPath, fullNewPath);
      return { success: true, newPath: fullNewPath };
    } catch (err) {
      // D-07: refresh cache even on failure
      try { await cache.getTree(true); } catch { /* best effort */ }
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: `Rename failed: ${message}` });
    }
  });
}
