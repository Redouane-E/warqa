import { defineConfig } from 'vitest/config';

// Unit tests in Node (the browser tests are Playwright, in e2e/).
export default defineConfig({
  define: { __STUDIO_VERSION__: JSON.stringify('test') },
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 30000 },
});
