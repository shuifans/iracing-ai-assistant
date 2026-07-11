import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
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

describeIf('E2E: Auth flow', () => {
  let db: TestDb;
  let rawDb: any;
  let cleanup: () => void;

  beforeAll(async () => {
    const test = createTestDb();
    db = test.db;
    rawDb = test.rawDb;
    cleanup = test.cleanup;

    vi.doMock('@/db/client', () => ({
      getDb: () => db,
      getRawDb: () => rawDb,
      resetDbForTesting: () => {},
      closeDb: () => {},
    }));

    vi.doMock('@/config/env', () => ({
      env: {
        QODER_PERSONAL_ACCESS_TOKEN: 'test-pat',
        WIKI_ROOT: '/tmp/test-wiki',
        DATABASE_PATH: ':memory:',
        JWT_ACCESS_SECRET: 'test-jwt-secret-for-e2e-auth',
        REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
        IP_HASH_PEPPER: 'test-ip-pepper',
        APP_BASE_URL: 'http://localhost:3000',
      },
      getEnv: () => ({
        QODER_PERSONAL_ACCESS_TOKEN: 'test-pat',
        WIKI_ROOT: '/tmp/test-wiki',
        DATABASE_PATH: ':memory:',
        JWT_ACCESS_SECRET: 'test-jwt-secret-for-e2e-auth',
        REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
        IP_HASH_PEPPER: 'test-ip-pepper',
        APP_BASE_URL: 'http://localhost:3000',
      }),
    }));
  });

  afterAll(() => {
    cleanup();
    vi.doUnmock('@/db/client');
    vi.doUnmock('@/config/env');
  });

  it('complete auth lifecycle: register → approve → login → me → refresh', async () => {
    // Step 1: Register
    const { POST: registerHandler } = await import('@/app/api/auth/register/route');
    const registerReq = new NextRequest('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'e2e_auth_user',
        password: 'supersecretpassword123',
        registrationReason: 'E2E test',
      }),
    });
    const registerRes = await registerHandler(registerReq);
    expect(registerRes.status).toBe(201);
    const registerBody = await registerRes.json();
    expect(registerBody.data.message).toContain('注册申请已提交');

    // Step 2: Approve user (direct DB update, simulating admin approval)
    rawDb.exec(`
      UPDATE users SET status = 'active', approved_at = '2026-07-12T00:00:00.000Z'
      WHERE username = 'e2e_auth_user'
    `);

    // Step 3: Login
    const { POST: loginHandler } = await import('@/app/api/auth/login/route');
    const loginReq = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'e2e_auth_user',
        password: 'supersecretpassword123',
      }),
    });
    const loginRes = await loginHandler(loginReq);
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.data).toHaveProperty('accessToken');
    expect(loginBody.data.user.username).toBe('e2e_auth_user');

    const accessToken: string = loginBody.data.accessToken;

    // Extract refresh token cookie from response
    const setCookieHeader = loginRes.headers.get('set-cookie');
    expect(setCookieHeader).toBeTruthy();
    const refreshCookieMatch = setCookieHeader?.match(/refresh_token=([^;]+)/);
    expect(refreshCookieMatch).toBeTruthy();
    const refreshToken = refreshCookieMatch![1];

    // Step 4: /api/auth/me with access token
    const { GET: meHandler } = await import('@/app/api/auth/me/route');
    const meReq = new NextRequest('http://localhost:3000/api/auth/me', {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const meRes = await meHandler(meReq);
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.data.user.username).toBe('e2e_auth_user');
    expect(meBody.data.user.status).toBe('active');

    // Step 5: Refresh token
    const { POST: refreshHandler } = await import('@/app/api/auth/refresh/route');
    const refreshReq = new NextRequest('http://localhost:3000/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });
    const refreshRes = await refreshHandler(refreshReq);
    expect(refreshRes.status).toBe(200);
    const refreshBody = await refreshRes.json();
    expect(refreshBody.data).toHaveProperty('accessToken');
    // New access token should be different
    expect(refreshBody.data.accessToken).not.toBe(accessToken);
  });

  it('rejects login with wrong password', async () => {
    // User already exists from previous test
    const { POST: loginHandler } = await import('@/app/api/auth/login/route');
    const loginReq = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'e2e_auth_user',
        password: 'wrongpassword123',
      }),
    });
    const loginRes = await loginHandler(loginReq);
    expect(loginRes.status).toBe(401);
    const body = await loginRes.json();
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects /api/auth/me without token', async () => {
    const { GET: meHandler } = await import('@/app/api/auth/me/route');
    const meReq = new NextRequest('http://localhost:3000/api/auth/me', {
      method: 'GET',
    });
    const meRes = await meHandler(meReq);
    expect(meRes.status).toBe(401);
  });
});
