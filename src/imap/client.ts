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

export interface ImapFlowLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  mailboxOpen(path: string | string[]): Promise<unknown>;
  getMailboxLock(path: string | string[]): Promise<MailboxLock>;
  messageMove(range: number[] | string, destination: string, options?: { uid?: boolean }): Promise<unknown>;
  mailboxCreate(path: string | string[]): Promise<unknown>;
  fetch(range: string, query: Record<string, unknown>, options?: { uid?: boolean }): AsyncIterable<unknown>;
  list(options?: Record<string, unknown>): Promise<unknown[]>;
  status(path: string, query: Record<string, boolean>): Promise<Record<string, number>>;
  listTree(options?: Record<string, unknown>): Promise<unknown>;
  noop(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeAllListeners(event?: string): this;
  usable: boolean;
  idleSupported?: boolean;
}

export type ImapFlowFactory = (config: ImapConfig) => ImapFlowLike;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

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
      await this.flow.connect();
      await this.flow.mailboxOpen('INBOX');

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
        await this.flow.logout();
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

  async withMailboxLock<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T> {
    if (!this.flow) throw new Error('Not connected');
    const lock = await this.flow.getMailboxLock(folder);
    try {
      return await fn(this.flow);
    } finally {
      lock.release();
    }
  }

  async withMailboxSwitch<T>(folder: string, fn: (flow: ImapFlowLike) => Promise<T>): Promise<T> {
    if (!this.flow) throw new Error('Not connected');

    this.stopIdleAndPoll();

    const lock = await this.flow.getMailboxLock(folder);
    try {
      return await fn(this.flow);
    } finally {
      lock.release();
      try {
        await this.flow!.mailboxOpen('INBOX');
      } catch {
        // best-effort reopen
      }
      this.startIdleOrPoll();
    }
  }

  async moveMessage(uid: number, destination: string, sourceFolder: string = 'INBOX'): Promise<void> {
    await this.withMailboxLock(sourceFolder, async (flow) => {
      await flow.messageMove([uid], destination, { uid: true });
    });
  }

  async createMailbox(path: string): Promise<void> {
    await this.withMailboxLock('INBOX', async (flow) => {
      await flow.mailboxCreate(path);
    });
  }

  async getSpecialUseFolder(use: string): Promise<string | null> {
    if (this.specialUseCache.has(use)) {
      return this.specialUseCache.get(use)!;
    }

    if (!this.flow) throw new Error('Not connected');

    const mailboxes = await this.flow.list();
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
    if (!this.flow) throw new Error('Not connected');
    const results: unknown[] = [];
    for await (const msg of this.flow.fetch(range, query, { uid: true })) {
      results.push(msg);
    }
    return results;
  }

  /** Return the header field names to fetch, or undefined if not configured. */
  private getHeaderFields(): string[] | undefined {
    if (!this.config.envelopeHeader) return undefined;
    return [this.config.envelopeHeader, 'List-Id'];
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
    });
  }

  async fetchAllMessages(folder: string): Promise<ReviewMessage[]> {
    return this.withMailboxLock(folder, async () => {
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
    });
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

    let envelopeRecipient: string | undefined;
    let visibility: Visibility | undefined;

    if (this.config.envelopeHeader && msg.headers) {
      const hdrs = parseHeaderLines(msg.headers);
      const recipientVal = hdrs.get(this.config.envelopeHeader.toLowerCase());
      if (recipientVal && recipientVal.includes('@')) {
        envelopeRecipient = recipientVal;
      }
      const listId = hdrs.get('list-id');
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
    };
  }

  /** List all IMAP folders as a nested tree of FolderNode. */
  async listFolders(): Promise<FolderNode[]> {
    if (!this.flow) throw new Error('Not connected');
    const tree = await this.flow.listTree() as { folders?: unknown[] };
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
    if (this._state !== 'connected' || !this.flow?.usable) {
      return;
    }

    try {
      await this.flow.noop();
    } catch {
      // noop failure will trigger error/close handlers
    }

    // Schedule the next cycle
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
      this.flow.removeAllListeners();
      this.flow = null;
    }
    this.specialUseCache.clear();
  }
}
