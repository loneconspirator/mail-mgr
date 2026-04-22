import { describe, it, expect } from 'vitest';
import {
  buildSentinelMessage,
  purposeBody,
  type FolderPurpose,
} from '../../../src/sentinel/format.js';

describe('buildSentinelMessage', () => {
  const defaultOpts = {
    folderPath: 'Archive/Newsletters',
    folderPurpose: 'rule-target' as FolderPurpose,
    bodyText: 'test body',
  };

  it('returns object with raw string, messageId string, and flags array', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(typeof result.raw).toBe('string');
    expect(typeof result.messageId).toBe('string');
    expect(Array.isArray(result.flags)).toBe(true);
  });

  it('raw contains Message-ID header matching returned messageId', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toContain(`Message-ID: ${result.messageId}`);
  });

  it('raw contains From: mail-manager@localhost', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toContain('From: mail-manager@localhost');
  });

  it('raw contains To: mail-manager@localhost', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toContain('To: mail-manager@localhost');
  });

  it('raw contains Subject: [Mail Manager] Sentinel: Archive/Newsletters', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toContain('Subject: [Mail Manager] Sentinel: Archive/Newsletters');
  });

  it('raw contains X-Mail-Mgr-Sentinel header matching returned messageId', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toContain(`X-Mail-Mgr-Sentinel: ${result.messageId}`);
  });

  it('raw contains MIME-Version: 1.0', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toContain('MIME-Version: 1.0');
  });

  it('raw contains Content-Type: text/plain; charset=utf-8', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toContain('Content-Type: text/plain; charset=utf-8');
  });

  it('messageId matches pattern <uuid@mail-manager.sentinel>', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.messageId).toMatch(
      /^<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@mail-manager\.sentinel>$/,
    );
  });

  it('flags is ["\\Seen"]', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.flags).toEqual(['\\Seen']);
  });

  it('headers use CRLF line endings', () => {
    const result = buildSentinelMessage(defaultOpts);
    const headerBlock = result.raw.split('\r\n\r\n')[0];
    // Every line in the header block should end with \r\n (split by \r\n should produce lines)
    const lines = headerBlock.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    // Should NOT contain bare LF in header block
    expect(headerBlock.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('header block and body are separated by blank line (CRLF CRLF)', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toContain('\r\n\r\n');
  });

  it('body text appears after the blank line separator', () => {
    const result = buildSentinelMessage(defaultOpts);
    const parts = result.raw.split('\r\n\r\n');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[1]).toContain('test body');
  });

  it('two calls produce different messageId values', () => {
    const r1 = buildSentinelMessage(defaultOpts);
    const r2 = buildSentinelMessage(defaultOpts);
    expect(r1.messageId).not.toBe(r2.messageId);
  });

  it('Date header is present in raw output', () => {
    const result = buildSentinelMessage(defaultOpts);
    expect(result.raw).toMatch(/^Date: .+/m);
  });

  it('throws when folderPath is INBOX', () => {
    expect(() =>
      buildSentinelMessage({ ...defaultOpts, folderPath: 'INBOX' }),
    ).toThrow('INBOX');
  });

  it('throws when folderPath is inbox (case-insensitive)', () => {
    expect(() =>
      buildSentinelMessage({ ...defaultOpts, folderPath: 'inbox' }),
    ).toThrow('INBOX');
  });

  it('throws when folderPath is Inbox (case-insensitive)', () => {
    expect(() =>
      buildSentinelMessage({ ...defaultOpts, folderPath: 'Inbox' }),
    ).toThrow('INBOX');
  });

  it('throws when folderPath contains CRLF characters (header injection prevention)', () => {
    expect(() =>
      buildSentinelMessage({ ...defaultOpts, folderPath: 'Archive\r\nBcc: evil@attacker.com' }),
    ).toThrow('invalid characters');
  });

  it('throws when folderPath contains bare LF', () => {
    expect(() =>
      buildSentinelMessage({ ...defaultOpts, folderPath: 'Archive\nBcc: evil@attacker.com' }),
    ).toThrow('invalid characters');
  });

  it('throws when folderPath contains bare CR', () => {
    expect(() =>
      buildSentinelMessage({ ...defaultOpts, folderPath: 'Archive\rBcc: evil@attacker.com' }),
    ).toThrow('invalid characters');
  });
});

describe('purposeBody', () => {
  it('returns different text for each folder purpose', () => {
    const purposes: FolderPurpose[] = ['rule-target', 'action-folder', 'review', 'sweep-target'];
    const bodies = purposes.map((p) => purposeBody('TestFolder', p));
    const unique = new Set(bodies);
    expect(unique.size).toBe(4);
  });

  it('rule-target body mentions tracking and folder renames', () => {
    const body = purposeBody('Archive/News', 'rule-target');
    expect(body).toContain('Archive/News');
    expect(body).toContain('sentinel');
  });

  it('action-folder body mentions action folder and processing', () => {
    const body = purposeBody('Actions/VIP', 'action-folder');
    expect(body).toContain('Actions/VIP');
    expect(body).toContain('action folder');
  });

  it('review body mentions review folder', () => {
    const body = purposeBody('Review', 'review');
    expect(body).toContain('Review');
    expect(body).toContain('review folder');
  });

  it('sweep-target body mentions sweep target folder', () => {
    const body = purposeBody('Archive/Swept', 'sweep-target');
    expect(body).toContain('Archive/Swept');
    expect(body).toContain('sweep target folder');
  });

  it('uses purposeBody when bodyText is not provided', () => {
    const result = buildSentinelMessage({
      folderPath: 'Archive/Newsletters',
      folderPurpose: 'rule-target',
    });
    const body = result.raw.split('\r\n\r\n')[1];
    expect(body).toContain('sentinel');
    expect(body).toContain('Archive/Newsletters');
  });
});
