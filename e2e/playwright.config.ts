import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const FAKE_PORT = 4010;
const APP_PORT = 8788;
const FAKE_ORIGIN = `http://127.0.0.1:${FAKE_PORT}`;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;

// A fresh edge-cache/state dir per run, so cached upstream responses never leak between runs.
const persist = mkdtempSync(join(tmpdir(), 'swu-tcc-e2e-'));

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // Tests share one fake Melee and one worker (in-memory rate limiter, request stats).
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: APP_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node fake-melee/server.ts',
      url: `${FAKE_ORIGIN}/__stats`,
      env: { FAKE_MELEE_PORT: String(FAKE_PORT) },
      reuseExistingServer: false,
    },
    {
      // Serves apps/web/dist (build it first: `npm run e2e` at the repo root does) plus the proxy.
      command: `npx wrangler dev --ip 127.0.0.1 --port ${APP_PORT} --var MELEE_ORIGIN:${FAKE_ORIGIN} --persist-to ${persist}`,
      cwd: '../apps/worker',
      // A bad id answers 400 from the worker, which proves it is up.
      url: `${APP_ORIGIN}/api/tournaments/not-a-number`,
      env: { WRANGLER_SEND_METRICS: 'false', CI: '1' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
