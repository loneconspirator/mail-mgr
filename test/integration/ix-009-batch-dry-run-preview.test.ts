/**
 * Integration test for IX-009 — Batch dry-run preview of retroactive rule
 * application.
 *
 * Spec: specs/integrations/ix-009-batch-dry-run-preview.md
 *
 * This file exercises the WebServer dry-run route wired through a real
 * BatchEngine, with the engine's collaborators (RuleEvaluator, sweep helpers,
 * ImapClient) mocked. Real IMAP, SQLite, and ConfigRepository are out of
 * scope here — the goal is to prove the WebServer ↔ BatchEngine ↔ collaborators
 * contract from IX-009 holds end to end at the HTTP boundary, not to re-test
 * IMAP plumbing already covered by lower-level suites.
 *
 * Named-interaction coverage:
 *   IX-009.1 — POST /api/batch/dry-run validates body and calls
 *              BatchEngine.dryRun(sourceFolder); 400 on validation failure.
 *   IX-009.2 — concurrent run rejected with HTTP 409.
 *   IX-009.3 — engine sets state.status='dry-running' during the run and
 *              calls client.fetchAllMessages(sourceFolder).
 *   IX-009.4 — mode selection by source folder: INBOX → inbox (evaluateRules),
 *              Review → review (sweep helpers), other → generic.
 *   IX-009.5 — sentinel messages are skipped silently (header guard).
 *   IX-009.6 — inbox/generic mode buckets unmatched messages under no-match.
 *   IX-009.7 — review mode: ineligible → "Not yet eligible" / skip; eligible →
 *              resolveSweepDestination with defaultArchiveFolder fallback.
 *   IX-009.8 — results are grouped by {action, destination} into
 *              DryRunGroup[] with count and example messages.
 *   IX-009.9 — after success state.status='previewing', state.dryRunResults
 *              populated, route returns { results: groups }.
 *   Failure handling — IMAP fetch failure surfaces as HTTP 500.
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
import { isEligibleForSweep, resolveSweepDestination } from '../../src/sweep/index.js';

const mockedEvaluateRules = vi.mocked(evaluateRules);
const mockedIsEligible = vi.mocked(isEligibleForSweep);
const mockedResolveSweep = vi.mocked(resolveSweepDestination);

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
  rules: Rule[];
}

function buildHarness(opts: { rules?: Rule[]; reviewFolder?: string } = {}): Harness {
  const client = makeMockClient();
  const rules = opts.rules ?? [makeRule()];
  const engine = new BatchEngine({
    client,
    activityLog: makeMockActivityLog(),
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

  // Mock-only: routes other than /api/batch/* are not exercised here, but
  // buildServer registers all of them and they read deps lazily via getters.
  const deps: ServerDeps = {
    configRepo: {} as ServerDeps['configRepo'],
    activityLog: makeMockActivityLog(),
    getMonitor: vi.fn(),
    getSweeper: vi.fn(),
    getFolderCache: vi.fn(),
    getBatchEngine: () => engine,
    getMoveTracker: vi.fn(),
    getProposalStore: vi.fn(),
    staticRoot: '/tmp',
  };

  const app = buildServer(deps);
  return { app, engine, client, rules };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IX-009 — Batch dry-run preview of retroactive rule application', () => {
  describe('IX-009.1: POST /api/batch/dry-run validates body and invokes BatchEngine.dryRun', () => {
    it('IX-009.1: valid body triggers BatchEngine.dryRun(sourceFolder) and returns 200', async () => {
      const { app, engine, client } = buildHarness();
      const dryRunSpy = vi.spyOn(engine, 'dryRun');
      mockedEvaluateRules.mockReturnValue(null);
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });

      expect(res.statusCode).toBe(200);
      expect(dryRunSpy).toHaveBeenCalledWith('TestFolder');
      await app.close();
    });

    it('IX-009.1: missing sourceFolder returns HTTP 400', async () => {
      const { app } = buildHarness();

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('IX-009.1: empty sourceFolder returns HTTP 400', async () => {
      const { app } = buildHarness();

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: '' },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe('IX-009.2: concurrent run returns HTTP 409', () => {
    it('IX-009.2: a second dry-run while one is in flight returns 409', async () => {
      const { app, client } = buildHarness();
      let resolveFetch!: (value: ReviewMessage[]) => void;
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<ReviewMessage[]>((resolve) => { resolveFetch = resolve; }),
      );
      mockedEvaluateRules.mockReturnValue(null);

      const first = app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });
      // Yield so the first request enters the engine and flips `running`.
      await new Promise((r) => setImmediate(r));

      const second = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });

      expect(second.statusCode).toBe(409);

      resolveFetch([]);
      await first;
      await app.close();
    });
  });

  describe('IX-009.3: state.status=dry-running during run; client.fetchAllMessages called', () => {
    it('IX-009.3: status flips to dry-running while messages are being fetched', async () => {
      const { app, engine, client } = buildHarness();
      const resolvers: Array<(value: ReviewMessage[]) => void> = [];
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<ReviewMessage[]>((resolve) => { resolvers.push(resolve); }),
      );
      mockedEvaluateRules.mockReturnValue(null);

      const inFlight = app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });

      // Wait until BatchEngine has progressed past the status flip and into
      // the awaiting fetchAllMessages call. The route handler is async, so we
      // poll rather than relying on a fixed number of microtask flushes.
      const start = Date.now();
      while (resolvers.length === 0 && Date.now() - start < 1000) {
        await new Promise((r) => setImmediate(r));
      }
      const observed = engine.getState().status;

      for (const resolve of resolvers) resolve([]);
      await inFlight;

      expect(observed).toBe('dry-running');
      expect(client.fetchAllMessages).toHaveBeenCalledWith('TestFolder');
      await app.close();
    });
  });

  describe('IX-009.4: mode selection by source folder', () => {
    it('IX-009.4: INBOX → inbox mode (uses evaluateRules)', async () => {
      const { app, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedEvaluateRules.mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'INBOX' },
      });

      expect(res.statusCode).toBe(200);
      expect(mockedEvaluateRules).toHaveBeenCalledTimes(1);
      expect(mockedIsEligible).not.toHaveBeenCalled();
      await app.close();
    });

    it('IX-009.4: Review folder → review mode (uses isEligibleForSweep / resolveSweepDestination)', async () => {
      const { app, client } = buildHarness({ reviewFolder: 'Review' });
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedIsEligible.mockReturnValue(true);
      mockedResolveSweep.mockReturnValue({
        destination: { type: 'move', folder: 'Archive/Lists' },
        matchedRule: makeRule(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'Review' },
      });

      expect(res.statusCode).toBe(200);
      expect(mockedIsEligible).toHaveBeenCalledTimes(1);
      expect(mockedResolveSweep).toHaveBeenCalledTimes(1);
      expect(mockedEvaluateRules).not.toHaveBeenCalled();
      await app.close();
    });

    it('IX-009.4: arbitrary folder → generic mode (uses evaluateRules, no review fallback)', async () => {
      const { app, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedEvaluateRules.mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'Archive/Old' },
      });

      expect(res.statusCode).toBe(200);
      expect(mockedEvaluateRules).toHaveBeenCalledTimes(1);
      expect(mockedIsEligible).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('IX-009.5: sentinel messages are silently skipped', () => {
    it('IX-009.5: a message with x-mail-mgr-sentinel header does not appear in groups and is not evaluated', async () => {
      const { app, client } = buildHarness();
      const sentinel = makeReviewMessage({
        uid: 99,
        headers: new Map([['x-mail-mgr-sentinel', '<s-1@mail-manager.sentinel>']]),
      });
      const real = makeReviewMessage({ uid: 1 });
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([sentinel, real]);
      mockedEvaluateRules.mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ count: number }> };
      const total = body.results.reduce((sum, g) => sum + g.count, 0);
      expect(total).toBe(1);
      // Sentinel was guarded before evaluateRules ran for it.
      expect(mockedEvaluateRules).toHaveBeenCalledTimes(1);
      await app.close();
    });
  });

  describe('IX-009.6: inbox/generic mode buckets unmatched messages under no-match', () => {
    it('IX-009.6: unmatched messages bucket as action=no-match, destination="No match"', async () => {
      const { app, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
        makeReviewMessage({ uid: 2 }),
      ]);
      mockedEvaluateRules.mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ action: string; destination: string; count: number }> };
      const noMatch = body.results.find((g) => g.action === 'no-match');
      expect(noMatch).toBeDefined();
      expect(noMatch!.destination).toBe('No match');
      expect(noMatch!.count).toBe(2);
      await app.close();
    });
  });

  describe('IX-009.7: review mode bucketing — ineligible vs eligible', () => {
    it('IX-009.7: ineligible messages bucket as skip with destination "Not yet eligible"', async () => {
      const { app, client } = buildHarness({ reviewFolder: 'Review' });
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedIsEligible.mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'Review' },
      });

      const body = res.json() as { results: Array<{ action: string; destination: string }> };
      expect(body.results[0].action).toBe('skip');
      expect(body.results[0].destination).toBe('Not yet eligible');
      // Ineligible never reaches resolveSweepDestination.
      expect(mockedResolveSweep).not.toHaveBeenCalled();
      await app.close();
    });

    it('IX-009.7: eligible messages flow through resolveSweepDestination with defaultArchiveFolder fallback', async () => {
      const { app, client } = buildHarness({ reviewFolder: 'Review' });
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedIsEligible.mockReturnValue(true);
      mockedResolveSweep.mockReturnValue({
        destination: { type: 'move', folder: 'MailingLists' },
        matchedRule: null,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'Review' },
      });

      expect(mockedResolveSweep).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'MailingLists',
      );
      const body = res.json() as { results: Array<{ action: string; destination: string }> };
      expect(body.results[0].destination).toBe('MailingLists');
      await app.close();
    });
  });

  describe('IX-009.8: results grouped by {action, destination} with examples', () => {
    it('IX-009.8: distinct {action, destination} pairs each become their own group with count and example messages', async () => {
      const { app, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
        makeReviewMessage({ uid: 2 }),
        makeReviewMessage({ uid: 3 }),
      ]);
      const moveRule = makeRule({ name: 'Move Rule', action: { type: 'move', folder: 'Archive/Lists' } });
      const deleteRule = makeRule({ name: 'Delete Rule', action: { type: 'delete' } });
      mockedEvaluateRules
        .mockReturnValueOnce(moveRule)
        .mockReturnValueOnce(deleteRule)
        .mockReturnValueOnce(moveRule);

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });

      const body = res.json() as {
        results: Array<{
          action: string;
          destination: string;
          count: number;
          messages: Array<{ uid: number; from: string; subject: string; date: string; ruleName: string }>;
        }>;
      };
      expect(body.results).toHaveLength(2);
      const moveGroup = body.results.find((g) => g.action === 'move');
      const deleteGroup = body.results.find((g) => g.action === 'delete');
      expect(moveGroup!.destination).toBe('Archive/Lists');
      expect(moveGroup!.count).toBe(2);
      expect(moveGroup!.messages).toHaveLength(2);
      expect(moveGroup!.messages[0]).toEqual(
        expect.objectContaining({
          uid: expect.any(Number),
          from: expect.any(String),
          subject: expect.any(String),
          date: expect.any(String),
          ruleName: 'Move Rule',
        }),
      );
      expect(deleteGroup!.count).toBe(1);
      expect(deleteGroup!.messages[0].ruleName).toBe('Delete Rule');
      await app.close();
    });
  });

  describe('IX-009.9: post-success state and HTTP response', () => {
    it('IX-009.9: state.status=previewing, state.dryRunResults populated, route returns { results }', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeReviewMessage({ uid: 1 }),
      ]);
      mockedEvaluateRules.mockReturnValue(makeRule({ name: 'My Rule' }));

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: unknown[] };
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.length).toBeGreaterThan(0);

      const state = engine.getState();
      expect(state.status).toBe('previewing');
      expect(state.dryRunResults).not.toBeNull();
      expect(state.dryRunResults!.length).toBe(body.results.length);
      await app.close();
    });
  });

  describe('Failure handling: IMAP fetch failure', () => {
    it('IMAP fetch failure surfaces as HTTP 500', async () => {
      const { app, engine, client } = buildHarness();
      (client.fetchAllMessages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IMAP down'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/batch/dry-run',
        payload: { sourceFolder: 'TestFolder' },
      });

      expect(res.statusCode).toBe(500);
      const body = res.json() as { error: string };
      expect(body.error).toContain('IMAP down');
      expect(engine.getState().status).toBe('error');
      await app.close();
    });
  });
});
