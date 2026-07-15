import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@/db/migrate';
import { resetDbForTesting } from '@/db/client';
import { createSession, getSession } from '@/modules/chat/repository';

function stubGenerator(): AsyncGenerator<any> {
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      return { value: undefined, done: true };
    },
    async return(value?: any) {
      return { value, done: true };
    },
    async throw(error?: any) {
      throw error;
    },
  } as unknown as AsyncGenerator<any>;
}

vi.mock('@qoder-ai/qoder-agent-sdk', () => ({
  query: vi.fn(() => stubGenerator()),
  accessTokenFromEnv: vi.fn(() => ({
    type: 'accessToken',
    accessToken: { envVar: 'QODER_PERSONAL_ACCESS_TOKEN' },
  })),
}));

describe('chat eval Web fixture', () => {
  let tempDir: string;
  let snapshotPath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-chat-support-'));
    const dbPath = join(tempDir, 'eval.sqlite');
    snapshotPath = join(tempDir, 'notes', 'knowledge-sources.md');
    process.env.DATABASE_PATH = dbPath;
    process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH = snapshotPath;
    runMigrations(dbPath);
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
       VALUES ('eval-admin', 'eval-admin', 'hash', 'admin', 'active', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')`,
    ).run();
    db.close();
    resetDbForTesting();
  });

  afterAll(() => {
    resetDbForTesting();
    delete process.env.DATABASE_PATH;
    delete process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a narrow official rule and applies per-category session Web state', async () => {
    const { ensureEvalWebKnowledgeFixture, setEvalSessionWebState } =
      await import('../../../scripts/eval-chat-support');

    const fixture = ensureEvalWebKnowledgeFixture('eval-admin');
    expect(fixture.rules).toEqual([
      expect.objectContaining({
        scopeType: 'domain',
        hostname: 'support.iracing.com',
        sourceLevel: 'official',
      }),
    ]);
    expect(readFileSync(fixture.snapshotPath, 'utf8')).toContain('https://support.iracing.com/');

    const session = createSession('eval-admin', 'eval');
    expect(getSession(session.id, 'eval-admin')?.webSearchEnabled).toBe(false);
    expect(setEvalSessionWebState(session.id, 'eval-admin', 'A1')).toBe(false);
    expect(getSession(session.id, 'eval-admin')?.webSearchEnabled).toBe(false);
    expect(setEvalSessionWebState(session.id, 'eval-admin', 'A2')).toBe(true);
    expect(getSession(session.id, 'eval-admin')?.webSearchEnabled).toBe(true);
    expect(setEvalSessionWebState(session.id, 'eval-admin', 'A4')).toBe(false);
    expect(getSession(session.id, 'eval-admin')?.webSearchEnabled).toBe(false);

    const { createChatQuery } = await import('@/modules/agent/client');
    const { query } = await import('@qoder-ai/qoder-agent-sdk');
    const onAllowedToolUse = vi.fn();
    createChatQuery(
      {
        wikiRoot: tempDir,
        pat: 'test-pat',
        model: 'Qwen3.7-Plus',
        chatTimeoutMs: 120_000,
        cleanTimeoutMs: 900_000,
      },
      {
        userMessage: '2026 赛季有什么更新？',
        abortController: new AbortController(),
        webSearchEnabled: true,
        loadWebSourceRules: () => fixture.rules,
        webSourcesSnapshotPath: fixture.snapshotPath,
        onAllowedToolUse,
      },
    );
    const call = (query as unknown as Mock).mock.calls.at(-1)![0] as any;
    const hook = call.options.hooks.PreToolUse[0].hooks[0];

    for (const input of [
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'WebSearch',
        tool_use_id: 'search-1',
        tool_input: { query: 'site:support.iracing.com iRacing 2026 season' },
      },
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'WebFetch',
        tool_use_id: 'fetch-1',
        tool_input: { url: 'https://support.iracing.com/hc/en-us/articles/1' },
      },
    ]) {
      await expect(hook(input)).resolves.toMatchObject({
        hookSpecificOutput: { permissionDecision: 'allow' },
      });
    }
    expect(onAllowedToolUse.mock.calls.map(([event]) => event.name)).toEqual([
      'WebSearch',
      'WebFetch',
    ]);
  });
});
