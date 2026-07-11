import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '@/db/migrate';
import { join } from 'path';
import { existsSync, unlinkSync, mkdtempSync } from 'fs';
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

  // ── 1. All 16 tables exist ─────────────────────────────────────────────────
  it('creates all 16 tables after migration', () => {
    const expectedTables = [
      'users',
      'refresh_tokens',
      'chat_sessions',
      'messages',
      'message_attachments',
      'message_sources',
      'message_feedback',
      'knowledge_sources',
      'knowledge_jobs',
      'knowledge_drafts',
      'knowledge_items',
      'usage_events',
      'rate_limit_configs',
      'rate_limit_buckets',
      'audit_logs',
      'system_settings',
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
    expect(actualTables.length).toBe(16);
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
