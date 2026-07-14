import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@/db/migrate';
import { resetDbForTesting } from '@/db/client';
import {
  createAttachment,
  createUserMessageWithAttachments,
  getAttachment,
} from '@/modules/chat/repository';

describe('owned two-phase chat attachments', () => {
  let tempDir: string;
  let dbPath: string;
  let raw: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chat-attachments-'));
    dbPath = join(tempDir, 'app.sqlite');
    process.env.DATABASE_PATH = dbPath;
    runMigrations(dbPath);
    raw = new Database(dbPath);
    raw.pragma('foreign_keys = ON');
    for (const [id, username] of [['user-a', 'alice'], ['user-b', 'bob']] as const) {
      raw.prepare(
        `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, 'hash', 'user', 'active', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z')`,
      ).run(id, username);
      raw.prepare(
        `INSERT INTO chat_sessions (id, user_id, title, status, created_at, updated_at, last_message_at)
         VALUES (?, ?, 'chat', 'active', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z')`,
      ).run(`session-${id}`, id);
    }
    raw.close();
    resetDbForTesting();
  });

  afterEach(() => {
    resetDbForTesting();
    delete process.env.DATABASE_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function upload(owner = 'user-a', sizeBytes = 4) {
    return createAttachment(owner, {
      kind: 'image',
      relativePath: 'chat/2026/07/image.png',
      mimeType: 'image/png',
      sizeBytes,
      sha256: 'abc',
      width: 1,
      height: 1,
    });
  }

  it('creates an unbound owned upload with expiry metadata', () => {
    const attachment = upload();

    expect(attachment.messageId).toBeNull();
    expect(attachment.uploadedBy).toBe('user-a');
    expect(attachment.expiresAt).toBeTruthy();
    expect(attachment.boundAt).toBeNull();
  });

  it('atomically binds an owner upload to the new user message', () => {
    const attachment = upload();

    const message = createUserMessageWithAttachments(
      'session-user-a',
      'user-a',
      'inspect this',
      [attachment.id],
    );

    expect(getAttachment(attachment.id)?.messageId).toBe(message.id);
    expect(getAttachment(attachment.id)?.boundAt).toBeTruthy();
  });

  it('rejects cross-user binding without creating a message', () => {
    const attachment = upload('user-a');

    expect(() =>
      createUserMessageWithAttachments(
        'session-user-b',
        'user-b',
        'steal this',
        [attachment.id],
      ),
    ).toThrow();

    const db = new Database(dbPath);
    expect(
      db.prepare("SELECT count(*) AS count FROM messages WHERE session_id = 'session-user-b'").get(),
    ).toEqual({ count: 0 });
    expect(db.prepare('SELECT message_id FROM message_attachments WHERE id = ?').get(attachment.id)).toEqual({
      message_id: null,
    });
    db.close();
  });

  it('does not partially bind an owned upload when the batch also contains another user upload', () => {
    const owned = upload('user-a');
    const foreign = upload('user-b');

    expect(() =>
      createUserMessageWithAttachments(
        'session-user-a',
        'user-a',
        'mixed owners',
        [owned.id, foreign.id],
      ),
    ).toThrow();

    const db = new Database(dbPath);
    expect(db.prepare("SELECT count(*) AS count FROM messages WHERE content = 'mixed owners'").get()).toEqual({
      count: 0,
    });
    expect(
      db.prepare(
        'SELECT id, message_id AS messageId FROM message_attachments WHERE id IN (?, ?) ORDER BY id',
      ).all(owned.id, foreign.id),
    ).toEqual(
      [owned.id, foreign.id]
        .sort()
        .map((id) => ({ id, messageId: null })),
    );
    db.close();
  });

  it('rejects a second binding without creating another message', () => {
    const attachment = upload();
    createUserMessageWithAttachments('session-user-a', 'user-a', 'first', [attachment.id]);

    expect(() =>
      createUserMessageWithAttachments('session-user-a', 'user-a', 'second', [attachment.id]),
    ).toThrow();

    const db = new Database(dbPath);
    expect(
      db.prepare("SELECT count(*) AS count FROM messages WHERE session_id = 'session-user-a'").get(),
    ).toEqual({ count: 1 });
    db.close();
  });

  it('rejects more than four attachments with no message or partial binding', () => {
    const attachments = Array.from({ length: 5 }, () => upload());

    expect(() =>
      createUserMessageWithAttachments(
        'session-user-a',
        'user-a',
        'too many',
        attachments.map((attachment) => attachment.id),
      ),
    ).toThrow('最多');

    const db = new Database(dbPath);
    expect(db.prepare('SELECT count(*) AS count FROM messages').get()).toEqual({ count: 0 });
    expect(
      db.prepare('SELECT count(*) AS count FROM message_attachments WHERE message_id IS NOT NULL').get(),
    ).toEqual({ count: 0 });
    db.close();
  });

  it('accepts exactly 20 MiB total but rejects 20 MiB + 1 with no partial write', () => {
    const tenMiB = 10 * 1024 * 1024;
    const atBoundary = [upload('user-a', tenMiB), upload('user-a', tenMiB)];
    expect(() =>
      createUserMessageWithAttachments(
        'session-user-a',
        'user-a',
        'at boundary',
        atBoundary.map((attachment) => attachment.id),
      ),
    ).not.toThrow();

    const overBoundary = [upload('user-a', tenMiB), upload('user-a', tenMiB), upload('user-a', 1)];
    expect(() =>
      createUserMessageWithAttachments(
        'session-user-a',
        'user-a',
        'over boundary',
        overBoundary.map((attachment) => attachment.id),
      ),
    ).toThrow('总大小');

    const db = new Database(dbPath);
    expect(
      db.prepare("SELECT count(*) AS count FROM messages WHERE content = 'over boundary'").get(),
    ).toEqual({ count: 0 });
    expect(
      db.prepare(
        `SELECT count(*) AS count FROM message_attachments
         WHERE id IN (?, ?, ?) AND message_id IS NOT NULL`,
      ).get(...overBoundary.map((attachment) => attachment.id)),
    ).toEqual({ count: 0 });
    db.close();
  });

  it('rejects an expired attachment with no message or partial binding', () => {
    const attachment = upload();
    const db = new Database(dbPath);
    db.prepare(
      "UPDATE message_attachments SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
    ).run(attachment.id);
    db.close();
    resetDbForTesting();

    expect(() =>
      createUserMessageWithAttachments(
        'session-user-a',
        'user-a',
        'expired',
        [attachment.id],
      ),
    ).toThrow('过期');

    const check = new Database(dbPath);
    expect(check.prepare("SELECT count(*) AS count FROM messages WHERE content = 'expired'").get()).toEqual({
      count: 0,
    });
    expect(check.prepare('SELECT message_id FROM message_attachments WHERE id = ?').get(attachment.id)).toEqual({
      message_id: null,
    });
    check.close();
  });
});
