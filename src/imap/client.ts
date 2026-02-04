import { EventEmitter } from 'events';
import type { ImapConfig } from '../config/index.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ImapClientEvents {
  connected: [];
  disconnected: [reason?: string];
  error: [error: Error];
  newMail: [count: number];
}

export interface ImapFlowLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  mailboxOpen(path: string | string[]): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeAllListeners(event?: string): this;
  usable: boolean;
}

export type ImapFlowFactory = (config: ImapConfig) => ImapFlowLike;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export class ImapClient extends EventEmitter<ImapClientEvents> {
  private flow: ImapFlowLike | null = null;
  private _state: ConnectionState = 'disconnected';
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private autoReconnect = true;
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
      this.emit('connected');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState('error');
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.autoReconnect = false;
    this.clearReconnectTimer();

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
  }
}
