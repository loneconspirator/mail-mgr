import { loadConfig, ensureConfig, getConfigPath } from './config/index.js';
import pino from 'pino';

const logger = pino({ name: 'mail-mgr' });

async function main(): Promise<void> {
  const configPath = getConfigPath();
  ensureConfig(configPath);
  const config = loadConfig(configPath);
  logger.info('mail-mgr starting on %s:%d', config.server.host, config.server.port);
}

main().catch((err) => {
  logger.fatal(err, 'fatal error');
  process.exit(1);
});
