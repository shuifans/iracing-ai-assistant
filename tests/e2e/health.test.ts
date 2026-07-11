import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/test-db';

// Skip if native module unavailable
let nativeOk = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.close();
} catch {
  nativeOk = false;
}

const describeIf = nativeOk ? describe : describe.skip;

describeIf('E2E: Health endpoints', () => {
  let db: TestDb;
  let rawDb: any;
  let cleanup: () => void;

  beforeAll(async () => {
    const test = createTestDb();
    db = test.db;
    rawDb = test.rawDb;
    cleanup = test.cleanup;

    // Mock db client to use test DB
    vi.doMock('@/db/client', () => ({
      getDb: () => db,
      getRawDb: () => rawDb,
      resetDbForTesting: () => {},
      closeDb: () => {},
    }));

    // Mock env
    vi.doMock('@/config/env', () => ({
      env: {
        QODER_PERSONAL_ACCESS_TOKEN: 'test-pat',
        WIKI_ROOT: '/tmp/test-wiki',
        DATABASE_PATH: ':memory:',
        JWT_ACCESS_SECRET: 'test-jwt-secret-for-e2e-testing',
        REFRESH_TOKEN_PEPPER: 'test-pepper',
        IP_HASH_PEPPER: 'test-ip-pepper',
      },
      getEnv: () => ({
        QODER_PERSONAL_ACCESS_TOKEN: 'test-pat',
        WIKI_ROOT: '/tmp/test-wiki',
        DATABASE_PATH: ':memory:',
        JWT_ACCESS_SECRET: 'test-jwt-secret-for-e2e-testing',
        REFRESH_TOKEN_PEPPER: 'test-pepper',
        IP_HASH_PEPPER: 'test-ip-pepper',
      }),
    }));
  });

  afterAll(() => {
    cleanup();
    vi.doUnmock('@/db/client');
    vi.doUnmock('@/config/env');
  });

  it('GET /api/health/live returns 200 with status ok', async () => {
    const { GET } = await import('@/app/api/health/live/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('status', 'ok');
  });

  it('GET /api/health/ready returns checks object', async () => {
    const { GET } = await import('@/app/api/health/ready/route');
    const response = await GET();
    const body = await response.json();

    expect(body).toHaveProperty('checks');
    expect(body.checks).toHaveProperty('pat');
    expect(body.checks).toHaveProperty('wiki');
    expect(body.checks).toHaveProperty('database');
    // Database should be ok since we're using test DB
    expect(body.checks.database).toBe(true);
    // PAT is configured in mock env
    expect(body.checks.pat).toBe(true);
  });
});
