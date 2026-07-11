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

describeIf('E2E: Admin endpoints', () => {
  let db: TestDb;
  let rawDb: any;
  let cleanup: () => void;
  let adminToken: string;
  let userToken: string;

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
        JWT_ACCESS_SECRET: 'test-jwt-secret-for-e2e-admin',
        REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
        IP_HASH_PEPPER: 'test-ip-pepper',
        APP_BASE_URL: 'http://localhost:3000',
      },
      getEnv: () => ({
        QODER_PERSONAL_ACCESS_TOKEN: 'test-pat',
        WIKI_ROOT: '/tmp/test-wiki',
        DATABASE_PATH: ':memory:',
        JWT_ACCESS_SECRET: 'test-jwt-secret-for-e2e-admin',
        REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
        IP_HASH_PEPPER: 'test-ip-pepper',
        APP_BASE_URL: 'http://localhost:3000',
      }),
    }));

    // Seed admin user and regular user
    rawDb.exec(`
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('u-admin-e2e', 'admin_e2e', 'hash', 'admin', 'active',
              '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('u-regular-e2e', 'regular_e2e', 'hash', 'user', 'active',
              '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('u-pending-e2e', 'pending_e2e', 'hash', 'user', 'pending',
              '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    `);

    // Seed chat sessions for admin session list
    rawDb.exec(`
      INSERT INTO chat_sessions (id, user_id, title, status, created_at, updated_at, last_message_at)
      VALUES ('cs-admin-1', 'u-regular-e2e', 'Test session 1', 'active',
              '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z');
    `);

    // Seed audit logs
    rawDb.exec(`
      INSERT INTO audit_logs (id, actor_id, action, resource, resource_id, created_at)
      VALUES ('al-e2e-1', 'u-admin-e2e', 'user.approved', 'user', 'u-pending-e2e',
              '2026-07-10T00:00:00.000Z');
    `);

    // Create tokens
    const { createAccessToken } = await import('@/modules/auth/token-service');
    adminToken = await createAccessToken({
      id: 'u-admin-e2e',
      username: 'admin_e2e',
      role: 'admin',
      status: 'active',
    });
    userToken = await createAccessToken({
      id: 'u-regular-e2e',
      username: 'regular_e2e',
      role: 'user',
      status: 'active',
    });
  });

  afterAll(() => {
    cleanup();
    vi.doUnmock('@/db/client');
    vi.doUnmock('@/config/env');
  });

  // ── RBAC guard ──────────────────────────────────────────────────────────────

  it('rejects non-admin user from /api/admin/users', async () => {
    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users', {
      method: 'GET',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects non-admin user from /api/admin/sessions', async () => {
    const { GET } = await import('@/app/api/admin/sessions/route');
    const req = new NextRequest('http://localhost:3000/api/admin/sessions', {
      method: 'GET',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('rejects non-admin user from /api/admin/audit-logs', async () => {
    const { GET } = await import('@/app/api/admin/audit-logs/route');
    const req = new NextRequest('http://localhost:3000/api/admin/audit-logs', {
      method: 'GET',
      headers: { authorization: `Bearer ${userToken}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  // ── Admin operations ────────────────────────────────────────────────────────

  it('GET /api/admin/users lists users (admin)', async () => {
    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.users.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/admin/sessions lists all sessions (admin)', async () => {
    const { GET } = await import('@/app/api/admin/sessions/route');
    const req = new NextRequest('http://localhost:3000/api/admin/sessions', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sessions.length).toBeGreaterThanOrEqual(1);
    // Should include username and messageCount
    const session = body.data.sessions[0];
    expect(session).toHaveProperty('username');
    expect(session).toHaveProperty('messageCount');
  });

  it('GET /api/admin/audit-logs lists audit logs (admin)', async () => {
    const { GET } = await import('@/app/api/admin/audit-logs/route');
    const req = new NextRequest('http://localhost:3000/api/admin/audit-logs', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.auditLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects unauthenticated requests to admin endpoints', async () => {
    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
