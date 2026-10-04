// Browser tests of the web app, against `vite preview` of a build served under /warqa/ (as on GitHub Pages).
//   pnpm --filter @warqa/web e2e            (builds, serves on :4181, runs Chromium)
//   WARQA_CORS_CHECK=1 pnpm --filter @warqa/web e2e providers   (also checks the providers' CORS, with a dummy key)
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.WARQA_E2E_PORT ?? 4181);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}/warqa/`,
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
    },
  ],
  webServer: {
    command: `vite build --outDir e2e/.dist --emptyOutDir && vite preview --outDir e2e/.dist --host 127.0.0.1 --port ${port} --strictPort`,
    env: { WARQA_BASE: '/warqa/' },
    url: `http://127.0.0.1:${port}/warqa/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
