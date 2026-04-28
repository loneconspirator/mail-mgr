import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Integration and acceptance projects share a single GreenMail instance.
    // Vitest runs projects in parallel by default, which causes INBOX/folder
    // cross-contamination between the two pools. Capping workers to 1
    // serializes execution across projects without affecting how individual
    // unit-test files schedule tests internally.
    maxWorkers: 1,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          globals: true,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globals: true,
          testTimeout: 30_000,
          globalSetup: ['./test/integration/global-setup.ts'],
          // Integration + acceptance tests share a single GreenMail instance
          // (one INBOX, one mailbox tree). Running files in parallel causes
          // INBOX/folder cross-contamination — one file's appended messages
          // arrive on another file's IDLE listener, or its clearMailboxes()
          // wipes mid-test data. Serialize file execution to keep the suite
          // deterministic.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'acceptance',
          include: ['test/acceptance/**/*.test.ts'],
          globals: true,
          testTimeout: 180_000,
          hookTimeout: 60_000,
          globalSetup: ['./test/integration/global-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
