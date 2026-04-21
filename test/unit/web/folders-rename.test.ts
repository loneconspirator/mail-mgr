import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerFolderRoutes } from '../../../src/web/routes/folders.js';
import type { ServerDeps } from '../../../src/web/server.js';
import type { FolderNode } from '../../../src/shared/types.js';

const SAMPLE_TREE: FolderNode[] = [
  {
    path: 'INBOX',
    name: 'INBOX',
    delimiter: '/',
    flags: ['\\HasNoChildren'],
    specialUse: '\\Inbox',
    children: [],
  },
  {
    path: 'Archive',
    name: 'Archive',
    delimiter: '/',
    flags: ['\\HasChildren'],
    children: [
      {
        path: 'Archive/2024',
        name: '2024',
        delimiter: '/',
        flags: [],
        children: [],
      },
    ],
  },
  {
    path: 'Actions',
    name: 'Actions',
    delimiter: '/',
    flags: [],
    children: [
      {
        path: 'Actions/Delete',
        name: 'Delete',
        delimiter: '/',
        flags: [],
        children: [],
      },
    ],
  },
  {
    path: 'Work',
    name: 'Work',
    delimiter: '/',
    flags: [],
    children: [],
  },
];

function createMockDeps(overrides: {
  hasFolder?: (path: string) => boolean;
  renameFolder?: (old: string, nw: string) => Promise<void>;
} = {}): ServerDeps {
  const hasFolder = overrides.hasFolder ?? vi.fn(() => false);
  const renameFolder = overrides.renameFolder ?? vi.fn(async () => {});

  return {
    configRepo: {
      getActionFolderConfig: () => ({ prefix: 'Actions', enabled: true, folders: {} }),
    } as any,
    activityLog: {} as any,
    getMonitor: () => ({}) as any,
    getSweeper: () => undefined,
    getFolderCache: () => ({
      getTree: vi.fn(async () => SAMPLE_TREE),
      getResponse: vi.fn(() => ({ folders: SAMPLE_TREE, cachedAt: new Date().toISOString(), stale: false })),
      hasFolder,
      renameFolder,
      refresh: vi.fn(async () => SAMPLE_TREE),
    }) as any,
    getBatchEngine: () => ({}) as any,
    getMoveTracker: () => undefined,
    getProposalStore: () => ({}) as any,
  } as ServerDeps;
}

describe('POST /api/folders/rename', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  it('returns 400 if oldPath or newPath missing from body', async () => {
    const deps = createMockDeps();
    registerFolderRoutes(app, deps);

    const res1 = await app.inject({ method: 'POST', url: '/api/folders/rename', payload: { oldPath: 'Work' } });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().error).toMatch(/required/i);

    const res2 = await app.inject({ method: 'POST', url: '/api/folders/rename', payload: { newPath: 'NewName' } });
    expect(res2.statusCode).toBe(400);

    const res3 = await app.inject({ method: 'POST', url: '/api/folders/rename', payload: {} });
    expect(res3.statusCode).toBe(400);
  });

  it('returns 400 if newPath contains path delimiter (path traversal prevention)', async () => {
    const deps = createMockDeps();
    registerFolderRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Work', newPath: 'Evil/Path' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/separator/i);
  });

  it('returns 400 if newPath contains control characters or is empty or exceeds 255 chars', async () => {
    const deps = createMockDeps();
    registerFolderRoutes(app, deps);

    // Empty
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Work', newPath: '   ' },
    });
    expect(res1.statusCode).toBe(400);

    // Too long
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Work', newPath: 'x'.repeat(256) },
    });
    expect(res2.statusCode).toBe(400);

    // Control chars
    const res3 = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Work', newPath: 'bad\x01name' },
    });
    expect(res3.statusCode).toBe(400);
    expect(res3.json().error).toMatch(/control/i);
  });

  it('returns 403 if oldPath is "INBOX" (case-insensitive)', async () => {
    const deps = createMockDeps();
    registerFolderRoutes(app, deps);

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'INBOX', newPath: 'MyInbox' },
    });
    expect(res1.statusCode).toBe(403);
    expect(res1.json().error).toMatch(/INBOX/i);

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'inbox', newPath: 'MyInbox' },
    });
    expect(res2.statusCode).toBe(403);
  });

  it('returns 403 if oldPath starts with configured action folder prefix', async () => {
    const deps = createMockDeps();
    registerFolderRoutes(app, deps);

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Actions', newPath: 'MyActions' },
    });
    expect(res1.statusCode).toBe(403);
    expect(res1.json().error).toMatch(/system/i);

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Actions/Delete', newPath: 'Remove' },
    });
    expect(res2.statusCode).toBe(403);
  });

  it('returns 409 if newPath already exists in folder cache (collision)', async () => {
    const deps = createMockDeps({
      hasFolder: (path: string) => path === 'Archive',
    });
    registerFolderRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Work', newPath: 'Archive' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/exists/i);
  });

  it('returns 200 and calls cache.renameFolder on valid input', async () => {
    const renameFolder = vi.fn(async () => {});
    const deps = createMockDeps({ renameFolder });
    registerFolderRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Work', newPath: 'Personal' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().newPath).toBe('Personal');
    expect(renameFolder).toHaveBeenCalledWith('Work', 'Personal');
  });

  it('returns 500 with error message if IMAP rename fails', async () => {
    const renameFolder = vi.fn(async () => { throw new Error('IMAP server error'); });
    const deps = createMockDeps({ renameFolder });
    registerFolderRoutes(app, deps);

    const res = await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Work', newPath: 'Personal' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/IMAP server error/);
  });

  it('refreshes cache after rename failure per D-07', async () => {
    const getTree = vi.fn(async () => SAMPLE_TREE);
    const renameFolder = vi.fn(async () => { throw new Error('fail'); });
    const mockCache = {
      getTree,
      getResponse: vi.fn(),
      hasFolder: vi.fn(() => false),
      renameFolder,
      refresh: vi.fn(async () => SAMPLE_TREE),
    };

    const deps = {
      configRepo: {
        getActionFolderConfig: () => ({ prefix: 'Actions', enabled: true, folders: {} }),
      } as any,
      activityLog: {} as any,
      getMonitor: () => ({}) as any,
      getSweeper: () => undefined,
      getFolderCache: () => mockCache as any,
      getBatchEngine: () => ({}) as any,
      getMoveTracker: () => undefined,
      getProposalStore: () => ({}) as any,
    } as ServerDeps;

    registerFolderRoutes(app, deps);

    await app.inject({
      method: 'POST',
      url: '/api/folders/rename',
      payload: { oldPath: 'Work', newPath: 'Personal' },
    });

    // getTree called: once for initial tree lookup, once for force-refresh on error
    expect(getTree).toHaveBeenCalledTimes(2);
    expect(getTree).toHaveBeenLastCalledWith(true);
  });
});
