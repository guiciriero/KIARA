import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    // Cada arquivo sobe seu próprio servidor em porta efêmera; sem estado compartilhado
    env: { LOG_LEVEL: 'error', NODE_ENV: 'test', HOST_GRACE_MS: '0' },
  },
});
