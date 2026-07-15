import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '@/db/migrate';
import { join } from 'path';
import { existsSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Skip all tests if better-sqlite3 native module fails to load
let nativeOk = true;
try {
  // Quick check: can we instantiate an in-memory DB?
  const probe = new Database(':memory:');
  probe.close();
} catch {
  nativeOk = false;
}

const describeIf = nativeOk ? describe : describe.skip;

describeIf('Database migration', () => {
  let db: Database.Database;
  let dbPath: string;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'iracing-test-'));
    dbPath = join(tmpDir, 'test.sqlite');
    runMigrations(dbPath);
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
  });

  afterAll(() => {
    db?.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  // ── 1. All tables exist ────────────────────────────────────────────────────
  it('creates all tables after migration', () => {
    const expectedTables = [
      'users',
      'refresh_tokens',
      'chat_sessions',
      'messages',
      'message_attachments',
      'message_sources',
      'message_feedback',
      'web_knowledge_sources',
      'knowledge_sources',
      'knowledge_jobs',
      'knowledge_drafts',
      'knowledge_items',
      'usage_events',
      'rate_limit_configs',
      'rate_limit_buckets',
      'audit_logs',
      'system_settings',
      // knowledge-evaluation + retrieval-cache features (migrations B & C)
      'knowledge_evaluations',
      'evaluation_dimensions',
      'evaluation_feedback',
      'retrieval_cache',
    ];

    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__migrations'",
      )
      .all() as { name: string }[];

    const actualTables = rows.map((r) => r.name).sort();

    for (const t of expectedTables) {
      expect(actualTables).toContain(t);
    }
    expect(actualTables.length).toBe(21);
  });

  // ── 2. Idempotent ──────────────────────────────────────────────────────────
  it('is idempotent (running migrations again does not throw)', () => {
    expect(() => runMigrations(dbPath)).not.toThrow();
  });

  // ── 3. __migrations table records applied migrations ───────────────────────
  it('records applied migrations in __migrations table', () => {
    const rows = db.prepare('SELECT name, applied_at FROM __migrations').all() as {
      name: string;
      applied_at: string;
    }[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.name).toBe('20260711000000_A_initial_schema.sql');
    expect(rows[0]!.applied_at).toBeTruthy();
  });

  it('creates the owned nullable attachment schema with both foreign keys', () => {
    const columns = db.prepare('PRAGMA table_info(message_attachments)').all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(columns.find((column) => column.name === 'message_id')?.notnull).toBe(0);
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['uploaded_by', 'expires_at', 'bound_at']),
    );

    const foreignKeys = db.prepare('PRAGMA foreign_key_list(message_attachments)').all() as Array<{
      from: string;
      table: string;
    }>;
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'message_id', table: 'messages' }),
        expect.objectContaining({ from: 'uploaded_by', table: 'users' }),
      ]),
    );
  });

  it('preserves legacy attachment rows and derives their owner during upgrade', () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'attachment-migration-'));
    const legacyPath = join(legacyDir, 'legacy.sqlite');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    `);
    const migrationNames = [
      '20260711000000_A_initial_schema.sql',
      '20260713000000_B_add_retrieval_cache.sql',
      '20260713120000_C_evaluation.sql',
      '20260714000000_D_seed_rate_limit_defaults.sql',
    ];
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    for (const name of migrationNames) {
      legacy.exec(readFileSync(join(process.cwd(), 'src/db/migrations', name), 'utf8'));
      legacy.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(
        name,
        '2026-07-14T00:00:00.000Z',
      );
    }
    legacy.exec(`
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('legacy-user', 'legacy', 'hash', 'user', 'active', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z');
      INSERT INTO chat_sessions (id, user_id, title, status, created_at, updated_at, last_message_at)
      VALUES ('legacy-session', 'legacy-user', 'chat', 'active', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z');
      INSERT INTO messages (id, session_id, role, status, content, created_at)
      VALUES ('legacy-message', 'legacy-session', 'user', 'complete', 'hello', '2026-07-14T00:00:00.000Z');
      INSERT INTO message_attachments (id, message_id, kind, relative_path, mime_type, size_bytes, sha256, created_at)
      VALUES ('legacy-attachment', 'legacy-message', 'image', 'chat/old.png', 'image/png', 10, 'sha', '2026-07-14T00:00:00.000Z');
    `);
    legacy.close();

    runMigrations(legacyPath);
    const upgraded = new Database(legacyPath);
    upgraded.pragma('foreign_keys = ON');
    expect(
      upgraded
        .prepare(
          `SELECT id, message_id AS messageId, uploaded_by AS uploadedBy, bound_at AS boundAt
           FROM message_attachments WHERE id = 'legacy-attachment'`,
        )
        .get(),
    ).toEqual({
      id: 'legacy-attachment',
      messageId: 'legacy-message',
      uploadedBy: 'legacy-user',
      boundAt: '2026-07-14T00:00:00.000Z',
    });
    expect(upgraded.pragma('foreign_key_check')).toEqual([]);
    upgraded.close();
    rmSync(legacyDir, { recursive: true, force: true });
  });

  it('seeds safe default rate-limit configs on a fresh database', () => {
    const rows = db
      .prepare(
        `SELECT scope, scope_key AS scopeKey, per_minute_limit AS perMinuteLimit,
                per_day_limit AS perDayLimit, max_session_turns AS maxSessionTurns,
                enabled
         FROM rate_limit_configs
         ORDER BY CASE scope WHEN 'global' THEN 1 WHEN 'role' THEN 2 ELSE 3 END, scope_key`,
      )
      .all();

    expect(rows).toEqual([
      {
        scope: 'global',
        scopeKey: 'global',
        perMinuteLimit: 60,
        perDayLimit: 2000,
        maxSessionTurns: 30,
        enabled: 1,
      },
      {
        scope: 'role',
        scopeKey: 'admin',
        perMinuteLimit: 120,
        perDayLimit: 2000,
        maxSessionTurns: 30,
        enabled: 1,
      },
      {
        scope: 'role',
        scopeKey: 'knowledge_admin',
        perMinuteLimit: 60,
        perDayLimit: 1000,
        maxSessionTurns: 30,
        enabled: 1,
      },
      {
        scope: 'role',
        scopeKey: 'user',
        perMinuteLimit: 30,
        perDayLimit: 500,
        maxSessionTurns: 30,
        enabled: 1,
      },
      {
        scope: 'user',
        scopeKey: '*',
        perMinuteLimit: 10,
        perDayLimit: 100,
        maxSessionTurns: 30,
        enabled: 1,
      },
    ]);
  });

  // ── 4. CHECK constraint: invalid role ──────────────────────────────────────
  it('rejects invalid role via CHECK constraint', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
         VALUES ('u1', 'badrole', 'hash', 'superadmin', 'active', datetime('now'), datetime('now'))`,
      ).run();
    }).toThrow();
  });

  // ── 5. UNIQUE constraint: duplicate username ───────────────────────────────
  it('rejects duplicate username via UNIQUE constraint', () => {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
       VALUES ('u-unique-1', 'alice', 'hash', 'user', 'active', datetime('now'), datetime('now'))`,
    ).run();

    expect(() => {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
         VALUES ('u-unique-2', 'alice', 'hash2', 'user', 'active', datetime('now'), datetime('now'))`,
      ).run();
    }).toThrow();
  });

  // ── 6. FK CASCADE: deleting user cascades to refresh_tokens ────────────────
  it('cascades delete from users to refresh_tokens', () => {
    const userId = 'u-cascade-1';
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
       VALUES (?, 'cascadeuser', 'hash', 'user', 'active', datetime('now'), datetime('now'))`,
    ).run(userId);

    db.prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at, created_at)
       VALUES ('rt-1', ?, 'thash', 'fam1', datetime('now', '+1 day'), datetime('now'))`,
    ).run(userId);

    // Verify token exists
    const before = db.prepare('SELECT id FROM refresh_tokens WHERE id = ?').get('rt-1');
    expect(before).toBeDefined();

    // Delete user
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    // Token should be gone
    const after = db.prepare('SELECT id FROM refresh_tokens WHERE id = ?').get('rt-1');
    expect(after).toBeUndefined();
  });

  // ── 7. COLLATE NOCASE: username case-insensitive uniqueness ────────────────
  it('enforces case-insensitive uniqueness on users.username', () => {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
       VALUES ('u-nocase-1', 'Bob', 'hash', 'user', 'active', datetime('now'), datetime('now'))`,
    ).run();

    expect(() => {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
         VALUES ('u-nocase-2', 'bob', 'hash2', 'user', 'active', datetime('now'), datetime('now'))`,
      ).run();
    }).toThrow();
  });

  // ── 8. knowledge_jobs.progress range constraint ────────────────────────────
  it('enforces progress range 0-100 on knowledge_jobs', () => {
    // Need a knowledge_source first
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
       VALUES ('u-job-1', 'jobuser', 'hash', 'user', 'active', datetime('now'), datetime('now'))`,
    ).run();

    db.prepare(
      `INSERT INTO knowledge_sources (id, input_type, sha256, size_bytes, status, submitted_by, created_at, updated_at)
       VALUES ('ks-1', 'file', 'abc123', 1024, 'stored', 'u-job-1', datetime('now'), datetime('now'))`,
    ).run();

    // progress = 101 should fail
    expect(() => {
      db.prepare(
        `INSERT INTO knowledge_jobs (id, source_id, status, available_at, progress, created_at, updated_at)
         VALUES ('kj-bad', 'ks-1', 'queued', datetime('now'), 101, datetime('now'), datetime('now'))`,
      ).run();
    }).toThrow();

    // progress = -1 should fail
    expect(() => {
      db.prepare(
        `INSERT INTO knowledge_jobs (id, source_id, status, available_at, progress, created_at, updated_at)
         VALUES ('kj-bad2', 'ks-1', 'queued', datetime('now'), -1, datetime('now'), datetime('now'))`,
      ).run();
    }).toThrow();

    // progress = 50 should succeed
    expect(() => {
      db.prepare(
        `INSERT INTO knowledge_jobs (id, source_id, status, available_at, progress, created_at, updated_at)
         VALUES ('kj-ok', 'ks-1', 'queued', datetime('now'), 50, datetime('now'), datetime('now'))`,
      ).run();
    }).not.toThrow();
  });
});
