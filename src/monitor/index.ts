import pino from 'pino';
import type { Config, Rule } from '../config/index.js';
import { ImapClient } from '../imap/index.js';
import type { ImapFetchResult } from '../imap/index.js';
import { parseMessage } from '../imap/index.js';
import type { EmailMessage } from '../imap/index.js';
import { evaluateRules } from '../rules/index.js';
import { executeAction } from '../actions/index.js';
import { ActivityLog } from '../log/index.js';

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
  private rules: Rule[];
  private lastUid: number = 0;
  private processing: boolean = false;
  private lastProcessedAt: Date | null = null;
  private messagesProcessed: number = 0;

  constructor(config: Config, deps: MonitorDeps) {
    this.client = deps.imapClient;
    this.activityLog = deps.activityLog;
    this.logger = deps.logger ?? pino({ name: 'monitor' });
    this.rules = config.rules;
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
  }

  /**
   * Stop the monitor gracefully.
   */
  async stop(): Promise<void> {
    this.client.removeAllListeners();
    await this.client.disconnect();
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
        const message = parseMessage(raw as ImapFetchResult);
        if (message.uid > this.lastUid) {
          this.lastUid = message.uid;
        }
        await this.processMessage(message);
      }
    } catch (err) {
      this.logger.error({ err }, 'Error fetching/processing messages');
    } finally {
      this.processing = false;
    }
  }

  /**
   * Evaluate rules against a single message and execute matching action.
   */
  private async processMessage(message: EmailMessage): Promise<void> {
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

    const result = await executeAction(this.client, message, matchedRule);

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

    this.activityLog.logActivity(result, message, matchedRule);
    this.messagesProcessed++;
    this.lastProcessedAt = new Date();
  }
}
