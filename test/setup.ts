/**
 * Vitest setupFiles entry — runs once per test file before tests start.
 *
 * Sets WEB_AUTH_USER / WEB_AUTH_PASS so buildServer's readAuthCredsOrThrow
 * passes during tests. Tests that explicitly want to test the unset case
 * (currently only test/unit/web/auth.test.ts) delete these in beforeEach.
 *
 * The matching test/_authHeader.ts exports AUTH_HEADERS = `Basic <b64('test:test')>`
 * which existing web tests spread into their app.inject() calls.
 */
process.env.WEB_AUTH_USER = process.env.WEB_AUTH_USER ?? 'test';
process.env.WEB_AUTH_PASS = process.env.WEB_AUTH_PASS ?? 'test';
