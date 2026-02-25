import { describe, it, expect, vi } from 'vitest';
import { executeAction } from '../../../src/actions/index.js';
import type { Rule } from '../../../src/config/index.js';
import type { EmailMessage } from '../../../src/imap/index.js';
import type { ImapClient } from '../../../src/imap/index.js';

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    uid: 42,
    messageId: '<msg-42@example.com>',
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ name: 'Bob', address: 'bob@example.com' }],
    cc: [],
    subject: 'Test message',
    date: new Date(),
    flags: new Set(),
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    match: { sender: '*@example.com' },
    action: { type: 'move', folder: 'Archive/Test' },
    enabled: true,
    order: 1,
    ...overrides,
  };
}

function makeMockClient(overrides: Partial<Pick<ImapClient, 'moveMessage' | 'createMailbox'>> = {}) {
  return {
    moveMessage: overrides.moveMessage ?? vi.fn().mockResolvedValue(undefined),
    createMailbox: overrides.createMailbox ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as ImapClient;
}

describe('executeAction', () => {
  it('moves a message to the target folder', async () => {
    const moveMessage = vi.fn().mockResolvedValue(undefined);
    const client = makeMockClient({ moveMessage });
    const msg = makeMessage();
    const rule = makeRule();

    const result = await executeAction(client, msg, rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('move');
    expect(result.folder).toBe('Archive/Test');
    expect(result.messageUid).toBe(42);
    expect(result.messageId).toBe('<msg-42@example.com>');
    expect(result.rule).toBe('test-rule');
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(moveMessage).toHaveBeenCalledWith(42, 'Archive/Test');
  });

  it('auto-creates folder and retries when move fails', async () => {
    const moveMessage = vi.fn()
      .mockRejectedValueOnce(new Error('Mailbox not found'))
      .mockResolvedValueOnce(undefined);
    const createMailbox = vi.fn().mockResolvedValue(undefined);
    const client = makeMockClient({ moveMessage, createMailbox });

    const result = await executeAction(client, makeMessage(), makeRule());

    expect(result.success).toBe(true);
    expect(result.action).toBe('move');
    expect(createMailbox).toHaveBeenCalledWith('Archive/Test');
    expect(moveMessage).toHaveBeenCalledTimes(2);
  });

  it('returns error when both move and folder creation fail', async () => {
    const moveMessage = vi.fn().mockRejectedValue(new Error('Move failed'));
    const createMailbox = vi.fn().mockRejectedValue(new Error('Cannot create folder'));
    const client = makeMockClient({ moveMessage, createMailbox });

    const result = await executeAction(client, makeMessage(), makeRule());

    expect(result.success).toBe(false);
    expect(result.action).toBe('move');
    expect(result.error).toBe('Cannot create folder');
    expect(result.folder).toBe('Archive/Test');
  });

  it('returns error when folder is created but retry move still fails', async () => {
    const moveMessage = vi.fn().mockRejectedValue(new Error('Persistent failure'));
    const createMailbox = vi.fn().mockResolvedValue(undefined);
    const client = makeMockClient({ moveMessage, createMailbox });

    const result = await executeAction(client, makeMessage(), makeRule());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Persistent failure');
  });

  it('populates all ActionResult fields correctly', async () => {
    const client = makeMockClient();
    const msg = makeMessage({ uid: 99, messageId: '<special@test.com>' });
    const rule = makeRule({ id: 'my-rule', action: { type: 'move', folder: 'Dev/OSS' } });

    const result = await executeAction(client, msg, rule);

    expect(result).toMatchObject({
      success: true,
      messageUid: 99,
      messageId: '<special@test.com>',
      action: 'move',
      folder: 'Dev/OSS',
      rule: 'my-rule',
    });
    expect(result.error).toBeUndefined();
  });
});
