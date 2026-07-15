import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { runMigrations } from '@/db/migrate';
import { resetDbForTesting } from '@/db/client';

vi.mock('@/modules/auth/token-service', () => ({ verifyAccessToken: vi.fn() }));

import { verifyAccessToken } from '@/modules/auth/token-service';

describe('knowledge web sources API', () => {
  let tempDir: string;
  let dbPath: string;
  let snapshotPath: string;
  let collection: typeof import('@/app/api/knowledge/web-sources/route');
  let item: typeof import('@/app/api/knowledge/web-sources/[id]/route');

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'web-sources-api-'));
    dbPath = join(tempDir, 'app.sqlite');
    snapshotPath = join(tempDir, 'notes', 'knowledge-sources.md');
    process.env.DATABASE_PATH = dbPath;
    process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH = snapshotPath;
    runMigrations(dbPath);
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
       VALUES ('admin-1', 'admin', 'hash', 'admin', 'active', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')`,
    ).run();
    db.close();
    resetDbForTesting();
    collection = await import('@/app/api/knowledge/web-sources/route');
    item = await import('@/app/api/knowledge/web-sources/[id]/route');
  });

  afterAll(() => {
    resetDbForTesting();
    delete process.env.DATABASE_PATH;
    delete process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      id: 'admin-1',
      role: 'knowledge_admin',
      status: 'active',
    } as any);
    const db = new Database(dbPath);
    db.prepare('DELETE FROM audit_logs').run();
    db.prepare('DELETE FROM web_knowledge_sources').run();
    db.close();
  });

  const request = (url: string, method = 'GET', body?: unknown) =>
    new NextRequest(url, {
      method,
      headers: {
        authorization: 'Bearer token',
        origin: 'http://localhost',
        host: 'localhost',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('forbids ordinary users', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      id: 'user-1',
      role: 'user',
      status: 'active',
    } as any);

    const response = await collection.GET(request('http://localhost/api/knowledge/web-sources'));

    expect(response.status).toBe(403);
  });

  it('rejects unsafe URLs with 400', async () => {
    const response = await collection.POST(
      request('http://localhost/api/knowledge/web-sources', 'POST', {
        name: 'Unsafe',
        scopeType: 'domain',
        url: 'http://iracing.com',
        sourceLevel: 'official',
        enabled: true,
      }),
    );

    expect(response.status).toBe(400);
  });

  it('creates, lists, updates, deletes, audits, and refreshes the snapshot', async () => {
    const createdResponse = await collection.POST(
      request('http://localhost/api/knowledge/web-sources', 'POST', {
        name: 'iRacing News',
        scopeType: 'path',
        url: 'https://iracing.com/news/',
        sourceLevel: 'official',
        enabled: true,
        description: 'Official news',
      }),
    );
    expect(createdResponse.status).toBe(201);
    const createdBody = await createdResponse.json();
    const id = createdBody.data.source.id as string;
    expect(createdBody.data.source.url).toBe('https://iracing.com/news');

    const listResponse = await collection.GET(
      request('http://localhost/api/knowledge/web-sources'),
    );
    await expect(listResponse.json()).resolves.toMatchObject({
      data: { sources: [{ id, name: 'iRacing News' }] },
    });

    const patchedResponse = await item.PATCH(
      request(`http://localhost/api/knowledge/web-sources/${id}`, 'PATCH', {
        name: 'iRacing Updates',
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(patchedResponse.status).toBe(200);
    await expect(patchedResponse.json()).resolves.toMatchObject({
      data: { source: { enabled: true, name: 'iRacing Updates' } },
    });

    const disabledResponse = await item.PATCH(
      request(`http://localhost/api/knowledge/web-sources/${id}`, 'PATCH', { enabled: false }),
      { params: Promise.resolve({ id }) },
    );
    expect(disabledResponse.status).toBe(200);
    expect(readFileSync(snapshotPath, 'utf8')).toContain(
      '| 禁用 | official | iRacing Updates | path | https://iracing.com/news | Official news |',
    );

    const deletedResponse = await item.DELETE(
      request(`http://localhost/api/knowledge/web-sources/${id}`, 'DELETE'),
      { params: Promise.resolve({ id }) },
    );
    expect(deletedResponse.status).toBe(200);
    await expect(deletedResponse.json()).resolves.toMatchObject({ data: { deleted: true } });
    expect(readFileSync(snapshotPath, 'utf8')).not.toContain('iRacing Updates');
    expect(existsSync(snapshotPath)).toBe(true);

    const db = new Database(dbPath);
    const actions = db
      .prepare('SELECT action FROM audit_logs ORDER BY created_at, rowid')
      .all()
      .map((row: any) => row.action);
    db.close();
    expect(actions).toEqual([
      'web_source.created',
      'web_source.updated',
      'web_source.disabled',
      'web_source.deleted',
    ]);
  });
});
