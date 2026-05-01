/**
 * MOD-0002 ImapClient — interface schema.
 *
 * Public surface for the IMAP abstraction layer. See
 * specs/modules/mod-0002-imap-client.md for the canonical interface contract,
 * dependencies, and notes. Architecture lives at
 * specs/architecture.md#imap--infrastructure.
 */
import { EventEmitter } from 'events';
import type { ImapConfig } from '../config/index.js';
import { parseHeaderLines, classifyVisibility } from './messages.js';
import type { ReviewMessage, EmailAddress, Visibility } from './messages.js';
import type { FolderNode } from '../shared/types.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ImapClientEvents {
  connected: [];
  disconnected: [reason?: string];
  error: [error: Error];
  newMail: [count: number];
}

export interface MailboxLock {
  release(): void;
}

export interface AppendResponse {
  destination: string;
  uidValidity?: bigint;
  uid?: number;
  seq?: number;
}

export interface SearchQuery {
  header?: Record<string, string | boolean>;
  seen?: boolean;
  all?: boolean;
  uid?: string;
  [key: string]: unknown;
}

export interface ImapFlowLike {
  close(): void;
  connect(): Promise<void>;
  logout(): Promise<void>;
  mailboxOpen(path: string | string[]): Promise<unknown>;
  getMailboxLock(path: string | string[]): Promise<MailboxLock>;
  messageMove(range: number[] | string, destination: string, options?: { uid?: boolean }): Promise<unknown>;
  mailboxCreate(path: string | string[]): Promise<unknown>;
  mailboxRename(path: string | string[], newPath: string | string[]): Promise<unknown>;
  fetch(range: string, query: Record<string, unknown>, options?: { uid?: boolean }): AsyncIterable<unknown>;
  list(options?: Record<string, unknown>): Promise<unknown[]>;
  status(path: string, query: Record<string, boolean>): Promise<Record<string, number>>;
  listTree(options?: Record<string, unknown>): Promise<unknown>;
  noop(): Promise<void>;
  append(path: string, content: string | Buffer, flags?: string[], idate?: Date): Promise<AppendResponse | false>;
  search(query: SearchQuery, options?: { uid?: boolean }): Promise<number[] | false | undefined>;
  messageDelete(range: number[] | string, options?: { uid?: boolean }): Promise<boolean>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeAllListeners(event?: string): this;
  usable: boolean;
  idleSupported?: boolean;
}

export type ImapFlowFactory = (config: ImapConfig) => ImapFlowLike;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

// FM-002: hard caps on individual IMAP operations so a half-open socket
// surfaces as a thrown error instead of an indefinite hang. Both the IDLE
// keepalive and the LIST/listTree request had been observed to wedge in
// production after multi-day uptime; these timeouts are the trip-wire that
// converts "wedged" into "throw and reconnect".
const NOOP_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 15_000;

// FM-002 Phase 34: clustered op-class buckets, NOT per-op constants. See
// .planning/phases/34-.../34-RESEARCH.md "Per-op timeout budget" for the
// rationale. Plan 02 wires these into every public op via guardedOp.
const CONNECT_TIMEOUT_MS = 30_000;       // R3 — TLS handshake + LOGIN + SELECT INBOX
const LOCK_TIMEOUT_MS = 15_000;          // getMailboxLock acquisition
const WRITE_TIMEOUT_MS = 30_000;         // moveMessage / appendMessage / search
const BULK_FETCH_TIMEOUT_MS = 120_000;   // fetchAllMessages — whole-folder fetch

