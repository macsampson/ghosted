import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: true,
    env: {
      DYNAMODB_ENDPOINT: 'http://localhost:8000',
      TABLE_NAME: 'JobTracker-test',
    },
    globalSetup: './src/__tests__/globalSetup.ts',
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
