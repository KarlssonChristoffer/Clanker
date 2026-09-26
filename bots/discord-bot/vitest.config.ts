import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Keep test output readable: pino is silenced during tests.
    env: { LOG_LEVEL: 'silent', LOG_PRETTY: '0', NODE_ENV: 'test' },
  },
});
