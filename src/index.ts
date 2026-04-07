import { ensureConfig, getConfigPath, ConfigRepository } from './config/index.js';
import type { ImapConfig } from './config/index.js';
import { buildServer } from './web/index.js';
import { ActivityLog } from './log/index.js';
import { Monitor } from './monitor/index.js';
import { ReviewSweeper } from './sweep/index.js';
import { ImapClient } from './imap/index.js';
import type { ImapFlowLike } from './imap/index.js';
import { ImapFlow } from 'imapflow';
import pino from 'pino';

const logger = pino({ name: 'mail-mgr' });

function createImapFlow(config: ImapConfig): ImapFlowLike {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: config.auth,
    logger: false,
  }) as unknown as ImapFlowLike;
}

async function main(): Promise<void> {
  const configPath = getConfigPath();
  ensureConfig(configPath);

  const configRepo = new ConfigRepository(configPath);
  const config = configRepo.getConfig();

  const activityLog = ActivityLog.fromDataPath();
  activityLog.startAutoPrune();

  let imapClient = new ImapClient(config.imap, createImapFlow);
  let monitor = new Monitor(config, { imapClient, activityLog, logger });

  // H1: Create ReviewSweeper (trash folder resolved after IMAP connect)
  let sweeper = new ReviewSweeper({
    client: imapClient,
    activityLog,
    rules: config.rules,
    reviewConfig: config.review,
    trashFolder: config.review.trashFolder,
    logger,
  });

  configRepo.onRulesChange((rules) => {
    monitor.updateRules(rules);
    sweeper.updateRules(rules);
  });

  // H2: Restart sweeper when review config changes
  configRepo.onReviewConfigChange(async () => {
    const updatedConfig = configRepo.getConfig();
    sweeper.stop();
    const reviewTrash = await imapClient.getSpecialUseFolder('\\Trash')
      ?? updatedConfig.review.trashFolder;
    sweeper = new ReviewSweeper({
      client: imapClient,
      activityLog,
      rules: updatedConfig.rules,
      reviewConfig: updatedConfig.review,
      trashFolder: reviewTrash,
      logger,
    });
    sweeper.start();
  });

  // H3: Stop/rebuild sweeper alongside monitor on IMAP config change
  configRepo.onImapConfigChange(async (newConfig) => {
    sweeper.stop();
    await monitor.stop();
    const newClient = new ImapClient(newConfig.imap, createImapFlow);
    imapClient = newClient;
    monitor = new Monitor(newConfig, { imapClient: newClient, activityLog, logger });
    await monitor.start();
    const newTrash = await newClient.getSpecialUseFolder('\\Trash')
      ?? newConfig.review.trashFolder;
    sweeper = new ReviewSweeper({
      client: newClient,
      activityLog,
      rules: newConfig.rules,
      reviewConfig: newConfig.review,
      trashFolder: newTrash,
      logger,
    });
    sweeper.start();
  });

  // H5: Pass sweeper to buildServer
  const app = buildServer({
    configRepo,
    activityLog,
    monitor,
    sweeper,
  });

  await app.listen({ port: config.server.port, host: config.server.host });
  logger.info('mail-mgr listening on %s:%d', config.server.host, config.server.port);

  // H4: Start sweeper after monitor (resolve trash folder now that IMAP is connected)
  await monitor.start();
  const resolvedTrash = await imapClient.getSpecialUseFolder('\\Trash')
    ?? config.review.trashFolder;
  sweeper = new ReviewSweeper({
    client: imapClient,
    activityLog,
    rules: config.rules,
    reviewConfig: config.review,
    trashFolder: resolvedTrash,
    logger,
  });
  sweeper.start();
}

main().catch((err) => {
  logger.fatal(err, 'fatal error');
  process.exit(1);
});
