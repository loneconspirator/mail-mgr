import type { ImapClient, ImapFlowLike } from '../imap/index.js';
import type { ActivityLog } from '../log/index.js';
import type { SignalStore, MoveSignalInput } from './signals.js';
import type { DestinationResolver } from './destinations.js';
import type pino from 'pino';

export interface MoveTrackerDeps {
  client: ImapClient;
  activityLog: ActivityLog;
  signalStore: SignalStore;
  destinationResolver: DestinationResolver;
  inboxFolder: string;
  reviewFolder: string;
  scanIntervalMs: number;
  enabled: boolean;
  logger?: pino.Logger;
}

export interface MoveTrackerState {
  enabled: boolean;
  lastScanAt: string | null;
  messagesTracked: number;
  signalsLogged: number;
  pendingDeepScan: number;
}

interface TrackedMessage {
  uid: number;
  messageId: string;
  sender: string;
  envelopeRecipient?: string;
  listId?: string;
  subject: string;
  readStatus: 'read' | 'unread';
  visibility?: string;
}

interface FolderSnapshot {
  uidValidity: number;
  messages: TrackedMessage[];
}

/**
 * Detects user-initiated moves by comparing UID snapshots across scans.
 * System moves (from Monitor/Sweep/Batch) are excluded via activity log cross-reference.
 * Two-scan confirmation prevents race conditions with concurrent processes.
 */
export class MoveTracker {
  private deps: MoveTrackerDeps;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private deepScanTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastScanAt: string | null = null;
  private messagesTracked = 0;
  private signalsLoggedCount = 0;

  /** Messages missing in scan N, awaiting scan N+1 confirmation. Keyed by "folder:uid". */
  private pendingConfirmation: Map<string, TrackedMessage & { sourceFolder: string }> = new Map();

  /** Metadata for messages awaiting deep-scan destination resolution. Keyed by messageId. */
  private pendingDeepScanMeta: Map<string, TrackedMessage & { sourceFolder: string }> = new Map();

  constructor(deps: MoveTrackerDeps) {
    this.deps = deps;
  }

  /** Start the scan loop and deep scan timer. Does nothing if enabled=false. */
  start(): void {
    if (!this.deps.enabled) {
      return;
    }

    this.stop();

    // Fire-and-forget first scan
    this.runScan().catch((err) => {
      this.deps.logger?.error({ error: err }, 'MoveTracker initial scan failed');
    });

    this.scanTimer = setInterval(() => {
      this.runScan().catch((err) => {
        this.deps.logger?.error({ error: err }, 'MoveTracker scan failed');
      });
    }, this.deps.scanIntervalMs);

    this.deepScanTimer = setInterval(() => {
      this.runDeepScan().catch((err) => {
        this.deps.logger?.error({ error: err }, 'MoveTracker deep scan failed');
      });
    }, 15 * 60 * 1000);
  }

