// End-to-end: the real web app against the real engine in simulation mode (ADR 0012).
// `pnpm e2e` starts fresh, isolated servers and refuses to reuse existing processes.

import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
// Dedicated ports and fresh in-memory state: never exercise a user's running engine.
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const engineUrl = `http://localhost:${process.env.E2E_ENGINE_PORT ?? 8877}`;
const webUrl = `http://localhost:${webPort}`;

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
    baseURL: webUrl,
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
      url: `${engineUrl}/ready`,
      reuseExistingServer: false,
      env: {
        ENGINE_MODE: 'simulation',
        DATABASE_PATH: ':memory:',
        WEB_ORIGIN: webUrl,
        HOST: '127.0.0.1',
        PORT: process.env.E2E_ENGINE_PORT ?? '8877',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm --filter @airbag/web exec next ${CI ? 'start' : 'dev'} --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_ENGINE_URL: engineUrl, NEXT_PUBLIC_SITE_URL: webUrl, AIRBAG_E2E: '1' },
    },
  ],
});
