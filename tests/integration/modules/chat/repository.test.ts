import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { resetDbForTesting } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import {
  createChatTurn,
  createMessage,
  createSession,
  hasActiveAssistantMessage,
  updateMessage,
  updateSessionWebSearch,
} from '@/modules/chat/repository';

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

  it('detects only pending or streaming assistant generations', () => {
    const session = createSession('owner');
    const assistant = createMessage(session.id, 'assistant', '', 'pending');

    expect(hasActiveAssistantMessage(session.id)).toBe(true);
    updateMessage(assistant.id, { status: 'interrupted' });
    expect(hasActiveAssistantMessage(session.id)).toBe(false);
  });

  it('atomically rejects a second turn without persisting another user message', () => {
    const session = createSession('owner');
    const first = createChatTurn(session.id, 'owner', 'first');

    expect(() => createChatTurn(session.id, 'owner', 'second')).toThrow(
      expect.objectContaining({ code: 'SESSION_BUSY' }),
    );
    const raw = new Database(process.env.DATABASE_PATH!);
    const rows = raw
      .prepare('SELECT role, content FROM messages WHERE session_id = ?')
      .all(session.id);
    raw.close();
    expect(rows).toEqual([
      expect.objectContaining({ role: 'user', content: 'first' }),
      expect.objectContaining({ role: 'assistant', content: '' }),
    ]);
    expect(first.assistantMessage.status).toBe('pending');
  });

  it('lets exactly one of two independent processes reserve a session turn', async () => {
    const session = createSession('owner');
    const workerPath = join(process.cwd(), 'tests/fixtures/chat-turn-concurrency-worker.ts');
    const runWorker = (content: string) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', workerPath, process.env.DATABASE_PATH!, session.id, content],
          { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += String(chunk)));
        child.stderr.on('data', (chunk) => (stderr += String(chunk)));
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code === 0) resolve(stdout.trim());
          else reject(new Error(`chat turn worker exited ${code}: ${stderr}`));
        });
      });

    const outcomes = await Promise.all([runWorker('process-a'), runWorker('process-b')]);

    expect(outcomes.sort()).toEqual(['SESSION_BUSY', 'success']);
    const raw = new Database(process.env.DATABASE_PATH!);
    const rows = raw
      .prepare('SELECT role, content FROM messages WHERE session_id = ?')
      .all(session.id);
    raw.close();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => (row as { role: string }).role === 'user')).toHaveLength(1);
  });
});
