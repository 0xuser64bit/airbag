// End-to-end: the real web app against the real engine in simulation mode (ADR 0012).
// `pnpm e2e` starts both unless they're already running locally.

import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  // The simulated chain is shared, and a wick moves everyone's BTC: run one test at a time.
  workers: 1,
  fullyParallel: false,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  reporter: CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    // Locally, use the installed Chrome; CI installs Playwright's Chromium.
    ...(CI ? {} : { channel: 'chrome' }),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'node apps/engine/src/main.ts',
      url: 'http://localhost:8787/health',
      reuseExistingServer: !CI,
      env: {
        ENGINE_MODE: 'simulation',
        DATABASE_PATH: ':memory:',
        WEB_ORIGIN: 'http://localhost:3000',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: CI ? 'pnpm --filter @airbag/web start' : 'pnpm --filter @airbag/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
