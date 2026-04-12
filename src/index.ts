import { ensureConfig, getConfigPath, ConfigRepository } from './config/index.js';
import type { ImapConfig } from './config/index.js';
import { buildServer } from './web/index.js';
import { ActivityLog } from './log/index.js';
import { Monitor } from './monitor/index.js';
import { ImapClient, probeEnvelopeHeaders } from './imap/index.js';
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
  let config = configRepo.getConfig();

  const activityLog = ActivityLog.fromDataPath();
  activityLog.startAutoPrune();

  const imapClient = new ImapClient(config.imap, createImapFlow);
  await imapClient.connect();

  // Run envelope header discovery on startup
  try {
    const discoveredHeader = await probeEnvelopeHeaders(imapClient);
    if (discoveredHeader !== (config.imap.envelopeHeader ?? null)) {
      await configRepo.updateImapConfig({ ...config.imap, envelopeHeader: discoveredHeader ?? undefined });
      // Reload config after update
      const updatedConfig = configRepo.getConfig();
      config = updatedConfig;
    }
  } catch (err) {
    logger.error(err, 'envelope header discovery failed on startup, continuing without');
  }

  let monitor = new Monitor(config, { imapClient, activityLog, logger });

  configRepo.onRulesChange((rules) => {
    monitor.updateRules(rules);
  });

  configRepo.onImapConfigChange(async (newConfig) => {
    await monitor.stop();
    const newClient = new ImapClient(newConfig.imap, createImapFlow);
    await newClient.connect();

    // Run envelope header discovery on config change
    try {
      const discoveredHeader = await probeEnvelopeHeaders(newClient);
      if (discoveredHeader !== (newConfig.imap.envelopeHeader ?? null)) {
        await configRepo.updateImapConfig({ ...newConfig.imap, envelopeHeader: discoveredHeader ?? undefined });
      }
    } catch (err) {
      logger.error(err, 'envelope header discovery failed on config change, continuing without');
    }

    const latestConfig = configRepo.getConfig();
    monitor = new Monitor(latestConfig, { imapClient: newClient, activityLog, logger });
    await monitor.start();
  });

  const app = buildServer({
    configRepo,
    activityLog,
    monitor,
  });

  await app.listen({ port: config.server.port, host: config.server.host });
  logger.info('mail-mgr listening on %s:%d', config.server.host, config.server.port);

  await monitor.start();
}

main().catch((err) => {
  logger.fatal(err, 'fatal error');
  process.exit(1);
});
