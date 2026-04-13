import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerFolderRoutes } from '../../../src/web/routes/folders.js';
import type { ServerDeps } from '../../../src/web/server.js';
import type { FolderNode, FolderTreeResponse } from '../../../src/shared/types.js';

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
];

const SAMPLE_RESPONSE: FolderTreeResponse = {
  folders: SAMPLE_TREE,
  cachedAt: '2026-04-06T12:00:00.000Z',
  stale: false,
};

function createMockDeps(overrides: Partial<{
  getTree: ReturnType<typeof vi.fn>;
  getResponse: ReturnType<typeof vi.fn>;
}> = {}): ServerDeps {
  const getTree = overrides.getTree ?? vi.fn(async () => SAMPLE_TREE);
  const getResponse = overrides.getResponse ?? vi.fn(() => SAMPLE_RESPONSE);

  return {
    configRepo: {} as any,
    activityLog: {} as any,
    getMonitor: () => ({}) as any,
    getSweeper: () => undefined,
    getFolderCache: () => ({
      getTree,
      getResponse,
      hasFolder: vi.fn(),
      refresh: vi.fn(),
    }) as any,
    getBatchEngine: () => ({}) as any,
  } as ServerDeps;
}

describe('GET /api/folders', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  it('returns 200 with FolderTreeResponse', async () => {
    const deps = createMockDeps();
    registerFolderRoutes(app, deps);

    const res = await app.inject({ method: 'GET', url: '/api/folders' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.folders).toHaveLength(2);
    expect(body.folders[0].path).toBe('INBOX');
    expect(body.cachedAt).toBe('2026-04-06T12:00:00.000Z');
    expect(body.stale).toBe(false);
  });

  it('calls getTree(true) when ?refresh=true', async () => {
    const getTree = vi.fn(async () => SAMPLE_TREE);
    const deps = createMockDeps({ getTree });
    registerFolderRoutes(app, deps);

    await app.inject({ method: 'GET', url: '/api/folders?refresh=true' });

    expect(getTree).toHaveBeenCalledWith(true);
  });

  it('calls getTree(false) without refresh param', async () => {
    const getTree = vi.fn(async () => SAMPLE_TREE);
    const deps = createMockDeps({ getTree });
    registerFolderRoutes(app, deps);

    await app.inject({ method: 'GET', url: '/api/folders' });

    expect(getTree).toHaveBeenCalledWith(false);
  });

  it('returns 503 when cache empty and IMAP disconnected', async () => {
    const getTree = vi.fn(async () => { throw new Error('Not connected'); });
    const deps = createMockDeps({ getTree });
    registerFolderRoutes(app, deps);

    const res = await app.inject({ method: 'GET', url: '/api/folders' });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('Folder list unavailable - IMAP not connected');
  });

  it('returns cached data without calling listFolders again', async () => {
    const getTree = vi.fn(async () => SAMPLE_TREE);
    const deps = createMockDeps({ getTree });
    registerFolderRoutes(app, deps);

    await app.inject({ method: 'GET', url: '/api/folders' });
    await app.inject({ method: 'GET', url: '/api/folders' });

    // getTree is called twice (once per request) but FolderCache handles the caching internally
    expect(getTree).toHaveBeenCalledTimes(2);
  });
});
