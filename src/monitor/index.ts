/**
 * MOD-0001 Monitor — interface schema.
 *
 * Public surface for the arrival processing pipeline. See
 * specs/modules/mod-0001-monitor.md for the canonical interface contract,
 * dependencies, and notes. Architecture lives at
 * specs/architecture.md#core-processing. Participates in IX-001 (arrival
 * detection and rule evaluation) and IX-002 (action execution and activity
 * logging).
 */
import pino from 'pino';
import type { Config, Rule } from '../config/index.js';
import { ImapClient } from '../imap/index.js';
import type { ImapFetchResult } from '../imap/index.js';
import { parseMessage } from '../imap/index.js';
import type { EmailMessage } from '../imap/index.js';
import { evaluateRules } from '../rules/index.js';
import { executeAction } from '../actions/index.js';
import type { ActionContext } from '../actions/index.js';
import { ActivityLog } from '../log/index.js';
import { isSentinel } from '../sentinel/index.js';

export interface MonitorState {
  connectionStatus: string;
  lastProcessedAt: Date | null;
  messagesProcessed: number;
}

export interface MonitorDeps {
  imapClient: ImapClient;
  activityLog: ActivityLog;
  logger?: pino.Logger;
}

export class Monitor {
  private readonly client: ImapClient;
  private readonly activityLog: ActivityLog;
  private readonly logger: pino.Logger;
  private readonly reviewFolder: string;
  private readonly trashFolder: string;
  private rules: Rule[];
  private envelopeHeader: string | undefined;
  private lastUid: number;
  private cursorEnabled: boolean;
  private processing: boolean = false;
  private lastProcessedAt: Date | null = null;
  private messagesProcessed: number = 0;

  constructor(config: Config, deps: MonitorDeps) {
    this.client = deps.imapClient;
    this.activityLog = deps.activityLog;
    this.logger = deps.logger ?? pino({ name: 'monitor' });
    this.reviewFolder = config.review.folder;
    this.trashFolder = config.review.trashFolder;
    this.rules = config.rules;
    this.envelopeHeader = config.imap.envelopeHeader;
    const cursorEnabled = this.activityLog.getState('cursorEnabled');
    this.cursorEnabled = cursorEnabled !== 'false';  // default: enabled
    if (this.cursorEnabled) {
      const saved = this.activityLog.getState('lastUid');
      this.lastUid = saved ? parseInt(saved, 10) : 0;
    } else {
      this.lastUid = 0;  // Full re-evaluation on restart
    }
  }

  /**
   * Replace the active rule set (e.g. after config reload).
   */
  updateRules(rules: Rule[]): void {
    this.rules = rules;
  }

  /**
   * Get current monitor state for the web UI.
   */
  getState(): MonitorState {
    return {
      connectionStatus: this.client.state,
      lastProcessedAt: this.lastProcessedAt,
      messagesProcessed: this.messagesProcessed,
    };
  }

  /**
   * Start the monitor: connect, do initial scan, listen for new mail.
   */
  async start(): Promise<void> {
    this.client.on('newMail', () => {
      this.processNewMessages();
    });

    this.client.on('connected', () => {
      this.logger.info('IMAP connected, running initial scan');
      this.processNewMessages();
    });

    this.client.on('error', (err) => {
      this.logger.error({ err }, 'IMAP error');
    });

    await this.client.connect();

    // If already connected (e.g. connect() was called before start()),
    // the 'connected' event already fired before we registered our listener.
    // Trigger the initial scan explicitly.
    if (this.client.state === 'connected') {
      this.logger.info('IMAP already connected, running initial scan');
      this.processNewMessages();
    }
  }

  /**
   * Stop the monitor gracefully.
   */
  async stop(): Promise<void> {
    this.client.removeAllListeners();
    // Do NOT disconnect — client is shared with other consumers
    // (action folder poller, getSpecialUseFolder, etc.)
    // Caller is responsible for client lifecycle.
  }

  /**
   * Fetch and process any new messages since lastUid.
   * Serialized — if already processing, skip.
   */
  async processNewMessages(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const fetched = await this.client.fetchNewMessages(this.lastUid);

      for (const raw of fetched) {
        const message = parseMessage(raw as ImapFetchResult, this.envelopeHeader);
        try {
          await this.processMessage(message);
          if (message.uid > this.lastUid) {
            this.lastUid = message.uid;
            if (this.cursorEnabled) {
              this.activityLog.setState('lastUid', String(this.lastUid));
            }
          }
        } catch (err) {
          this.logger.error({ err, uid: message.uid }, 'Error processing message');
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Error fetching messages');
    } finally {
      this.processing = false;
    }
  }

  /**
   * Evaluate rules against a single message and execute matching action.
   */
  private async processMessage(message: EmailMessage): Promise<void> {
    // Per D-08: guard before evaluateRules
    if (isSentinel(message.headers)) {
      this.logger.debug({ uid: message.uid }, 'Skipping sentinel message');
      return;
    }

    this.logger.info(
      { uid: message.uid, from: message.from.address, subject: message.subject },
      'Processing message',
    );

    const matchedRule = evaluateRules(this.rules, message);

    if (!matchedRule) {
      this.logger.debug({ uid: message.uid }, 'No rule matched, leaving in inbox');
      this.messagesProcessed++;
      this.lastProcessedAt = new Date();
      return;
    }

    this.logger.info(
      { uid: message.uid, rule: matchedRule.id, action: matchedRule.action },
      'Rule matched',
    );

    const ctx: ActionContext = {
      client: this.client,
      reviewFolder: this.reviewFolder,
      trashFolder: this.trashFolder,
    };
    const result = await executeAction(ctx, message, matchedRule);

    if (result.success) {
      this.logger.info(
        { uid: message.uid, rule: matchedRule.id, folder: result.folder },
        'Action executed successfully',
      );
    } else {
      this.logger.error(
        { uid: message.uid, rule: matchedRule.id, error: result.error },
        'Action failed',
      );
    }

    this.activityLog.logActivity(result, message, matchedRule, 'arrival');
    this.messagesProcessed++;
    this.lastProcessedAt = new Date();
  }
}
