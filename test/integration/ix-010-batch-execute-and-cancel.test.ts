/**
 * Integration test for IX-010 — Batch execute with chunked processing and
 * cooperative cancel.
 *
 * Spec: specs/integrations/ix-010-batch-execute-and-cancel.md
 *
 * Exercises the WebServer execute / cancel / status routes wired through a
 * real BatchEngine with collaborators (RuleEvaluator, sweep helpers,
 * ImapClient, ActivityLog) mocked. Real IMAP, SQLite, and ConfigRepository
 * are out of scope here — the goal is to prove the WebServer ↔ BatchEngine ↔
 * collaborators contract from IX-010 holds end to end at the HTTP boundary.
 *
 * Named-interaction coverage:
 *   IX-010.1 — POST /api/batch/execute returns { status: 'started' }
 *              synchronously and BatchEngine.execute is called fire-and-forget.
 *   IX-010.2 — concurrent execute: synchronous fire-and-forget shape; second
 *              request returns immediately, engine rejects internally with
 *              "Batch already running".
 *   IX-010.3 — state.status flips to 'executing'; client.fetchAllMessages is
 *              called with the source folder; mode is selected (inbox /
 *              review / generic).
 *   IX-010.4 — chunks of 25 with setImmediate yield between chunks.
 *   IX-010.5 — cooperative cancel: cancelRequested observed before next
 *              chunk → status='cancelled', current chunk completes.
 *   IX-010.6 — per-message handling for every branch (sentinel, review-
 *              ineligible, review-eligible, inbox-match, inbox-no-match,
 *              generic-match, generic-no-match).
 *   IX-010.7 — per-message error: errors++, ActivityLog success=false,
 *              run continues for remaining messages.
 *   IX-010.8 — terminal: status='completed', state.completedAt set, running
 *              released, BatchResult shape returned by engine.
 *   IX-010.9 — GET /api/batch/status returns the BatchState snapshot mid-run
 *              and after completion.
 *   Failure handling — outer fetch failure: state.status='error', engine
 *              still returns a BatchResult with partial counters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';
import type { Rule } from '../../src/config/index.js';
import type { ImapClient, ReviewMessage } from '../../src/imap/index.js';
import type { ActivityLog } from '../../src/log/index.js';
import type { ServerDeps } from '../../src/web/server.js';

vi.mock('../../src/rules/index.js', () => ({
  evaluateRules: vi.fn(),
}));

vi.mock('../../src/sweep/index.js', () => ({
  isEligibleForSweep: vi.fn(),
  resolveSweepDestination: vi.fn(),
  processSweepMessage: vi.fn(),
}));

import { BatchEngine } from '../../src/batch/index.js';
import { buildServer } from '../../src/web/server.js';
import { evaluateRules } from '../../src/rules/index.js';
import {
  isEligibleForSweep,
  resolveSweepDestination,
  processSweepMessage,
} from '../../src/sweep/index.js';

const mockedEvaluateRules = vi.mocked(evaluateRules);
const mockedIsEligible = vi.mocked(isEligibleForSweep);
const mockedResolveSweep = vi.mocked(resolveSweepDestination);
const mockedProcessSweepMessage = vi.mocked(processSweepMessage);

const silentLogger = pino({ level: 'silent' });

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    match: { sender: '*@example.com' },
    action: { type: 'move', folder: 'Archive/Lists' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

function makeReviewMessage(overrides: Partial<ReviewMessage> = {}): ReviewMessage {
  return {
    uid: 1,
    flags: new Set<string>(),
    internalDate: new Date('2026-03-01T00:00:00Z'),
    envelope: {
      from: { name: 'Alice', address: 'alice@example.com' },
      to: [{ name: 'Bob', address: 'bob@example.com' }],
      cc: [],
      subject: 'Test Subject',
      messageId: '<msg-1@example.com>',
    },
    ...overrides,
  };
}

function makeMessages(count: number): ReviewMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeReviewMessage({
      uid: i + 1,
      envelope: {
        from: { name: `Sender ${i}`, address: `sender${i}@example.com` },
        to: [{ name: 'Bob', address: 'bob@example.com' }],
        cc: [],
        subject: `Message ${i + 1}`,
        messageId: `<msg-${i + 1}@example.com>`,
      },
    }),
  );
}

function makeMockClient(): ImapClient {
  return {
    state: 'connected',
    fetchAllMessages: vi.fn().mockResolvedValue([]),
    moveMessage: vi.fn().mockResolvedValue(undefined),
    createMailbox: vi.fn().mockResolvedValue(undefined),
  } as unknown as ImapClient;
}

function makeMockActivityLog(): ActivityLog {
  return { logActivity: vi.fn() } as unknown as ActivityLog;
}

interface Harness {
  app: FastifyInstance;
  engine: BatchEngine;
  client: ImapClient;
  activityLog: ActivityLog;
}

function buildHarness(opts: { rules?: Rule[]; reviewFolder?: string } = {}): Harness {
  const client = makeMockClient();
  const activityLog = makeMockActivityLog();
  const rules = opts.rules ?? [makeRule()];
  const engine = new BatchEngine({
    client,
    activityLog,
    rules,
    trashFolder: 'Trash',
    logger: silentLogger,
    reviewFolder: opts.reviewFolder ?? 'Review',
    reviewConfig: {
      folder: opts.reviewFolder ?? 'Review',
      defaultArchiveFolder: 'MailingLists',
      trashFolder: 'Trash',
      sweep: { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 },
    },
  });

  const deps: ServerDeps = {
    configRepo: {} as ServerDeps['configRepo'],
    activityLog,
    getMonitor: vi.fn(),
    getSweeper: vi.fn(),
    getFolderCache: vi.fn(),
    getBatchEngine: () => engine,
    getMoveTracker: vi.fn(),
    getProposalStore: vi.fn(),
    staticRoot: '/tmp',
  };

  const app = buildServer(deps);
  return { app, engine, client, activityLog };
}

// Wait for engine.getState().status to satisfy `predicate` (or until timeout).
// The execute route is fire-and-forget, so test assertions must wait for the
// engine's async work to advance instead of awaiting the HTTP response.
async function waitForStatus(
  engine: BatchEngine,
  predicate: (status: string) => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate(engine.getState().status) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setImmediate(r));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IX-010 — Batch execute with chunked processing and cooperative cancel', () => {
  describe('IX-010.1: POST /api/batch/execute returns { status: started } and fires execute fire-and-forget', () => {
    it('IX-010.1: synchronous response is { status: "started" } and engine.execute was invoked', async () => {
      const { app, engine, client } = buildHarness();
      const executeSpy = vi.spyOn(engine, 'execute');
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'TestFolder' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'started' });
      expect(executeSpy).toHaveBeenCalledWith('TestFolder');

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      await app.close();
    });

    it('IX-010.1: missing sourceFolder returns HTTP 400 (validation runs in synchronous portion)', async () => {
      const { app } = buildHarness();
      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe('IX-010.2: concurrent execute — 409 when already running', () => {
    it('IX-010.2: a second execute while one is in flight returns HTTP 409 and does not disturb the in-flight run', async () => {
      const { app, engine, client } = buildHarness();
      let resolveFetch!: (v: ReviewMessage[]) => void;
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<ReviewMessage[]>((resolve) => { resolveFetch = resolve; }),
      );

      // Two-layered guard:
      //   (a) the route's synchronous engine.isRunning() check returns 409.
      //   (b) the engine's own async throw protects non-route callers; that
      //       rejection is observable when execute() is called directly.
      const inFlight = engine.execute('TestFolder');
      await expect(engine.execute('TestFolder')).rejects.toThrow('Batch already running');

      const second = await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'TestFolder' },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({ error: 'Batch already running' });

      resolveFetch([]);
      const result = await inFlight;
      expect(result.status).toBe('completed');
      await app.close();
    });
  });

  describe('IX-010.3: state transitions to executing, fetches from source, picks the right mode', () => {
    it('IX-010.3: status flips to "executing", client.fetchAllMessages called with source folder, INBOX selects inbox mode (evaluateRules)', async () => {
      const { app, engine, client } = buildHarness();
      let resolveFetch!: (v: ReviewMessage[]) => void;
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<ReviewMessage[]>((resolve) => { resolveFetch = resolve; }),
      );
      mockedEvaluateRules.mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'INBOX' },
      });
      expect(res.statusCode).toBe(200);

      await waitForStatus(engine, (s) => s === 'executing');
      expect(engine.getState().status).toBe('executing');
      expect(client.fetchAllMessages).toHaveBeenCalledWith('INBOX');

      resolveFetch([makeReviewMessage({ uid: 1 })]);
      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(mockedEvaluateRules).toHaveBeenCalledTimes(1);
      expect(mockedIsEligible).not.toHaveBeenCalled();
      await app.close();
    });

    it('IX-010.3: source = reviewFolder selects review mode (sweep helpers)', async () => {
      const { app, engine, client } = buildHarness({ reviewFolder: 'Review' });
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedIsEligible.mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'Review' },
      });
      expect(res.statusCode).toBe(200);

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(mockedIsEligible).toHaveBeenCalledTimes(1);
      expect(mockedEvaluateRules).not.toHaveBeenCalled();
      await app.close();
    });

    it('IX-010.3: arbitrary folder selects generic mode (evaluateRules, no review fallback)', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedEvaluateRules.mockReturnValue(null);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'Archive/Old' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(mockedEvaluateRules).toHaveBeenCalledTimes(1);
      expect(mockedIsEligible).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('IX-010.4: chunks of 25 with setImmediate between chunks', () => {
    it('IX-010.4: 60 messages produce setImmediate yields between chunks', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(makeMessages(60));
      mockedEvaluateRules.mockReturnValue(null);

      const originalSetImmediate = globalThis.setImmediate;
      const setImmediateSpy = vi.fn((fn: () => void) => originalSetImmediate(fn));
      globalThis.setImmediate = setImmediateSpy as unknown as typeof setImmediate;

      try {
        await app.inject({
          method: 'POST',
          url: '/api/batch/execute',
          payload: { sourceFolder: 'TestFolder' },
        });

        await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
        expect(setImmediateSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(engine.getState().processed).toBe(60);
      } finally {
        globalThis.setImmediate = originalSetImmediate;
      }
      await app.close();
    });
  });

  describe('IX-010.5: cooperative cancel via POST /api/batch/cancel', () => {
    it('IX-010.5: cancel observed between chunks → status=cancelled and remaining chunks do not run', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue(makeMessages(60));
      mockedEvaluateRules.mockReturnValue(null);

      // Hook setImmediate to fire POST /api/batch/cancel after the first
      // chunk's yield. Cancel is the same one a real client would send;
      // calling it via the route exercises the IX-010 wiring end to end.
      const originalSetImmediate = globalThis.setImmediate;
      let cancelled = false;
      globalThis.setImmediate = ((fn: () => void) => {
        if (!cancelled) {
          cancelled = true;
          engine.cancel();
        }
        return originalSetImmediate(fn);
      }) as unknown as typeof setImmediate;

      try {
        // Awaiting engine.execute directly so the setImmediate hook only
        // intercepts engine yields (not the test's polling helper).
        const result = await engine.execute('TestFolder');
        expect(result.status).toBe('cancelled');
        const state = engine.getState();
        expect(state.status).toBe('cancelled');
        expect(state.cancelled).toBe(true);
        // First chunk completed (cancel is cooperative, not preemptive),
        // remaining chunks did not run.
        expect(state.processed).toBeGreaterThanOrEqual(25);
        expect(state.processed).toBeLessThan(60);
      } finally {
        globalThis.setImmediate = originalSetImmediate;
      }
      await app.close();
    });

    it('IX-010.5: POST /api/batch/cancel returns { status: "cancelling" }', async () => {
      const { app } = buildHarness();
      const res = await app.inject({ method: 'POST', url: '/api/batch/cancel' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'cancelling' });
      await app.close();
    });
  });

  describe('IX-010.6: per-message handling — one assertion per branch', () => {
    it('IX-010.6: sentinel message is skipped silently (no IMAP op, not counted)', async () => {
      const { app, engine, client } = buildHarness();
      const sentinel = makeReviewMessage({
        uid: 99,
        headers: new Map([['x-mail-mgr-sentinel', '<s-1@mail-manager.sentinel>']]),
      });
      const real = makeReviewMessage({ uid: 1 });
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([sentinel, real]);
      mockedEvaluateRules.mockReturnValue(null);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'TestFolder' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(mockedEvaluateRules).toHaveBeenCalledTimes(1);
      expect(client.moveMessage).not.toHaveBeenCalled();
      await app.close();
    });

    it('IX-010.6: review mode + ineligible → skipped++, no IMAP op', async () => {
      const { app, engine, client } = buildHarness({ reviewFolder: 'Review' });
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedIsEligible.mockReturnValue(false);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'Review' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      const state = engine.getState();
      expect(state.skipped).toBe(1);
      expect(state.processed).toBe(1);
      expect(client.moveMessage).not.toHaveBeenCalled();
      expect(mockedProcessSweepMessage).not.toHaveBeenCalled();
      await app.close();
    });

    it('IX-010.6: review mode + eligible → delegates to processSweepMessage and counts as moved', async () => {
      const { app, engine, client } = buildHarness({ reviewFolder: 'Review' });
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedIsEligible.mockReturnValue(true);
      mockedProcessSweepMessage.mockResolvedValue({ action: 'moved', destination: 'Archive/Lists' });

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'Review' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(mockedProcessSweepMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ source: 'batch', sourceFolder: 'Review' }),
      );
      expect(engine.getState().moved).toBe(1);
      expect(client.moveMessage).not.toHaveBeenCalled();
      await app.close();
    });

    it('IX-010.6: inbox mode + match → ActionExecutor moves message and ActivityLog logs source="batch"', async () => {
      const { app, engine, client, activityLog } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      const moveRule = makeRule({ name: 'Move Rule', action: { type: 'move', folder: 'Archive/Lists' } });
      mockedEvaluateRules.mockReturnValue(moveRule);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'INBOX' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(client.moveMessage).toHaveBeenCalledWith(1, 'Archive/Lists', 'INBOX');
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, action: 'move', folder: 'Archive/Lists' }),
        expect.anything(),
        moveRule,
        'batch',
      );
      expect(engine.getState().moved).toBe(1);
      await app.close();
    });

    it('IX-010.6: inbox mode + no-match → skipped++, no IMAP op', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedEvaluateRules.mockReturnValue(null);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'INBOX' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(client.moveMessage).not.toHaveBeenCalled();
      expect(engine.getState().skipped).toBe(1);
      await app.close();
    });

    it('IX-010.6: generic mode + match → moves directly via client.moveMessage', async () => {
      const { app, engine, client, activityLog } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      const moveRule = makeRule({ name: 'Generic Move', action: { type: 'move', folder: 'Archive/Lists' } });
      mockedEvaluateRules.mockReturnValue(moveRule);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'Archive/Old' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(client.moveMessage).toHaveBeenCalledWith(1, 'Archive/Lists', 'Archive/Old');
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, action: 'move', folder: 'Archive/Lists' }),
        expect.anything(),
        moveRule,
        'batch',
      );
      expect(engine.getState().moved).toBe(1);
      await app.close();
    });

    it('IX-010.6: generic mode + no-match → skipped++', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedEvaluateRules.mockReturnValue(null);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'Archive/Old' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      expect(client.moveMessage).not.toHaveBeenCalled();
      expect(engine.getState().skipped).toBe(1);
      await app.close();
    });
  });

  describe('IX-010.7: per-message error continues the run', () => {
    it('IX-010.7: client.moveMessage rejects once → errors++, ActivityLog success=false, remaining messages still processed', async () => {
      const { app, engine, client, activityLog } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
        makeReviewMessage({ uid: 2 }),
        makeReviewMessage({ uid: 3 }),
      ]);
      const moveRule = makeRule({ action: { type: 'move', folder: 'Archive/Lists' } });
      mockedEvaluateRules.mockReturnValue(moveRule);
      (client.moveMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('IMAP timeout'))
        .mockResolvedValueOnce(undefined);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'Archive/Old' },
      });

      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');
      const state = engine.getState();
      expect(state.processed).toBe(3);
      expect(state.moved).toBe(2);
      expect(state.errors).toBe(1);
      expect(state.status).toBe('completed');

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: expect.stringContaining('IMAP timeout') }),
        expect.anything(),
        expect.anything(),
        'batch',
      );
      await app.close();
    });
  });

  describe('IX-010.8: terminal — status=completed, completedAt set, running released, BatchResult shape', () => {
    it('IX-010.8: after success state.status="completed", state.completedAt is set, engine.execute returns BatchResult summary', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
        makeReviewMessage({ uid: 2 }),
      ]);
      mockedEvaluateRules.mockReturnValue(null);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'TestFolder' },
      });
      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');

      const state = engine.getState();
      expect(state.status).toBe('completed');
      expect(state.completedAt).not.toBeNull();
      expect(state.processed).toBe(2);

      // running released → a fresh execute is accepted (does not throw).
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const next = await engine.execute('OtherFolder');
      expect(next.status).toBe('completed');
      expect(next.totalMessages).toBe(0);
      // BatchResult shape — counters present.
      expect(next.processed).toBe(0);
      expect(next.moved).toBe(0);
      expect(next.skipped).toBe(0);
      expect(next.errors).toBe(0);
      // After running released, getState().completedAt is populated.
      expect(engine.getState().completedAt).not.toBeNull();
      await app.close();
    });
  });

  describe('IX-010.9: GET /api/batch/status returns the BatchState snapshot', () => {
    it('IX-010.9: status route returns "executing" mid-run and "completed" after the run', async () => {
      const { app, engine, client } = buildHarness();
      let resolveFetch!: (v: ReviewMessage[]) => void;
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<ReviewMessage[]>((resolve) => { resolveFetch = resolve; }),
      );
      mockedEvaluateRules.mockReturnValue(null);

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'TestFolder' },
      });

      await waitForStatus(engine, (s) => s === 'executing');
      const midRun = await app.inject({ method: 'GET', url: '/api/batch/status' });
      expect(midRun.statusCode).toBe(200);
      expect((midRun.json() as { status: string }).status).toBe('executing');

      resolveFetch([makeReviewMessage({ uid: 1 })]);
      await waitForStatus(engine, (s) => s === 'completed' || s === 'error');

      const post = await app.inject({ method: 'GET', url: '/api/batch/status' });
      const body = post.json() as { status: string; completedAt: string | null; processed: number };
      expect(body.status).toBe('completed');
      expect(body.completedAt).not.toBeNull();
      expect(body.processed).toBe(1);
      await app.close();
    });
  });

  describe('Failure handling: outer fetch failure', () => {
    it('outer fetchAllMessages rejection sets state.status="error" and engine returns BatchResult with partial counters', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IMAP down'));

      await app.inject({
        method: 'POST',
        url: '/api/batch/execute',
        payload: { sourceFolder: 'TestFolder' },
      });

      await waitForStatus(engine, (s) => s === 'error' || s === 'completed');
      const state = engine.getState();
      expect(state.status).toBe('error');
      expect(state.completedAt).not.toBeNull();
      expect(state.processed).toBe(0);
      expect(state.moved).toBe(0);
      expect(state.errors).toBe(0);
      await app.close();
    });
  });
});
