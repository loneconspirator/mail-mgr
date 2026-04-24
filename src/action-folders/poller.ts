import type { ImapClient } from '../imap/client.js';
import type { ConfigRepository } from '../config/repository.js';
import type { ActionFolderProcessor } from './processor.js';
import type { Logger } from 'pino';
import type { ActionType } from './registry.js';
import { ACTION_REGISTRY } from './registry.js';
import { reviewMessageToEmailMessage } from '../imap/messages.js';

export interface ActionFolderPollerDeps {
  client: ImapClient;
  configRepo: ConfigRepository;
  processor: ActionFolderProcessor;
  logger: Logger;
  pollIntervalMs: number;
}

export class ActionFolderPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(private readonly deps: ActionFolderPollerDeps) {}

  async scanAll(): Promise<void> {
    if (this.processing) {
      this.deps.logger.debug('Action folder poll skipped (already processing)');
      return;
    }
    this.processing = true;
    try {
      const config = this.deps.configRepo.getActionFolderConfig();
      if (!config.enabled) return;

      const folders = this.getActionFolderPaths(config);

      for (const { path, actionType } of folders) {
        try {
          const { messages } = await this.deps.client.status(path);
          if (messages === 0) continue;

          this.deps.logger.info({ folder: path, count: messages }, 'Processing action folder');
          const rawMessages = await this.deps.client.fetchAllMessages(path);

          let sentinelCount = 0;
          for (const raw of rawMessages) {
            const msg = reviewMessageToEmailMessage(raw);
            const result = await this.deps.processor.processMessage(msg, actionType);
            if (result.ok && result.sender === 'sentinel') sentinelCount++;
          }

          // FOLD-02: Verify always-empty invariant
          // Skip retry if every message was a sentinel — sentinels stay in the folder by design
          if (sentinelCount === rawMessages.length) {
            this.deps.logger.debug({ folder: path, sentinels: sentinelCount }, 'All messages are sentinels, skipping retry');
          } else {
            const recheck = await this.deps.client.status(path);
            if (recheck.messages > 0) {
              this.deps.logger.warn({ folder: path, remaining: recheck.messages }, 'Messages remain after processing, retrying');
              const retryMessages = await this.deps.client.fetchAllMessages(path);
              for (const raw of retryMessages) {
                const msg = reviewMessageToEmailMessage(raw);
                await this.deps.processor.processMessage(msg, actionType);
              }
              const finalCheck = await this.deps.client.status(path);
              // Subtract expected sentinels from remaining count
              if (finalCheck.messages > sentinelCount) {
                this.deps.logger.warn({ folder: path, remaining: finalCheck.messages, sentinels: sentinelCount }, 'Non-sentinel messages still remain after retry');
              }
            }
          }
        } catch (err) {
          this.deps.logger.error({ err, folder: path }, 'Error processing action folder');
        }
      }
    } finally {
      this.processing = false;
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      this.scanAll().catch(err => this.deps.logger.error({ err }, 'Action folder poll failed'));
    }, this.deps.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getActionFolderPaths(config: { prefix: string; folders: Record<string, string> }): Array<{ path: string; actionType: ActionType }> {
    return (Object.entries(ACTION_REGISTRY) as [ActionType, { folderConfigKey: string }][]).map(
      ([actionType, def]) => ({
        path: `${config.prefix}/${config.folders[def.folderConfigKey]}`,
        actionType,
      })
    );
  }
}
