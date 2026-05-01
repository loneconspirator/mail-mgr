/**
 * HTTP BASIC auth onRequest hook for the Fastify web server.
 *
 * Sourced from WEB_AUTH_USER / WEB_AUTH_PASS env vars. Fail-closed: if either
 * is unset/empty after trim, readAuthCredsOrThrow throws synchronously so
 * buildServer refuses to start. The /healthz endpoint (HEALTH_PATH) is
 * intentionally skipped for container health probes.
 *
 * Password comparison uses crypto.timingSafeEqual; mismatched-length inputs
 * are compared against a same-length dummy buffer (then AND-masked with the
 * length-equal flag) to avoid both the timingSafeEqual length-mismatch throw
 * and any obvious length-leak side channel.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply, onRequestAsyncHookHandler } from 'fastify';

export const HEALTH_PATH = '/healthz';

const REALM = 'Basic realm="mail-mgr"';

/**
 * Reads WEB_AUTH_USER and WEB_AUTH_PASS from process.env. Throws an Error if
 * either is missing or empty (after trimming whitespace). Trimmed values are
 * returned. Called synchronously inside buildServer so a misconfigured deploy
 * fails fast at startup rather than silently running unauthenticated.
 */
export function readAuthCredsOrThrow(): { user: string; pass: string } {
  const rawUser = process.env.WEB_AUTH_USER ?? '';
  const rawPass = process.env.WEB_AUTH_PASS ?? '';
  const user = rawUser.trim();
  const pass = rawPass.trim();
  if (!user || !pass) {
    throw new Error(
      'WEB_AUTH_USER and WEB_AUTH_PASS must both be set; refusing to start without auth',
    );
  }
  return { user, pass };
}

function sendUnauthorized(reply: FastifyReply): void {
  reply.header('WWW-Authenticate', REALM);
  reply.code(401).send({ error: 'Unauthorized' });
}

/**
 * Returns true if the URL targets the unauthenticated health endpoint. Matches
 * exact path and the same path with a query string (`/healthz?foo=bar`). Also
 * matches a trailing slash variant defensively.
 */
function isHealthPath(url: string): boolean {
  if (url === HEALTH_PATH) return true;
  if (url.startsWith(`${HEALTH_PATH}?`)) return true;
  if (url === `${HEALTH_PATH}/`) return true;
  return false;
}

/**
 * Constant-time-ish password compare. timingSafeEqual requires equal-length
 * Buffers; calling it on mismatched lengths throws. To avoid both the throw
 * AND a trivial length oracle, we always compare against a same-length dummy
 * buffer of the expected password and AND the result with the length-equal
 * flag. This is not perfectly side-channel-safe (Buffer.byteLength is
 * observed) but is much better than `===`.
 */
function constantTimeEqual(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  const lenEqual = providedBuf.length === expectedBuf.length;
  // Always compare expectedBuf to a same-length buffer to avoid the throw.
  const cmpBuf = lenEqual ? providedBuf : Buffer.alloc(expectedBuf.length);
  const bytesEqual = timingSafeEqual(expectedBuf, cmpBuf);
  return lenEqual && bytesEqual;
}

/**
 * Build a Fastify onRequest hook that enforces HTTP BASIC auth using the
 * supplied credentials. Skips HEALTH_PATH so container health probes don't
 * need creds. Returns 401 + WWW-Authenticate on any failure (missing header,
 * wrong scheme, bad base64, no colon, mismatched user, mismatched pass).
 */
export function basicAuthHook(
  expectedUser: string,
  expectedPass: string,
): onRequestAsyncHookHandler {
  return async function onRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (isHealthPath(req.url)) {
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      sendUnauthorized(reply);
      return;
    }

    // Case-insensitive "Basic " prefix.
    if (!/^basic\s+/i.test(authHeader)) {
      sendUnauthorized(reply);
      return;
    }

    const b64 = authHeader.replace(/^basic\s+/i, '').trim();
    if (!b64) {
      sendUnauthorized(reply);
      return;
    }

    let decoded: string;
    try {
      // Buffer.from with 'base64' is permissive (ignores invalid chars) but
      // does not throw. Validate by re-encoding and comparing strict charset.
      // We accept whatever decodes; treat clearly-invalid (non-ASCII printable
      // after decode) by simply failing the colon-split below.
      decoded = Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      sendUnauthorized(reply);
      return;
    }

    const colonIdx = decoded.indexOf(':');
    if (colonIdx < 0) {
      sendUnauthorized(reply);
      return;
    }

    const providedUser = decoded.slice(0, colonIdx);
    const providedPass = decoded.slice(colonIdx + 1);

    // Username compare with === is OK — usernames aren't secret.
    const userMatches = providedUser === expectedUser;
    // Password compare must be (approximately) constant-time.
    const passMatches = constantTimeEqual(expectedPass, providedPass);

    if (!userMatches || !passMatches) {
      sendUnauthorized(reply);
      return;
    }

    // Match — let the request proceed. Fastify treats no-reply as continue.
  };
}