  /** Stop all timers. */
  stop(): void {
    if (this.scanTimer !== null) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.deepScanTimer !== null) {
      clearInterval(this.deepScanTimer);
      this.deepScanTimer = null;
    }
  }

  /** Return current tracker status snapshot. */
  getState(): MoveTrackerState {
    return {
      enabled: this.deps.enabled,
      lastScanAt: this.lastScanAt,
      messagesTracked: this.messagesTracked,
      signalsLogged: this.signalsLoggedCount,
      pendingDeepScan: this.countPendingDeepScan(),
    };
  }

  /** Exposed for testing -- runs a single scan cycle. */
  async runScanForTest(): Promise<void> {
    return this.runScan();
  }

  /** Main scan loop: compare current UIDs against previous snapshot. */
  private async runScan(): Promise<void> {
    if (this.running || this.deps.client.state !== 'connected') {
      return;
    }

    this.running = true;
    try {
      let totalTracked = 0;

      for (const folder of [this.deps.inboxFolder, this.deps.reviewFolder]) {
        const tracked = await this.scanFolder(folder);
        totalTracked += tracked;
      }

      this.messagesTracked = totalTracked;
      this.lastScanAt = new Date().toISOString();
    } finally {
      this.running = false;
    }
  }

  /** Scan a single folder: fetch UIDs, diff against snapshot, process disappearances. */
  private async scanFolder(folder: string): Promise<number> {
    const stateKey = `tracking:${folder}:snapshot`;

    // Fetch current messages and uidValidity
    const { messages: currentMessages, uidValidity: currentUidValidity } =
      await this.fetchFolderState(folder);

    // Load previous snapshot
    const prevRaw = this.deps.activityLog.getState(stateKey);
    const prevSnapshot: FolderSnapshot | null = prevRaw ? JSON.parse(prevRaw) : null;

    // UIDVALIDITY check: if changed, re-baseline without diffing
    if (prevSnapshot && prevSnapshot.uidValidity !== currentUidValidity) {
      this.deps.logger?.info(
        { folder, oldValidity: prevSnapshot.uidValidity, newValidity: currentUidValidity },
        'UIDVALIDITY changed, re-baselining snapshot',
      );
      this.saveSnapshot(stateKey, currentUidValidity, currentMessages);
      return currentMessages.size;
    }

    // First-run baseline: save and skip diffing
    if (!prevSnapshot) {
      this.saveSnapshot(stateKey, currentUidValidity, currentMessages);
      return currentMessages.size;
    }

    // Diff: find disappeared UIDs
    const currentUids = new Set(currentMessages.keys());

    // Step 1: Check existing pendingConfirmation entries BEFORE adding new ones
    // This ensures two-scan confirmation: messages must be missing across two consecutive scans
    for (const [key, entry] of this.pendingConfirmation) {
      if (entry.sourceFolder !== folder) continue;

      if (currentUids.has(entry.uid)) {
        // Message reappeared -- cancel pending confirmation
        this.pendingConfirmation.delete(key);
      } else {
        // Still missing on consecutive scan -- confirmed user move
        await this.confirmDisappearedMessage(key, entry, folder);
      }
    }

    // Step 2: Add newly disappeared messages to pendingConfirmation
    for (const prevMsg of prevSnapshot.messages) {
      if (!currentUids.has(prevMsg.uid)) {
        await this.handleDisappearedMessage(prevMsg, folder);
      }
    }

    // Save current snapshot
    this.saveSnapshot(stateKey, currentUidValidity, currentMessages);

    return currentMessages.size;
  }

  /** Handle a newly disappeared message: cross-reference and add to pending. */
  private async handleDisappearedMessage(msg: TrackedMessage, folder: string): Promise<void> {
    // Cross-reference activity log: skip system moves
    if (this.deps.activityLog.isSystemMove(msg.messageId)) {
      return;
    }

    const confirmKey = `${folder}:${msg.uid}`;

    // Two-scan confirmation: first detection -> add to pending only
    if (!this.pendingConfirmation.has(confirmKey)) {
      this.pendingConfirmation.set(confirmKey, { ...msg, sourceFolder: folder });
    }
  }

  /** Confirm a message that was missing across two consecutive scans. */
  private async confirmDisappearedMessage(
    key: string,
    entry: TrackedMessage & { sourceFolder: string },
    folder: string,
  ): Promise<void> {
    this.pendingConfirmation.delete(key);

    const destination = await this.deps.destinationResolver.resolveFast(
      entry.messageId,
      folder,
    );

    if (destination) {
      this.logSignal(entry, folder, destination);
    } else {
      this.pendingDeepScanMeta.set(entry.messageId, { ...entry, sourceFolder: folder });
      this.deps.destinationResolver.enqueueDeepScan(entry.messageId, folder);
    }
  }

  /** Manually trigger a deep scan and return how many messages were resolved. */
  async triggerDeepScan(): Promise<{ resolved: number }> {
    const results = await this.deps.destinationResolver.runDeepScan();

    for (const [messageId, destinationFolder] of results) {
      const entry = this.pendingDeepScanMeta.get(messageId);
      if (entry) {
        this.logSignal(entry, entry.sourceFolder, destinationFolder);
        this.pendingDeepScanMeta.delete(messageId);
      }
    }
    const resolved = results.size;
    // D-06: Messages not resolved by deep scan are dropped
    this.pendingDeepScanMeta.clear();
    return { resolved };
  }

  /** Run deep scan and log signals for resolved messages. */
  private async runDeepScan(): Promise<void> {
    await this.triggerDeepScan();
  }

  /** Create a signal from a confirmed move. */
  private logSignal(
    msg: TrackedMessage & { sourceFolder: string },
    sourceFolder: string,
    destinationFolder: string,
  ): void {
    const input: MoveSignalInput = {
      messageId: msg.messageId,
      sender: msg.sender,
      envelopeRecipient: msg.envelopeRecipient,
      listId: msg.listId,
      subject: msg.subject,
      readStatus: msg.readStatus,
      visibility: msg.visibility,
      sourceFolder,
      destinationFolder,
    };

    this.deps.signalStore.logSignal(input);
    this.signalsLoggedCount++;
  }

  /** Fetch all messages in a folder with their envelope data. */
  private async fetchFolderState(
    folder: string,
  ): Promise<{ messages: Map<number, TrackedMessage>; uidValidity: number }> {
    return this.deps.client.withMailboxLock(folder, async (flow: ImapFlowLike) => {
      const mailboxInfo = (flow as unknown as { mailbox?: { uidValidity?: number } }).mailbox;
      const uidValidity = mailboxInfo?.uidValidity ?? 0;

      const messages = new Map<number, TrackedMessage>();

      for await (const raw of flow.fetch('1:*', { uid: true, envelope: true, flags: true }, { uid: true })) {
        const msg = raw as {
          uid: number;
          envelope?: {
            messageId?: string;
            from?: Array<{ address?: string }>;
            to?: Array<{ address?: string }>;
            cc?: Array<{ address?: string }>;
            subject?: string;
          };
          flags?: Set<string>;
        };

        const flags = msg.flags ?? new Set<string>();
        const from = msg.envelope?.from?.[0];

        const tracked: TrackedMessage = {
          uid: msg.uid,
          messageId: msg.envelope?.messageId ?? '',
          sender: from?.address ?? '',
          subject: msg.envelope?.subject ?? '',
          readStatus: flags.has('\\Seen') ? 'read' : 'unread',
        };

        messages.set(msg.uid, tracked);
      }

      return { messages, uidValidity };
    });
  }

  /** Save a folder snapshot to persisted state. */
  private saveSnapshot(
    stateKey: string,
    uidValidity: number,
    messages: Map<number, TrackedMessage>,
  ): void {
    const snapshot: FolderSnapshot = {
      uidValidity,
      messages: Array.from(messages.values()),
    };
    this.deps.activityLog.setState(stateKey, JSON.stringify(snapshot));
  }

  /** Count messages currently enqueued for deep scan. */
  private countPendingDeepScan(): number {
    return this.pendingDeepScanMeta.size;
  }
}
