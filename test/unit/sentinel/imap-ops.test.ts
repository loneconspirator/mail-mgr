import { describe, it, expect, vi } from 'vitest';
import {
  appendSentinel,
  findSentinel,
  deleteSentinel,
  runSentinelSelfTest,
} from '../../../src/sentinel/imap-ops.js';

function createMockClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    appendMessage: vi.fn(async () => ({ destination: 'TestFolder', uid: 1 })),
    searchByHeader: vi.fn(async () => [] as number[]),
    deleteMessage: vi.fn(async () => true),
    ...overrides,
  };
}

function createMockStore() {
  return {
    upsert: vi.fn(),
    deleteByMessageId: vi.fn(),
  };
}

function createMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('appendSentinel', () => {
  it('appends sentinel to folder via client.appendMessage', async () => {
    const client = createMockClient();
    const result = await appendSentinel(client as any, 'Archive', 'rule-target');
    expect(client.appendMessage).toHaveBeenCalledWith(
      'Archive',
      expect.any(String),
      ['\\Seen'],
    );
    expect(result.messageId).toMatch(/@mail-manager\.sentinel>/);
    expect(result.uid).toBe(1);
  });

  it('records in store when store provided', async () => {
    const client = createMockClient();
    const store = createMockStore();
    const result = await appendSentinel(client as any, 'Archive', 'rule-target', store as any);
    expect(store.upsert).toHaveBeenCalledWith(
      result.messageId,
      'Archive',
      'rule-target',
    );
  });

  it('does not require store', async () => {
    const client = createMockClient();
    await expect(appendSentinel(client as any, 'Archive', 'rule-target')).resolves.not.toThrow();
  });

  it('rejects INBOX', async () => {
    const client = createMockClient();
    await expect(appendSentinel(client as any, 'INBOX', 'rule-target')).rejects.toThrow('INBOX');
  });
});

describe('findSentinel', () => {
  it('searches by X-Mail-Mgr-Sentinel header', async () => {
    const client = createMockClient();
    await findSentinel(client as any, 'Archive', '<test@mail-manager.sentinel>');
    expect(client.searchByHeader).toHaveBeenCalledWith(
      'Archive',
      'X-Mail-Mgr-Sentinel',
      '<test@mail-manager.sentinel>',
    );
  });

  it('returns first UID when found', async () => {
    const client = createMockClient({
      searchByHeader: vi.fn(async () => [42, 99]),
    });
    const result = await findSentinel(client as any, 'Archive', '<test@mail-manager.sentinel>');
    expect(result).toBe(42);
  });

  it('returns undefined when not found', async () => {
    const client = createMockClient();
    const result = await findSentinel(client as any, 'Archive', '<test@mail-manager.sentinel>');
    expect(result).toBeUndefined();
  });
});

describe('deleteSentinel', () => {
  it('deletes message by UID', async () => {
    const client = createMockClient();
    await deleteSentinel(client as any, 'Archive', 42);
    expect(client.deleteMessage).toHaveBeenCalledWith('Archive', 42);
  });

  it('removes from store when store and messageId provided', async () => {
    const client = createMockClient();
    const store = createMockStore();
    await deleteSentinel(client as any, 'Archive', 42, store as any, '<test@id>');
    expect(store.deleteByMessageId).toHaveBeenCalledWith('<test@id>');
  });

  it('works without store', async () => {
    const client = createMockClient();
    await expect(deleteSentinel(client as any, 'Archive', 42)).resolves.not.toThrow();
  });
});

describe('runSentinelSelfTest', () => {
  it('returns true when round-trip succeeds', async () => {
    const client = createMockClient({
      searchByHeader: vi.fn(async () => [1]),
    });
    const logger = createMockLogger();
    const result = await runSentinelSelfTest(client as any, 'TestFolder', logger as any);
    expect(result).toBe(true);
    expect(logger.info).toHaveBeenCalled();
  });

  it('returns false when SEARCH finds nothing', async () => {
    const client = createMockClient();
    const logger = createMockLogger();
    const result = await runSentinelSelfTest(client as any, 'TestFolder', logger as any);
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('cleans up test sentinel on SEARCH failure', async () => {
    const client = createMockClient();
    const logger = createMockLogger();
    await runSentinelSelfTest(client as any, 'TestFolder', logger as any);
    expect(client.deleteMessage).toHaveBeenCalled();
  });

  it('returns false on APPEND error (does not throw)', async () => {
    const client = createMockClient({
      appendMessage: vi.fn(async () => { throw new Error('APPEND failed'); }),
    });
    const logger = createMockLogger();
    const result = await runSentinelSelfTest(client as any, 'TestFolder', logger as any);
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('cleans up even when SEARCH throws', async () => {
    const client = createMockClient({
      searchByHeader: vi.fn(async () => { throw new Error('SEARCH failed'); }),
    });
    const logger = createMockLogger();
    await runSentinelSelfTest(client as any, 'TestFolder', logger as any);
    expect(client.deleteMessage).toHaveBeenCalled();
  });

  it('best-effort cleanup — does not throw if DELETE fails', async () => {
    const client = createMockClient({
      searchByHeader: vi.fn(async () => [1]),
      deleteMessage: vi.fn(async () => { throw new Error('DELETE failed'); }),
    });
    const logger = createMockLogger();
    const result = await runSentinelSelfTest(client as any, 'TestFolder', logger as any);
    expect(result).toBe(true);
  });
});
