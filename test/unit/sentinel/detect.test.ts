import { describe, it, expect } from 'vitest';
import { isSentinel, isSentinelRaw, SENTINEL_HEADER } from '../../../src/sentinel/detect.js';

describe('SENTINEL_HEADER constant', () => {
  it('equals lowercase x-mail-mgr-sentinel', () => {
    expect(SENTINEL_HEADER).toBe('x-mail-mgr-sentinel');
  });
});

describe('isSentinel', () => {
  it('returns false when headers is undefined', () => {
    expect(isSentinel(undefined)).toBe(false);
  });

  it('returns false when headers map has no sentinel key', () => {
    const headers = new Map<string, string>();
    headers.set('from', 'test@example.com');
    headers.set('subject', 'Hello');
    expect(isSentinel(headers)).toBe(false);
  });

  it('returns true when headers map has x-mail-mgr-sentinel key', () => {
    const headers = new Map<string, string>();
    headers.set('x-mail-mgr-sentinel', '<abc@mail-manager.sentinel>');
    expect(isSentinel(headers)).toBe(true);
  });

  it('returns true regardless of sentinel header value', () => {
    const headers = new Map<string, string>();
    headers.set('x-mail-mgr-sentinel', '');
    expect(isSentinel(headers)).toBe(true);
  });
});

describe('isSentinelRaw', () => {
  it('returns false when buf is undefined', () => {
    expect(isSentinelRaw(undefined)).toBe(false);
  });

  it('returns false when buf is empty Buffer', () => {
    expect(isSentinelRaw(Buffer.from(''))).toBe(false);
  });

  it('returns false when buf contains other headers but no sentinel header', () => {
    const raw = Buffer.from('From: test@example.com\r\nSubject: Hello\r\n');
    expect(isSentinelRaw(raw)).toBe(false);
  });

  it('returns true when buf contains X-Mail-Mgr-Sentinel header line', () => {
    const raw = Buffer.from(
      'X-Mail-Mgr-Sentinel: <test@mail-manager.sentinel>\r\nFrom: test@example.com\r\n',
    );
    expect(isSentinelRaw(raw)).toBe(true);
  });
});
