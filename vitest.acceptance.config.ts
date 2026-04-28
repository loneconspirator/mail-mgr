import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/acceptance/**/*.test.ts'],
    globals: true,
    testTimeout: 180_000,
    hookTimeout: 60_000,
    globalSetup: ['./test/integration/global-setup.ts'],
  },
});
