/**
 * Shared HTTP BASIC auth header for tests against buildServer.
 *
 * test/setup.ts pre-populates WEB_AUTH_USER=test / WEB_AUTH_PASS=test so the
 * server starts; tests spread AUTH_HEADERS into app.inject({ headers: ... })
 * so the basicAuthHook accepts the request.
 */
export const AUTH_HEADERS = {
  authorization: 'Basic ' + Buffer.from('test:test').toString('base64'),
};
