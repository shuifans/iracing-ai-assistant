/**
 * Playwright global setup — seeds a throwaway test DB (migrate + users + sources)
 * via `tsx scripts/e2e-seed.ts` (tsx resolves the `@/` alias), BEFORE the web server
 * starts. So `next start` connects to an already-seeded DB.
 *
 * The DATABASE_PATH / DATA_ROOT / WIKI_ROOT here MUST match the webServer.env in
 * playwright.config.ts — both resolve relative to the repo root (cwd at run time).
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

const DB_PATH = path.resolve(process.cwd(), 'data/e2e/e2e.sqlite');
const DATA_ROOT = path.resolve(process.cwd(), 'data/e2e');
const WIKI_ROOT = path.join(DATA_ROOT, 'md-wiki');

export default async function globalSetup() {
  execSync('npx tsx scripts/e2e-seed.ts', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_PATH: DB_PATH,
      DATA_ROOT,
      WIKI_ROOT,
    },
  });
}
