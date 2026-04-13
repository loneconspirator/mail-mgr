import { ensureConfig, getConfigPath, ConfigRepository } from './config/index.js';
import type { ImapConfig } from './config/index.js';
import { buildServer } from './web/index.js';
import { ActivityLog } from './log/index.js';
import { Monitor } from './monitor/index.js';
import { ImapClient } from './imap/index.js';
import type { ImapFlowLike } from './imap/index.js';
import { MoveTracker } from './tracking/index.js';
import { SignalStore } from './tracking/signals.js';
import { DestinationResolver } from './tracking/destinations.js';
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

  // H5: SignalStore for move tracking (shared DB with ActivityLog)
  const signalStore = new SignalStore(activityLog.getDb());
  signalStore.prune();
  const signalPruneInterval = setInterval(() => signalStore.prune(), 24 * 60 * 60 * 1000);

  const imapClient = new ImapClient(config.imap, createImapFlow);
  let monitor = new Monitor(config, { imapClient, activityLog, logger });
  let moveTracker: MoveTracker | undefined;

  configRepo.onRulesChange((rules) => {
    monitor.updateRules(rules);
  });

  configRepo.onImapConfigChange(async (newConfig) => {
    // Stop existing components
    await monitor.stop();
    if (moveTracker) moveTracker.stop();
    moveTracker = undefined;

    // Rebuild with new IMAP client
    const newClient = new ImapClient(newConfig.imap, createImapFlow);
    monitor = new Monitor(newConfig, { imapClient: newClient, activityLog, logger });
    await monitor.start();

    // Rebuild MoveTracker with new client
    const newDestResolver = new DestinationResolver({
      client: newClient,
      activityLog,
      listFolders: () => newClient.listMailboxes(),
      logger,
    });
    moveTracker = new MoveTracker({
      client: newClient,
      activityLog,
      signalStore,
      destinationResolver: newDestResolver,
      inboxFolder: 'INBOX',
      reviewFolder: newConfig.review.folder,
      scanIntervalMs: (newConfig.review.moveTracking?.scanInterval ?? 30) * 1000,
      enabled: newConfig.review.moveTracking?.enabled ?? true,
      logger,
    });
    moveTracker.start();
  });

  const app = buildServer({
    configRepo,
    activityLog,
    monitor,
    getMoveTracker: () => moveTracker,
  });

  await app.listen({ port: config.server.port, host: config.server.host });
  logger.info('mail-mgr listening on %s:%d', config.server.host, config.server.port);

  await monitor.start();

  // H6: Create MoveTracker for user move detection
  const destinationResolver = new DestinationResolver({
    client: imapClient,
    activityLog,
    listFolders: () => imapClient.listMailboxes(),
    logger,
  });
  moveTracker = new MoveTracker({
    client: imapClient,
    activityLog,
    signalStore,
    destinationResolver,
    inboxFolder: 'INBOX',
    reviewFolder: config.review.folder,
    scanIntervalMs: (config.review.moveTracking?.scanInterval ?? 30) * 1000,
    enabled: config.review.moveTracking?.enabled ?? true,
    logger,
  });
  moveTracker.start();
}

main().catch((err) => {
  logger.fatal(err, 'fatal error');
  process.exit(1);
});
