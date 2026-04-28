import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
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
        },
      },
    ],
  },
});
