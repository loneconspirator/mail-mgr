import { ensureConfig, getConfigPath, saveConfig, ConfigRepository } from './config/index.js';
import type { ImapConfig } from './config/index.js';
import { buildServer } from './web/index.js';
import { ActivityLog } from './log/index.js';
import { Monitor } from './monitor/index.js';
import { ReviewSweeper } from './sweep/index.js';
import { ImapClient, probeEnvelopeHeaders } from './imap/index.js';
import type { ImapFlowLike } from './imap/index.js';
import { FolderCache } from './folders/index.js';
import { BatchEngine } from './batch/index.js';
import { MoveTracker } from './tracking/index.js';
import { SignalStore } from './tracking/signals.js';
import { DestinationResolver } from './tracking/destinations.js';
import { ProposalStore } from './tracking/proposals.js';
import { PatternDetector } from './tracking/detector.js';
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
  setInterval(() => signalStore.prune(), 24 * 60 * 60 * 1000).unref();

  // H5b: ProposalStore and PatternDetector for behavioral learning
  const proposalStore = new ProposalStore(activityLog.getDb());
  const patternDetector = new PatternDetector(proposalStore);

  let imapClient = new ImapClient(config.imap, createImapFlow);
  let folderCache = new FolderCache({ imapClient, ttlMs: 300_000 });
  let monitor = new Monitor(config, { imapClient, activityLog, logger });
  let moveTracker: MoveTracker | undefined;

  // H1: Create ReviewSweeper (trash folder resolved after IMAP connect)
  let sweeper: ReviewSweeper | undefined = new ReviewSweeper({
    client: imapClient,
    activityLog,
    rules: config.rules,
    reviewConfig: config.review,
    trashFolder: config.review.trashFolder,
    logger,
  });

  // H1b: Create BatchEngine for retroactive rule application
  let batchEngine = new BatchEngine({
    client: imapClient,
    activityLog,
    rules: config.rules,
    trashFolder: config.review.trashFolder,
    reviewFolder: config.review.folder,
    reviewConfig: config.review,
    logger,
  });

  configRepo.onRulesChange((rules) => {
    monitor.updateRules(rules);
    if (sweeper) sweeper.updateRules(rules);
    batchEngine.updateRules(rules);
  });

  // H2: Restart sweeper when review config changes
  configRepo.onReviewConfigChange(async () => {
    const updatedConfig = configRepo.getConfig();
    if (sweeper) sweeper.stop();
    sweeper = undefined;  // Signal "rebuilding" to getSweeper() callers
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
    batchEngine = new BatchEngine({
      client: imapClient,
      activityLog,
      rules: updatedConfig.rules,
      trashFolder: reviewTrash,
      reviewFolder: updatedConfig.review.folder,
      reviewConfig: updatedConfig.review,
      logger,
    });
  });

  // H3: Stop/rebuild sweeper, monitor, and moveTracker on IMAP config change
  configRepo.onImapConfigChange(async (newConfig) => {
    if (sweeper) sweeper.stop();
    sweeper = undefined;
    if (moveTracker) moveTracker.stop();
    moveTracker = undefined;
    await monitor.stop();

    await imapClient.disconnect();

    const newClient = new ImapClient(newConfig.imap, createImapFlow);
    imapClient = newClient;
    folderCache = new FolderCache({ imapClient: newClient, ttlMs: 300_000 });

    // H3a: Run envelope header discovery before Monitor starts (D-01, D-03)
    await newClient.connect();
    let discoveredHeader: string | null = null;
    try {
      discoveredHeader = await probeEnvelopeHeaders(newClient);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ error }, 'envelope header discovery failed, continuing without');
    }

    // H3b: Persist discovered header (or clear it) in config (D-04)
    const cfg = configRepo.getConfig();
    cfg.imap.envelopeHeader = discoveredHeader ?? undefined;
    saveConfig(configPath, cfg);

    // H3c: Rebuild monitor with updated config that includes envelopeHeader
    const updatedConfig = configRepo.getConfig();
    monitor = new Monitor(updatedConfig, { imapClient: newClient, activityLog, logger });
    await monitor.start();
    const newTrash = await newClient.getSpecialUseFolder('\\Trash')
      ?? updatedConfig.review.trashFolder;
    sweeper = new ReviewSweeper({
      client: newClient,
      activityLog,
      rules: updatedConfig.rules,
      reviewConfig: updatedConfig.review,
      trashFolder: newTrash,
      logger,
    });
    batchEngine = new BatchEngine({
      client: newClient,
      activityLog,
      rules: updatedConfig.rules,
      trashFolder: newTrash,
      reviewFolder: updatedConfig.review.folder,
      reviewConfig: updatedConfig.review,
      logger,
    });
    sweeper.start();

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
      reviewFolder: updatedConfig.review.folder,
      scanIntervalMs: updatedConfig.review.moveTracking.scanInterval * 1000,
      enabled: updatedConfig.review.moveTracking.enabled,
      patternDetector,
      logger,
    });
    moveTracker.start();
  });

  // H5: Pass getter functions so routes always read the current instance
  const app = buildServer({
    configRepo,
    activityLog,
    getMonitor: () => monitor,
    getSweeper: () => sweeper,
    getFolderCache: () => folderCache,
    getBatchEngine: () => batchEngine,
    getMoveTracker: () => moveTracker,
    getProposalStore: () => proposalStore,
  });

  await app.listen({ port: config.server.port, host: config.server.host });
  logger.info('mail-mgr listening on %s:%d', config.server.host, config.server.port);

  // Register error listener before connect to avoid unhandled error events
  imapClient.on('error', (err) => {
    logger.error({ err }, 'IMAP error');
  });

  // H4a: Run initial envelope header discovery before Monitor starts (D-01, D-03)
  await imapClient.connect();
  let initialHeader: string | null = null;
  try {
    initialHeader = await probeEnvelopeHeaders(imapClient);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ error }, 'initial envelope header discovery failed');
  }

  if (initialHeader !== config.imap.envelopeHeader) {
    config.imap.envelopeHeader = initialHeader ?? undefined;
    saveConfig(configPath, config);
    // Rebuild monitor with updated config that includes envelopeHeader
    monitor = new Monitor(config, { imapClient, activityLog, logger });
  }

  // H4b: Start sweeper after monitor (resolve trash folder now that IMAP is connected)
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
    scanIntervalMs: config.review.moveTracking.scanInterval * 1000,
    enabled: config.review.moveTracking.enabled,
    patternDetector,
    logger,
  });
  moveTracker.start();
}

main().catch((err) => {
  logger.fatal(err, 'fatal error');
  process.exit(1);
});
