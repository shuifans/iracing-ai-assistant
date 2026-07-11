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

describeIf('E2E: Chat flow', () => {
  let db: TestDb;
  let rawDb: any;
  let cleanup: () => void;
  let accessToken: string;
  let userId: string;

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
        JWT_ACCESS_SECRET: 'test-jwt-secret-for-e2e-chat',
        REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
        IP_HASH_PEPPER: 'test-ip-pepper',
        APP_BASE_URL: 'http://localhost:3000',
      },
      getEnv: () => ({
        QODER_PERSONAL_ACCESS_TOKEN: 'test-pat',
        WIKI_ROOT: '/tmp/test-wiki',
        DATABASE_PATH: ':memory:',
        JWT_ACCESS_SECRET: 'test-jwt-secret-for-e2e-chat',
        REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
        IP_HASH_PEPPER: 'test-ip-pepper',
        APP_BASE_URL: 'http://localhost:3000',
      }),
    }));

    // Seed an active user and get a token
    rawDb.exec(`
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('u-chat-e2e', 'chat_e2e_user', '$2b$12$fakehashfortestingonly', 'user', 'active',
              '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    `);
    userId = 'u-chat-e2e';

    // Create access token for the user
    const { createAccessToken } = await import('@/modules/auth/token-service');
    accessToken = await createAccessToken({
      id: userId,
      username: 'chat_e2e_user',
      role: 'user',
      status: 'active',
    });
  });

  afterAll(() => {
    cleanup();
    vi.doUnmock('@/db/client');
    vi.doUnmock('@/config/env');
  });

  it('POST /api/chat/sessions creates a new session', async () => {
    const { POST } = await import('@/app/api/chat/sessions/route');
    const req = new NextRequest('http://localhost:3000/api/chat/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('userId', userId);
    expect(body.data.status).toBe('active');
  });

  it('GET /api/chat/sessions lists user sessions', async () => {
    // Create a session first
    const { POST } = await import('@/app/api/chat/sessions/route');
    const createReq = new NextRequest('http://localhost:3000/api/chat/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await POST(createReq);

    // List sessions
    const { GET } = await import('@/app/api/chat/sessions/route');
    const listReq = new NextRequest('http://localhost:3000/api/chat/sessions?limit=10', {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const res = await GET(listReq);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/chat/messages validates required fields', async () => {
    const { POST } = await import('@/app/api/chat/messages/route');

    // Missing sessionId
    const req = new NextRequest('http://localhost:3000/api/chat/messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'test message' }),
    });
    const res = await POST(req);
    // Should fail since no sessionId
    expect(res.status).not.toBe(200);
  });

  it('POST /api/chat/messages rejects unauthenticated request', async () => {
    const { POST } = await import('@/app/api/chat/messages/route');
    const req = new NextRequest('http://localhost:3000/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'fake', content: 'test' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
