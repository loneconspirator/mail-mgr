# Deferred Items - Plan 34-01

## Pre-existing frontend test failures (not caused by 34-01)

`test/unit/web/frontend.test.ts` has 7 failing tests due to missing `dist/`
build artifacts (`/app.js` and `/styles.css` return 404). The tests expect
`pnpm build:frontend` (esbuild) to have run before the suite. Verified
pre-existing on the base commit `cb8edfd` (before any 34-01 work).

Out of scope for 34-01 — this plan only touches `src/imap/client.ts` and
`test/unit/imap/client.test.ts`. The frontend build pipeline / fixture
strategy is a separate concern.

Test files affected: 1 (frontend.test.ts) — 7 of 15 tests
Workaround for full-suite green: run `pnpm build:frontend` before `pnpm test`.
