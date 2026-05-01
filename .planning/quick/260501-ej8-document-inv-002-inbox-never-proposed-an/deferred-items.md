# Deferred Items — Quick Task 260501-ej8

## Pre-existing failures discovered during execution (not caused by this task)

### test/unit/web/frontend.test.ts — 7 failing tests

**Discovery context:** Running `npm run test:unit` while verifying Task 2.

**Symptom:** All failures look like:

```
expected 404 to be 200
> at test/unit/web/frontend.test.ts:169:28
>   const res = await app.inject({ method: 'GET', url: '/app.js' })
```

The frontend tests expect compiled assets at `/app.js`, `/app.css`, etc. to
return 200 from the Fastify static handler. They return 404 because the
frontend bundle has not been built in this worktree.

**Verified pre-existing:** Stashed Task-2 changes and ran the same suite at
the prior commit (79671e7 — Task 1 only, no test changes). Same 7 failures,
same line numbers. Not caused by this task.

**Out of scope for 260501-ej8:** This task is `docs+test` and explicitly
forbids `src/` changes. Fixing the frontend build pipeline is unrelated to
INV-002. Filing as a separate concern is appropriate — likely just needs
`npm run build:frontend` (or equivalent) to be run as part of pretest, or
the test file to gate on bundle existence with a clearer error message.

**Action required:** Not from this task. Recommend opening a separate todo
to either (a) wire the frontend build into `pretest`, or (b) skip these
tests when the bundle is missing with a clear "run npm run build first"
message.
