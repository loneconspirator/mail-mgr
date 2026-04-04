import { ensureConfig, getConfigPath, ConfigRepository } from './config/index.js';
import type { ImapConfig } from './config/index.js';
import { buildServer } from './web/index.js';
import { ActivityLog } from './log/index.js';
import { Monitor } from './monitor/index.js';
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

  const imapClient = new ImapClient(config.imap, createImapFlow);
  let monitor = new Monitor(config, { imapClient, activityLog, logger });

  configRepo.onRulesChange((rules) => {
    monitor.updateRules(rules);
  });

  configRepo.onImapConfigChange(async (newConfig) => {
    await monitor.stop();
    const newClient = new ImapClient(newConfig.imap, createImapFlow);
    monitor = new Monitor(newConfig, { imapClient: newClient, activityLog, logger });
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
