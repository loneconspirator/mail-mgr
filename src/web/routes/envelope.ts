import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import type { EnvelopeStatus } from '../../shared/types.js';
import { ImapClient, probeEnvelopeHeaders } from '../../imap/index.js';
import type { ImapFlowLike } from '../../imap/index.js';
import { ImapFlow } from 'imapflow';

/** Simple in-progress flag to prevent concurrent discovery calls (T-08-01 mitigation) */
let discoveryInProgress = false;

export function registerEnvelopeRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/config/envelope', async (): Promise<EnvelopeStatus> => {
    const config = deps.configRepo.getConfig();
    return { envelopeHeader: config.imap.envelopeHeader ?? null };
  });

  app.post('/api/config/envelope/discover', async (request, reply): Promise<EnvelopeStatus> => {
    if (discoveryInProgress) {
      return reply.status(409).send({ error: 'Discovery already in progress' });
    }

    discoveryInProgress = true;
    try {
      const config = deps.configRepo.getConfig();
      const imapConfig = config.imap;
      const client = new ImapClient(imapConfig, (cfg) =>
        new ImapFlow({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.tls,
          auth: cfg.auth,
          logger: false,
        }) as unknown as ImapFlowLike
      );
      await client.connect();
      const header = await probeEnvelopeHeaders(client);
      await client.disconnect();
      await deps.configRepo.updateImapConfig({ ...imapConfig, envelopeHeader: header ?? undefined });
      return { envelopeHeader: header };
    } catch (err: any) {
      return reply.status(500).send({ error: `Discovery failed: ${err.message}` });
    } finally {
      discoveryInProgress = false;
    }
  });
}
