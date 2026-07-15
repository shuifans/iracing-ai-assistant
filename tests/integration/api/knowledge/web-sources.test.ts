import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
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
    db.exec('DROP TRIGGER IF EXISTS fail_web_source_audit');
    db.prepare('DELETE FROM audit_logs').run();
    db.prepare('DELETE FROM web_knowledge_sources').run();
    db.close();
    rmSync(snapshotPath, { recursive: true, force: true });
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

  it('rejects an explicit default HTTPS port with 400', async () => {
    const response = await collection.POST(
      request('http://localhost/api/knowledge/web-sources', 'POST', {
        name: 'Default port',
        scopeType: 'domain',
        url: 'https://iracing.com:443',
        sourceLevel: 'official',
        enabled: true,
      }),
    );

    expect(response.status).toBe(400);
  });

  it('rolls back a source mutation when its audit insert fails', async () => {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TRIGGER fail_web_source_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'web_source.created'
      BEGIN
        SELECT RAISE(ABORT, 'audit unavailable');
      END
    `);
    db.close();

    const response = await collection.POST(
      request('http://localhost/api/knowledge/web-sources', 'POST', {
        name: 'Must roll back',
        scopeType: 'domain',
        url: 'https://rollback.example.com',
        sourceLevel: 'official',
        enabled: true,
      }),
    );

    expect(response.status).toBe(500);
    const verifyDb = new Database(dbPath);
    const sourceCount = verifyDb
      .prepare("SELECT count(*) AS count FROM web_knowledge_sources WHERE name = 'Must roll back'")
      .get() as { count: number };
    verifyDb.close();
    expect(sourceCount.count).toBe(0);
  });

  it('rolls back the source and audit when the snapshot cannot be replaced', async () => {
    rmSync(snapshotPath, { recursive: true, force: true });
    const snapshotParent = join(tempDir, 'notes');
    rmSync(snapshotParent, { recursive: true, force: true });
    mkdirSync(snapshotPath, { recursive: true });

    const response = await collection.POST(
      request('http://localhost/api/knowledge/web-sources', 'POST', {
        name: 'Snapshot must be atomic',
        scopeType: 'domain',
        url: 'https://snapshot-rollback.example.com',
        sourceLevel: 'official',
        enabled: true,
      }),
    );

    expect(response.status).toBe(500);
    const verifyDb = new Database(dbPath);
    expect(
      verifyDb
        .prepare(
          "SELECT count(*) AS count FROM web_knowledge_sources WHERE name = 'Snapshot must be atomic'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      verifyDb
        .prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'web_source.created'")
        .get(),
    ).toEqual({ count: 0 });
    verifyDb.close();
    rmSync(snapshotPath, { recursive: true, force: true });
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

  it('serializes concurrent process mutations so an older snapshot cannot overwrite a newer one', async () => {
    const workerPath = join(process.cwd(), 'tests/fixtures/web-source-concurrency-worker.ts');
    const runWorker = (name: string, url: string) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', workerPath, dbPath, snapshotPath, name, url],
        { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      const completion = new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}`)),
        );
      });
      return { child, completion };
    };

    const setupDb = new Database(dbPath);
    const insertDummy = setupDb.prepare(
      `INSERT INTO web_knowledge_sources
          (id, name, scope_type, url, source_level, enabled, description, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, 'domain', ?, 'community', 1, NULL, 'admin-1', 'admin-1', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')`,
    );
    setupDb.transaction(() => {
      for (let index = 0; index < 10000; index += 1) {
        insertDummy.run(
          `dummy-${index}`,
          `Dummy ${String(index).padStart(5, '0')}`,
          `https://dummy-${index}.example.com`,
        );
      }
    })();
    setupDb.close();

    const first = runWorker('First process', 'https://first-process.example.com');
    void first.completion.catch(() => undefined);
    const temporaryDeadline = Date.now() + 5000;
    while (
      !existsSync(join(tempDir, 'notes')) ||
      !readdirSync(join(tempDir, 'notes')).some(
        (entry) => entry.startsWith('knowledge-sources.md.') && entry.endsWith('.tmp'),
      )
    ) {
      if (Date.now() >= temporaryDeadline) {
        throw new Error('first worker did not create its atomic snapshot temporary file');
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    first.child.kill('SIGSTOP');
    const second = runWorker('Second process', 'https://second-process.example.com');
    void second.completion.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    first.child.kill('SIGCONT');
    await Promise.all([first.completion, second.completion]);

    const verifyDb = new Database(dbPath);
    const persistedNames = verifyDb
      .prepare("SELECT name FROM web_knowledge_sources WHERE name LIKE '% process' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    verifyDb.close();
    expect(persistedNames).toEqual(['First process', 'Second process']);
    const snapshot = readFileSync(snapshotPath, 'utf8');
    expect(snapshot).toContain('First process');
    expect(snapshot).toContain('Second process');
  }, 10000);
});
