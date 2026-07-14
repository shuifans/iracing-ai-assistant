import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { runMigrations } from '@/db/migrate';
import { resetDbForTesting } from '@/db/client';

vi.mock('@/modules/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    id: 'upload-user',
    username: 'uploader',
    role: 'user',
    status: 'active',
  })),
  requireActiveUser: vi.fn(),
  validateOrigin: vi.fn(),
  withErrorHandler: (handler: unknown) => handler,
}));

describe('POST /api/uploads/images with real SQLite', () => {
  let tempDir: string;
  let dbPath: string;
  let dataRoot: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'image-upload-'));
    dbPath = join(tempDir, 'app.sqlite');
    dataRoot = join(tempDir, 'custom-data');
    process.env.DATABASE_PATH = dbPath;
    process.env.DATA_ROOT = dataRoot;
    runMigrations(dbPath);
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
       VALUES ('upload-user', 'uploader', 'hash', 'user', 'active', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z')`,
    ).run();
    db.close();
    resetDbForTesting();
  });

  afterAll(() => {
    resetDbForTesting();
    delete process.env.DATABASE_PATH;
    delete process.env.DATA_ROOT;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores an owned unbound image under DATA_ROOT/uploads', async () => {
    const png = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(13, 8);
    Buffer.from('IHDR').copy(png, 12);
    png.writeUInt32BE(1, 16);
    png.writeUInt32BE(1, 20);
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'one.png');
    const request = new NextRequest('http://localhost/api/uploads/images', {
      method: 'POST',
      body: form,
    });
    const { POST } = await import('@/app/api/uploads/images/route');

    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    const db = new Database(dbPath);
    const row = db
      .prepare(
        `SELECT message_id AS messageId, uploaded_by AS uploadedBy,
                relative_path AS relativePath, expires_at AS expiresAt
         FROM message_attachments WHERE id = ?`,
      )
      .get(body.data.attachmentId) as any;
    db.close();
    expect(row).toMatchObject({ messageId: null, uploadedBy: 'upload-user' });
    expect(row.expiresAt).toBeTruthy();
    expect(existsSync(join(dataRoot, 'uploads', row.relativePath))).toBe(true);
  });
});
