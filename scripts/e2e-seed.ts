/**
 * E2E seed — run via `npx tsx scripts/e2e-seed.ts` (tsx resolves the `@/` alias).
 *
 * Wipes the test DB (DATABASE_PATH), applies migrations, and seeds:
 *   - e2e-admin       / e2e-admin-pw-123     (role=admin)
 *   - e2e-kadmin      / e2e-kadmin-pw-123    (role=knowledge_admin)
 *   - e2e-user01..20  / e2e-user-pw-123      (role=user)        → >20 rows for /admin/users pagination
 *   - 21 knowledge_sources (submitted by e2e-kadmin)           → >20 rows for /knowledge sources pagination
 *
 * Idempotent: deletes the DB file (+WAL/SHM) first.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { hashPassword } from '@/modules/auth/password';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import { runMigrations } from '@/db/migrate';

const DB_PATH = process.env.DATABASE_PATH;
const DATA_ROOT = process.env.DATA_ROOT || join(process.cwd(), 'data/e2e');
const WIKI_ROOT = process.env.WIKI_ROOT || join(DATA_ROOT, 'md-wiki');

async function main() {
  if (!DB_PATH) throw new Error('DATABASE_PATH env not set');

  // Clean slate (idempotent).
  for (const ext of ['', '-wal', '-shm']) {
    const p = DB_PATH + ext;
    if (existsSync(p)) rmSync(p, { force: true });
  }
  mkdirSync(dirname(DB_PATH), { recursive: true });
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(WIKI_ROOT, { recursive: true });
  mkdirSync(join(DATA_ROOT, 'uploads'), { recursive: true });

  const mig = runMigrations(DB_PATH);
  console.log(`[e2e-seed] migrations: ${mig.applied.length} applied, ${mig.skipped.length} skipped`);

  const adminHash = await hashPassword('e2e-admin-pw-123');
  const kadminHash = await hashPassword('e2e-kadmin-pw-123');
  const userHash = await hashPassword('e2e-user-pw-123');

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  const now = utcNow();

  const insertUser = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at, approved_at)
     VALUES (@id, @username, @passwordHash, @role, 'active', @now, @now, @now)`,
  );
  const insertSource = db.prepare(
    `INSERT INTO knowledge_sources (id, input_type, original_name, mime_type, relative_path, source_url, sha256, size_bytes, status, submitted_by, created_at, updated_at)
     VALUES (@id, 'file', @originalName, 'text/plain', NULL, NULL, @sha256, 10, 'stored', @submittedBy, @now, @now)`,
  );

  const kadminId = generateId();
  db.transaction(() => {
    insertUser.run({ id: generateId(), username: 'e2e-admin', passwordHash: adminHash, role: 'admin', now });
    insertUser.run({ id: kadminId, username: 'e2e-kadmin', passwordHash: kadminHash, role: 'knowledge_admin', now });
    for (let i = 1; i <= 20; i++) {
      insertUser.run({
        id: generateId(),
        username: `e2e-user${String(i).padStart(2, '0')}`,
        passwordHash: userHash,
        role: 'user',
        now,
      });
    }
    for (let i = 1; i <= 21; i++) {
      insertSource.run({
        id: generateId(),
        originalName: `e2e-source-${i}.txt`,
        sha256: `e2e-seed-${String(i).padStart(4, '0')}`,
        submittedBy: kadminId,
        now,
      });
    }
  })();

  db.close();
  console.log(
    '[e2e-seed] seeded: e2e-admin, e2e-kadmin, 20 users, 21 knowledge_sources (submitted_by=e2e-kadmin)',
  );
}

main().catch((err: unknown) => {
  console.error('[e2e-seed] FAILED:', err);
  process.exit(1);
});
