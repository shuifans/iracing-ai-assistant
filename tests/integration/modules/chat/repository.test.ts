import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetDbForTesting } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createSession, updateSessionWebSearch } from '@/modules/chat/repository';

describe('chat session repository', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chat-session-repository-'));
    process.env.DATABASE_PATH = join(tempDir, 'app.sqlite');
    runMigrations(process.env.DATABASE_PATH);

    const raw = new Database(process.env.DATABASE_PATH);
    raw.pragma('foreign_keys = ON');
    for (const [id, username] of [
      ['owner', 'alice'],
      ['other', 'bob'],
    ] as const) {
      raw
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, 'hash', 'user', 'active', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')`,
        )
        .run(id, username);
    }
    raw.close();
    resetDbForTesting();
  });

  afterEach(() => {
    resetDbForTesting();
    delete process.env.DATABASE_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('defaults a new session to web search disabled', () => {
    const session = createSession('owner');

    expect(session.webSearchEnabled).toBe(false);
  });

  it('updates web search only for the owning user', () => {
    const session = createSession('owner');

    expect(updateSessionWebSearch(session.id, 'owner', true)?.webSearchEnabled).toBe(true);
    expect(updateSessionWebSearch(session.id, 'other', false)).toBeNull();
  });
});
