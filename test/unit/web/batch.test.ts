import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerBatchRoutes } from '../../../src/web/routes/batch.js';
import type { ServerDeps } from '../../../src/web/server.js';

function makeMockEngine() {
  return {
    dryRun: vi.fn(),
    execute: vi.fn(),
    cancel: vi.fn(),
    getState: vi.fn(),
    updateRules: vi.fn(),
  };
}

let app: FastifyInstance;
let mockEngine: ReturnType<typeof makeMockEngine>;

function buildApp(): FastifyInstance {
  mockEngine = makeMockEngine();
  const deps = {
    getBatchEngine: () => mockEngine,
  } as unknown as ServerDeps;

  const fastify = Fastify({ logger: false });
  registerBatchRoutes(fastify, deps);
  return fastify;
}

beforeEach(() => {
  app = buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/batch/dry-run', () => {
  it('calls engine.dryRun with sourceFolder and returns results', async () => {
    const groups = [
      { destination: 'Archive', action: 'move', count: 3, messages: [] },
    ];
    mockEngine.dryRun.mockResolvedValue(groups);

    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/dry-run',
      payload: { sourceFolder: 'INBOX' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ results: groups });
    expect(mockEngine.dryRun).toHaveBeenCalledWith('INBOX');
  });

  it('returns 400 for empty sourceFolder', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/dry-run',
      payload: { sourceFolder: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload)).toHaveProperty('error');
  });

  it('returns 400 for missing sourceFolder', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/dry-run',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/batch/execute', () => {
  it('calls engine.execute fire-and-forget and returns started', async () => {
    mockEngine.execute.mockResolvedValue({ status: 'completed' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/execute',
      payload: { sourceFolder: 'INBOX' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'started' });
    expect(mockEngine.execute).toHaveBeenCalledWith('INBOX');
  });

  it('returns 200 { status: "started" } even when engine.execute rejects with "Batch already running"', async () => {
    // engine.execute is async; concurrent-run errors surface as a rejected
    // promise that the route's fire-and-forget .catch logs. There is no
    // synchronous throw the route can map to HTTP 409, so the client always
    // sees 200. Clients detect the in-flight run via GET /api/batch/status.
    mockEngine.execute.mockRejectedValue(new Error('Batch already running'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/execute',
      payload: { sourceFolder: 'INBOX' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'started' });
  });

  it('returns 400 for empty sourceFolder', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/execute',
      payload: { sourceFolder: '' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/batch/cancel', () => {
  it('calls engine.cancel and returns cancelling', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'cancelling' });
    expect(mockEngine.cancel).toHaveBeenCalled();
  });
});

describe('GET /api/batch/status', () => {
  it('returns engine state', async () => {
    const state = {
      status: 'idle',
      sourceFolder: null,
      totalMessages: 0,
      processed: 0,
      moved: 0,
      skipped: 0,
      errors: 0,
      cancelled: false,
      dryRunResults: null,
      completedAt: null,
    };
    mockEngine.getState.mockReturnValue(state);

    const res = await app.inject({
      method: 'GET',
      url: '/api/batch/status',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual(state);
    expect(mockEngine.getState).toHaveBeenCalled();
  });
});

describe('POST /api/batch/dry-run conflict', () => {
  it('returns 409 when batch is already running', async () => {
    mockEngine.dryRun.mockRejectedValue(new Error('Batch already running'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/dry-run',
      payload: { sourceFolder: 'INBOX' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload)).toEqual({ error: 'Batch already running' });
  });
});
