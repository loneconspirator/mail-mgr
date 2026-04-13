import { describe, it, expect, vi } from 'vitest';
import { executeAction } from '../../../src/actions/index.js';
import type { ActionContext } from '../../../src/actions/index.js';
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

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    client: {
      moveMessage: vi.fn().mockResolvedValue(undefined),
      createMailbox: vi.fn().mockResolvedValue(undefined),
    } as unknown as ImapClient,
    reviewFolder: 'Review',
    trashFolder: 'Trash',
    ...overrides,
  };
}

describe('executeAction', () => {
  it('moves a message to the target folder', async () => {
    const moveMessage = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ client: { moveMessage, createMailbox: vi.fn().mockResolvedValue(undefined) } as unknown as ImapClient });
    const msg = makeMessage();
    const rule = makeRule();

    const result = await executeAction(ctx, msg, rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('move');
    expect(result.folder).toBe('Archive/Test');
    expect(result.messageUid).toBe(42);
    expect(result.messageId).toBe('<msg-42@example.com>');
    expect(result.rule).toBe('test-rule');
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(moveMessage).toHaveBeenCalledWith(42, 'Archive/Test', undefined);
  });

  it('auto-creates folder and retries when move fails', async () => {
    const moveMessage = vi.fn()
      .mockRejectedValueOnce(new Error('Mailbox not found'))
      .mockResolvedValueOnce(undefined);
    const createMailbox = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ client: { moveMessage, createMailbox } as unknown as ImapClient });

    const result = await executeAction(ctx, makeMessage(), makeRule());

    expect(result.success).toBe(true);
    expect(result.action).toBe('move');
    expect(createMailbox).toHaveBeenCalledWith('Archive/Test');
    expect(moveMessage).toHaveBeenCalledTimes(2);
  });

  it('returns error when both move and folder creation fail', async () => {
    const moveMessage = vi.fn().mockRejectedValue(new Error('Move failed'));
    const createMailbox = vi.fn().mockRejectedValue(new Error('Cannot create folder'));
    const ctx = makeCtx({ client: { moveMessage, createMailbox } as unknown as ImapClient });

    const result = await executeAction(ctx, makeMessage(), makeRule());

    expect(result.success).toBe(false);
    expect(result.action).toBe('move');
    expect(result.error).toBe('Cannot create folder');
    expect(result.folder).toBe('Archive/Test');
  });

  it('returns error when folder is created but retry move still fails', async () => {
    const moveMessage = vi.fn().mockRejectedValue(new Error('Persistent failure'));
    const createMailbox = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ client: { moveMessage, createMailbox } as unknown as ImapClient });

    const result = await executeAction(ctx, makeMessage(), makeRule());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Persistent failure');
  });

  it('populates all ActionResult fields correctly', async () => {
    const ctx = makeCtx();
    const msg = makeMessage({ uid: 99, messageId: '<special@test.com>' });
    const rule = makeRule({ id: 'my-rule', action: { type: 'move', folder: 'Dev/OSS' } });

    const result = await executeAction(ctx, msg, rule);

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

  it('review action moves message to review folder', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const rule = makeRule({ action: { type: 'review' } });

    const result = await executeAction(ctx, makeMessage(), rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('review');
    expect(result.folder).toBe('Review');
    expect(moveMessage).toHaveBeenCalledWith(42, 'Review', undefined);
  });

  it('review action uses rule-specific folder when provided', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const rule = makeRule({ action: { type: 'review', folder: 'Review/Important' } });

    const result = await executeAction(ctx, makeMessage(), rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('review');
    expect(result.folder).toBe('Review/Important');
    expect(moveMessage).toHaveBeenCalledWith(42, 'Review/Important', undefined);
  });

  it('skip action returns success without any IMAP calls', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const createMailbox = vi.mocked(ctx.client.createMailbox);
    const rule = makeRule({ action: { type: 'skip' } });

    const result = await executeAction(ctx, makeMessage(), rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('skip');
    expect(result.folder).toBeUndefined();
    expect(moveMessage).not.toHaveBeenCalled();
    expect(createMailbox).not.toHaveBeenCalled();
  });

  it('delete action moves message to trash folder', async () => {
    const ctx = makeCtx();
    const moveMessage = vi.mocked(ctx.client.moveMessage);
    const rule = makeRule({ action: { type: 'delete' } });

    const result = await executeAction(ctx, makeMessage(), rule);

    expect(result.success).toBe(true);
    expect(result.action).toBe('delete');
    expect(result.folder).toBe('Trash');
    expect(moveMessage).toHaveBeenCalledWith(42, 'Trash', undefined);
  });
});
