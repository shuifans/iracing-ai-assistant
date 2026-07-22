import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT || 3100);
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const DB_PATH = path.resolve(process.cwd(), 'data/e2e/e2e.sqlite');
const DATA_ROOT = path.resolve(process.cwd(), 'data/e2e');

/**
 * Env handed to the `next start` web server so it uses a THROWAWAY test DB and a
 * self-consistent set of test secrets — NEVER the real /srv production DB.
 * Must stay in sync with tests/e2e-browser/global-setup.ts.
 */
const SERVER_ENV = {
  NODE_ENV: 'production',
  APP_BASE_URL: BASE_URL,
  PORT: String(PORT),
  DATABASE_PATH: DB_PATH,
  DATA_ROOT,
  WIKI_ROOT: path.join(DATA_ROOT, 'md-wiki'),
  WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH: path.join(DATA_ROOT, 'knowledge-sources.md'),
  JWT_ACCESS_SECRET: 'e2e-jwt-secret-do-not-use-in-prod',
  REFRESH_TOKEN_PEPPER: 'e2e-refresh-pepper-do-not-use-in-prod',
  IP_HASH_PEPPER: 'e2e-ip-pepper-do-not-use-in-prod',
  QODER_PERSONAL_ACCESS_TOKEN: 'e2e-pat-do-not-use-in-prod',
  REFRESH_COOKIE_SECURE: 'false',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: './tests/e2e-browser',
  globalSetup: './tests/e2e-browser/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  expect: { timeout: 30_000 },
  timeout: 60_000,
  // `next start` uses the existing `.next` production build. Run `npm run build`
  // first if the build is missing/stale. Port 3100 avoids clashing with `next dev`
  // on 3000.
  webServer: {
    command: 'npm run start',
    port: PORT,
    timeout: 120_000,
    reuseExistingServer: false,
    cwd: '.',
    env: { ...process.env, ...SERVER_ENV },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