/**
 * FM-002 IN-01: sentinel error class for `withTimeout` rejections.
 *
 * `guardedOp` keys its `handleClose` trip-wire on `instanceof TimeoutError`
 * rather than regex-matching on the message string, so a server-side
 * "command timed out on server" reply or an imapflow-internal timeout-shaped
 * error can no longer falsely trigger reconnect. The error message format
 * (`${label} timed out after ${ms}ms`) is preserved verbatim so existing
 * matrix tests and external log greps that match `/timed out/i` continue to
 * work.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(label, ms));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class ImapClient extends EventEmitter<ImapClientEvents> {
  private flow: ImapFlowLike | null = null;
  private _state: ConnectionState = 'disconnected';
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private autoReconnect = true;
  private _idleSupported = true;
  private specialUseCache: Map<string, string | null> = new Map();
  private readonly config: ImapConfig;
  private readonly factory: ImapFlowFactory;

  constructor(config: ImapConfig, factory: ImapFlowFactory) {
    super();
    this.config = config;
    this.factory = factory;
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    this._state = state;
  }

  async connect(): Promise<void> {
    if (this._state === 'connecting' || this._state === 'connected') {
      return;
    }

    this.autoReconnect = true;
    this.setState('connecting');

    try {
      this.flow = this.factory(this.config);
      this.bindFlowEvents(this.flow);
      // FM-002 R3: bound TLS-handshake / LOGIN and the initial SELECT INBOX
      // so a wedge during reconnect can no longer leave the client stuck in
      // 'connecting' forever. Timeout errors flow through the catch block
      // below into setState('error') + emit + scheduleReconnect.
      await withTimeout(this.flow.connect(), CONNECT_TIMEOUT_MS, 'IMAP CONNECT');
      await withTimeout(this.flow.mailboxOpen('INBOX'), CONNECT_TIMEOUT_MS, 'IMAP SELECT INBOX');

      this.setState('connected');
      this.resetBackoff();
      this.detectIdleSupport(this.flow);
      this.startIdleOrPoll();
      this.emit('connected');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState('error');
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }

  get idleSupported(): boolean {
    return this._idleSupported;
  }

  async disconnect(): Promise<void> {
    this.autoReconnect = false;
    this.clearReconnectTimer();
    this.stopIdleAndPoll();

    if (this.flow) {
      try {
        // FM-002 Phase 34: bound logout — a hung LOGOUT must not silently
        // delay disconnect() forever. 5s is generous for a single LOGOUT
        // command on a healthy server. Failure is already swallowed.
        await withTimeout(this.flow.logout(), 5_000, 'IMAP LOGOUT');
      } catch {
        // best-effort logout
      }
      this.cleanupFlow();
    }

    this.setState('disconnected');
    this.emit('disconnected', 'manual');
  }

  getBackoffMs(): number {
    return this.backoffMs;
  }

  async withMailboxLock<T>(
    folder: string,
    fn: (flow: ImapFlowLike) => Promise<T>,
    workTimeoutMs: number = WRITE_TIMEOUT_MS,
  ): Promise<T> {
    // FM-002 Phase 34: guard BOTH the lock acquisition (LOCK_TIMEOUT_MS) and
    // the inner work (caller-supplied) — getMailboxLock can hang during the
    // SELECT inside processLocks (imapflow lib/imap-flow.js:3340-3469).
    const lock = await this.guardedOp(
      `getMailboxLock(${folder})`,
      (flow) => flow.getMailboxLock(folder),
      LOCK_TIMEOUT_MS,
    );
    try {
      return await this.guardedOp(
        `withMailboxLock(${folder}) work`,
        (flow) => fn(flow),
        workTimeoutMs,
      );
    } finally {
      // Defensive: lock.release() should not throw, but if the imapflow
      // internal state is corrupted we still need to fall through.
      try {
        lock.release();
      } catch {
        // best-effort release — already swallowed pre-FM-002
      }
    }
  }

  /**
   * FM-002: chokepoint wrapping every public IMAP op.
   * (a) refuses to issue if flow missing or flow.usable is false (and
   *     force-closes so reconnect runs),
   * (b) bounds the inner imapflow call with withTimeout,
   * (c) on timeout, force-closes so reconnect runs.
   * Caller-side errors (NoConnection, server errors) propagate without
   * forcing close — handleClose is only invoked on wedge-shaped failures.
   *
   * Plan 02 wires this through every public op. This plan only introduces
   * the wrapper; cleanupFlow already exercises the `handleClose` side
   * effect via the cycleIdle path so the wrapper is testable today.
   */
  private async guardedOp<T>(
    label: string,
    op: (flow: ImapFlowLike) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    if (!this.flow) throw new Error('Not connected');
    if (!this.flow.usable) {
      this.handleClose();
      throw new Error(`IMAP ${label}: connection not usable`);
    }
    // Capture flow into a local — protects the closure if a concurrent
    // handleClose nulls the reference between the usable check and the
    // inner call.
    const flow = this.flow;
    try {
      return await withTimeout(op(flow), timeoutMs, `IMAP ${label}`);
    } catch (err) {
      // IN-01: key the trip-wire off the sentinel class, not a string match,
      // so a server-side "[CLIENTBUG] command timed out on server" or any
      // other timeout-shaped error from a deeper layer can't falsely trigger
      // reconnect. Only OUR `withTimeout` rejection counts as a wedge.
      if (err instanceof TimeoutError) {
        this.handleClose();
      }
      throw err;
    }
  }

  async withMailboxSwitch<T>(
    folder: string,
    fn: (flow: ImapFlowLike) => Promise<T>,
    workTimeoutMs: number = WRITE_TIMEOUT_MS,
  ): Promise<T> {
    this.stopIdleAndPoll();

    // FM-002 Phase 34: guard lock acquisition AND inner work; the INBOX
    // restore in the finally is best-effort but bounded by LOCK_TIMEOUT_MS
    // so a wedge during restore can't outlive the calling op's return.
    const lock = await this.guardedOp(
      `getMailboxLock(${folder})`,
      (flow) => flow.getMailboxLock(folder),
      LOCK_TIMEOUT_MS,
    );
    try {
      return await this.guardedOp(
        `withMailboxSwitch(${folder}) work`,
        (flow) => fn(flow),
        workTimeoutMs,
      );
    } finally {
      try {
        lock.release();
      } catch {
        // best-effort release
      }
      try {
        // FM-002 Phase 34: route INBOX restore through guardedOp so a wedge
        // here trips the same `flow.usable` precheck and `handleClose`-on-
        // timeout side effects as every other op. Without this, a hung
        // restore burns LOCK_TIMEOUT_MS without scheduling a reconnect, and
        // the next caller re-issues against the same wedged socket.
        // Errors are still swallowed at the call site so a failed restore
        // doesn't mask the inner work's real error.
        await this.guardedOp(
          'SELECT INBOX (restore)',
          (flow) => flow.mailboxOpen('INBOX').then(() => undefined),
          LOCK_TIMEOUT_MS,
        );
      } catch {
        // best-effort reopen — already swallowed pre-FM-002
      }
      this.startIdleOrPoll();
    }
  }

  async moveMessage(uid: number, destination: string, sourceFolder: string = 'INBOX'): Promise<void> {
    const work = async (flow: ImapFlowLike): Promise<void> => {
      // ImapFlow returns falsy (not a thrown error) when the destination
      // mailbox doesn't exist or no UIDs matched. Treat that as failure so
      // executeAction's retry path (auto-create folder + retry) actually fires.
      const result = await flow.messageMove([uid], destination, { uid: true });
      if (!result) {
        throw new Error(`MOVE uid=${uid} to "${destination}" returned no result (destination missing or uid not found)`);
      }
    };
    // Non-INBOX source folders go through withMailboxSwitch so INBOX + IDLE
    // are restored on both success and error paths (INV-001 / FM-001).
    if (sourceFolder === 'INBOX') {
      await this.withMailboxLock(sourceFolder, work, WRITE_TIMEOUT_MS);
    } else {
      await this.withMailboxSwitch(sourceFolder, work, WRITE_TIMEOUT_MS);
    }
  }

  /** List all mailboxes with path and flags. */
  async listMailboxes(): Promise<Array<{ path: string; flags: string[] }>> {
    const mailboxes = await this.guardedOp(
      'LIST',
      (flow) => flow.list(),
      LIST_TIMEOUT_MS,
    );
    return mailboxes.map((mb) => {
      const box = mb as { path?: string; flags?: Set<string> | string[] };
      return {
        path: box.path ?? '',
        flags: box.flags instanceof Set ? [...box.flags] : Array.isArray(box.flags) ? box.flags : [],
      };
    });
  }

  async status(path: string): Promise<{ messages: number; unseen: number }> {
    const result = await this.guardedOp(
      `STATUS(${path})`,
      (flow) => flow.status(path, { messages: true, unseen: true }),
      LIST_TIMEOUT_MS,
    );
    return {
      messages: result.messages ?? 0,
      unseen: result.unseen ?? 0,
    };
  }

  async createMailbox(path: string | string[]): Promise<void> {
    await this.withMailboxLock('INBOX', async (flow) => {
      await flow.mailboxCreate(path);
    }, WRITE_TIMEOUT_MS);
  }

  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    await this.withMailboxLock('INBOX', async (flow) => {
      await flow.mailboxRename(oldPath, newPath);
    }, WRITE_TIMEOUT_MS);
  }

  async appendMessage(folder: string, raw: string, flags: string[]): Promise<AppendResponse> {
    const result = await this.guardedOp(
      `APPEND(${folder})`,
      (flow) => flow.append(folder, raw, flags),
      WRITE_TIMEOUT_MS,
    );
    if (result === false) {
      throw new Error(`APPEND to ${folder} failed`);
    }
    return result;
  }

  async searchByHeader(folder: string, headerName: string, headerValue: string): Promise<number[]> {
    return this.withMailboxSwitch(folder, async (flow) => {
      const result = await flow.search(
        { header: { [headerName]: headerValue } },
        { uid: true },
      );
      return Array.isArray(result) ? result : [];
    }, WRITE_TIMEOUT_MS);
  }

  async deleteMessage(folder: string, uid: number): Promise<boolean> {
    return this.withMailboxSwitch(folder, async (flow) => {
      return flow.messageDelete([uid], { uid: true });
    }, WRITE_TIMEOUT_MS);
  }

  async getSpecialUseFolder(use: string): Promise<string | null> {
    if (this.specialUseCache.has(use)) {
      return this.specialUseCache.get(use)!;
    }

    const mailboxes = await this.guardedOp(
      `LIST(special-use ${use})`,
      (flow) => flow.list(),
      LIST_TIMEOUT_MS,
    );
    for (const mb of mailboxes) {
      const box = mb as { path?: string; specialUse?: string };
      if (box.specialUse === use && box.path) {
        this.specialUseCache.set(use, box.path);
        return box.path;
      }
    }

    this.specialUseCache.set(use, null);
    return null;
  }

  async fetchMessagesRaw(range: string, query: Record<string, unknown>): Promise<unknown[]> {
    return this.guardedOp(
      `FETCH(${range})`,
      async (flow) => {
        const results: unknown[] = [];
        for await (const msg of flow.fetch(range, query, { uid: true })) {
          results.push(msg);
        }
        return results;
      },
      BULK_FETCH_TIMEOUT_MS,
    );
  }

  /** Return the header field names to always fetch (sentinel header + optional envelope headers). */
  private getHeaderFields(): string[] {
    const fields = ['X-Mail-Mgr-Sentinel'];
    if (this.config.envelopeHeader) {
      fields.push(this.config.envelopeHeader, 'List-Id');
    }
    return fields;
  }

  /**
   * Fetch envelopes for messages newer than the given UID.
   * Returns raw fetch results for parsing with parseMessage().
   */
  async fetchNewMessages(sinceUid: number): Promise<unknown[]> {
    return this.withMailboxLock('INBOX', async (flow) => {
      const range = sinceUid > 0 ? `${sinceUid + 1}:*` : '1:*';
      const query: Record<string, unknown> = { uid: true, envelope: true, flags: true };
      const headerFields = this.getHeaderFields();
      if (headerFields) {
        query.headers = headerFields;
      }
      const results: unknown[] = [];
      for await (const msg of flow.fetch(range, query, { uid: true })) {
        const m = msg as { uid?: number };
        if (m.uid !== undefined && m.uid > sinceUid) {
          results.push(msg);
        }
      }
      return results;
    }, BULK_FETCH_TIMEOUT_MS);
  }

  async fetchAllMessages(folder: string): Promise<ReviewMessage[]> {
    const work = async (): Promise<ReviewMessage[]> => {
      const query: Record<string, unknown> = {
        uid: true,
        flags: true,
        internalDate: true,
        envelope: true,
      };
      const headerFields = this.getHeaderFields();
      if (headerFields) {
        query.headers = headerFields;
      }
      const raw = await this.fetchMessagesRaw('1:*', query);
      return raw.map((r) => this.parseRawToReviewMessage(r));
    };
    // Non-INBOX folders go through withMailboxSwitch so INBOX + IDLE are
    // restored on both success and error paths (INV-001 / FM-001). INBOX
    // can stay on withMailboxLock since the post-op restore is a no-op.
    return folder === 'INBOX'
      ? this.withMailboxLock(folder, work, BULK_FETCH_TIMEOUT_MS)
      : this.withMailboxSwitch(folder, work, BULK_FETCH_TIMEOUT_MS);
  }

  private parseRawToReviewMessage(raw: unknown): ReviewMessage {
    const msg = raw as {
      uid: number;
      flags?: Set<string>;
      internalDate?: Date;
      headers?: Buffer;
      envelope?: {
        from?: Array<{ name?: string; address?: string }>;
        to?: Array<{ name?: string; address?: string }>;
        cc?: Array<{ name?: string; address?: string }>;
        subject?: string;
        messageId?: string;
      };
    };

    const parseAddr = (a?: { name?: string; address?: string }): EmailAddress => ({
      name: a?.name ?? '',
      address: a?.address ?? '',
    });

    const parseAddrList = (list?: Array<{ name?: string; address?: string }>): EmailAddress[] =>
      list?.map(parseAddr) ?? [];

    const fromList = msg.envelope?.from;
    const from = fromList && fromList.length > 0 ? parseAddr(fromList[0]) : { name: '', address: '' };
    const to = parseAddrList(msg.envelope?.to);
    const cc = parseAddrList(msg.envelope?.cc);

    const parsedHeaders = msg.headers ? parseHeaderLines(msg.headers) : undefined;
    let envelopeRecipient: string | undefined;
    let visibility: Visibility | undefined;

    if (this.config.envelopeHeader && parsedHeaders) {
      const recipientVal = parsedHeaders.get(this.config.envelopeHeader.toLowerCase());
      if (recipientVal && recipientVal.includes('@')) {
        envelopeRecipient = recipientVal;
      }
      const listId = parsedHeaders.get('list-id');
      visibility = classifyVisibility(envelopeRecipient, to, cc, listId);
    }

    return {
      uid: msg.uid,
      flags: msg.flags ?? new Set(),
      internalDate: msg.internalDate ?? new Date(0),
      envelope: {
        from,
        to,
        cc,
        subject: msg.envelope?.subject ?? '',
        messageId: msg.envelope?.messageId ?? '',
      },
      envelopeRecipient,
      visibility,
      headers: parsedHeaders,
    };
  }

  /** List all IMAP folders as a nested tree of FolderNode. */
  async listFolders(): Promise<FolderNode[]> {
    // FM-002 Phase 34: routed through guardedOp like every other public op.
    // Same trip-wire (usable=false force-closes), same bound (LIST_TIMEOUT_MS).
    const tree = await this.guardedOp(
      'LIST',
      (flow) => flow.listTree() as Promise<{ folders?: unknown[] }>,
      LIST_TIMEOUT_MS,
    );
    return this.transformTree(tree.folders ?? []);
  }

  private transformTree(nodes: unknown[]): FolderNode[] {
    const result: FolderNode[] = [];
    for (const raw of nodes) {
      const node = raw as {
        root?: boolean;
        path?: string;
        name?: string;
        delimiter?: string;
        flags?: Set<string>;
        specialUse?: string;
        disabled?: boolean;
        folders?: unknown[];
      };
      if (node.root) {
        // Skip root nodes, return their children directly
        result.push(...this.transformTree(node.folders ?? []));
        continue;
      }
      const folderNode: FolderNode = {
        path: node.path ?? '',
        name: node.name ?? '',
        delimiter: node.delimiter ?? '/',
        flags: Array.from(node.flags ?? new Set()),
        children: this.transformTree(node.folders ?? []),
      };
      if (node.specialUse) {
        folderNode.specialUse = node.specialUse;
      }
      if (node.disabled) {
        folderNode.disabled = node.disabled;
      }
      result.push(folderNode);
    }
    return result;
  }

  private detectIdleSupport(flow: ImapFlowLike): void {
    if (flow.idleSupported === false) {
      this._idleSupported = false;
    } else {
      this._idleSupported = true;
    }
  }

  private startIdleOrPoll(): void {
    this.stopIdleAndPoll();

    if (this._idleSupported) {
      this.startIdleCycling();
    } else {
      this.startPolling();
    }
  }

  /**
   * Re-issue IDLE every idleTimeout ms by sending NOOP to break IDLE,
   * which causes ImapFlow to re-enter IDLE automatically.
   */
  private startIdleCycling(): void {
    const timeout = this.config.idleTimeout;
    this.idleTimer = setTimeout(() => {
      this.cycleIdle();
    }, timeout);
  }

  private async cycleIdle(): Promise<void> {
    if (this._state !== 'connected') return;

    // FM-002: a half-open socket leaves `flow.usable` false (or makes noop
    // hang forever). Both states must force-close so scheduleReconnect runs
    // — silently no-oping was the production bug that let the wedge persist.
    if (!this.flow?.usable) {
      this.handleClose();
      return;
    }

    try {
      await withTimeout(this.flow.noop(), NOOP_TIMEOUT_MS, 'IMAP NOOP');
    } catch {
      this.handleClose();
      return;
    }

    if (this._state === 'connected') {
      this.idleTimer = setTimeout(() => {
        this.cycleIdle();
      }, this.config.idleTimeout);
    }
  }

  /**
   * Poll for new mail at pollInterval ms when IDLE is not supported.
   * Emits newMail so the Monitor pipeline picks it up the same way.
   */
  private startPolling(): void {
    const interval = this.config.pollInterval;
    this.pollTimer = setInterval(() => {
      this.poll();
    }, interval);
  }

  private async poll(): Promise<void> {
    if (this._state !== 'connected' || !this.flow?.usable) {
      return;
    }

    try {
      // NOOP triggers the server to send any pending EXISTS updates
      await this.flow.noop();
    } catch {
      // noop failure will trigger error/close handlers
    }
  }

  private stopIdleAndPoll(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private bindFlowEvents(flow: ImapFlowLike): void {
    flow.on('close', () => {
      this.handleClose();
    });

    flow.on('error', (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState('error');
      this.emit('error', error);
    });

    flow.on('exists', (data: unknown) => {
      const info = data as { count?: number; prevCount?: number };
      if (info && typeof info.count === 'number' && typeof info.prevCount === 'number') {
        const newCount = info.count - info.prevCount;
        if (newCount > 0) {
          this.emit('newMail', newCount);
        }
      }
    });
  }

  private handleClose(): void {
    this.stopIdleAndPoll();
    this.cleanupFlow();

    if (this._state === 'disconnected') {
      return;
    }

    this.setState('disconnected');
    this.emit('disconnected', 'unexpected');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.autoReconnect) {
      return;
    }

    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoffMs);

    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private resetBackoff(): void {
    this.backoffMs = MIN_BACKOFF_MS;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupFlow(): void {
    if (this.flow) {
      // FM-002: imapflow.close() rejects every entry in requestTagMap and
      // every pending lock with NoConnection (lib/imap-flow.js:1673-1759).
      // Without this call, in-flight promises in the abandoned flow never
      // reject — old wedged callers stay stuck forever. Synchronous return;
      // the rejection of in-flight promises happens via setImmediate.
      try {
        this.flow.close();
      } catch {
        // best-effort — close() should never throw, but be defensive
      }
      this.flow.removeAllListeners();
      this.flow = null;
    }
    this.specialUseCache.clear();
  }
}
