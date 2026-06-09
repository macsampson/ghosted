import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true,
    // Synthesizing the stack reads the apps/api/dist Lambda asset; give it room.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
