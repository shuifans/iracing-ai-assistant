import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { writeWebSourcesSnapshot } from '../modules/web-sources/snapshot';
import type { WebKnowledgeSource } from './schema/web-sources';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

export interface MigrationOptions {
  /** Print pending migrations without executing them */
  dryRun?: boolean;
  /** Run migrations then verify DB integrity via PRAGMA integrity_check */
  validate?: boolean;
  /** Regenerate the DB-backed Web source snapshot at this explicit target path. */
  snapshotPath?: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  valid: boolean;
}

export class MigrationSnapshotError extends Error {
  readonly code = 'WEB_SOURCES_SNAPSHOT_WRITE_FAILED';

  constructor(snapshotPath: string, cause: unknown) {
    super(`Failed to regenerate Web source snapshot at ${snapshotPath}`, { cause });
    this.name = 'MigrationSnapshotError';
  }
}

export function runMigrations(dbPath: string, options: MigrationOptions = {}): MigrationResult {
  const db = new Database(dbPath);
  const result: MigrationResult = { applied: [], skipped: [], valid: true };

  // PRAGMA settings
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // Read migration files
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Get already applied migrations
  const applied = new Set(
    db
      .prepare('SELECT name FROM __migrations')
      .all()
      .map((row: unknown) => (row as { name: string }).name),
  );

  // Collect pending migrations
  const pending = files.filter((f) => !applied.has(f));
  result.skipped = files.filter((f) => applied.has(f));

  if (options.dryRun) {
    // Dry-run: only report what would be applied
    for (const file of pending) {
      console.log(`[migrate][dry-run] Would apply: ${file}`);
    }
    if (pending.length === 0) {
      console.log('[migrate][dry-run] No pending migrations.');
    }
    db.close();
    return result;
  }

  // Run pending migrations
  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');

    // Table-rebuild migrations (DROP + RENAME) require FK checks disabled.
    // PRAGMA foreign_keys cannot be changed inside a transaction.
    db.pragma('foreign_keys = OFF');
    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
    });

    try {
      runMigration();
      result.applied.push(file);
      console.log(`[migrate] Applied: ${file}`);
    } catch (err) {
      console.error(`[migrate] Failed: ${file}`, err);
      result.valid = false;
      db.pragma('foreign_keys = ON');
      db.close();
      process.exit(1);
    }
    db.pragma('foreign_keys = ON');
  }

  if (pending.length === 0) {
    console.log('[migrate] No pending migrations.');
  }

  if (options.snapshotPath) {
    const rows = db
      .prepare(
        `SELECT id, name, scope_type AS scopeType, url, source_level AS sourceLevel,
                enabled, description, created_by AS createdBy, updated_by AS updatedBy,
                created_at AS createdAt, updated_at AS updatedAt
         FROM web_knowledge_sources`,
      )
      .all() as Array<Omit<WebKnowledgeSource, 'enabled'> & { enabled: number }>;
    try {
      writeWebSourcesSnapshot(
        rows.map((row) => ({ ...row, enabled: row.enabled !== 0 })),
        options.snapshotPath,
      );
    } catch (error) {
      db.close();
      throw new MigrationSnapshotError(options.snapshotPath, error);
    }
  }

  // Validate: run integrity check
  if (options.validate) {
    const check = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (check.integrity_check === 'ok') {
      console.log('[migrate][validate] Integrity check passed.');
    } else {
      console.error('[migrate][validate] Integrity check FAILED:', check.integrity_check);
      result.valid = false;
    }
  }

  db.close();
  return result;
}

/**
 * Rollback the last N applied migrations.
 * Expects reverse migration SQL files named with `.rollback.sql` suffix.
 */
export function rollbackMigrations(dbPath: string, steps = 1): void {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const applied = db
    .prepare('SELECT name FROM __migrations ORDER BY applied_at DESC LIMIT ?')
    .all(steps) as { name: string }[];

  if (applied.length === 0) {
    console.log('[migrate][rollback] No migrations to roll back.');
    db.close();
    return;
  }

  for (const row of applied) {
    const baseName = row.name;
    const rollbackFile = baseName.replace('.sql', '.rollback.sql');
    const rollbackPath = join(MIGRATIONS_DIR, rollbackFile);

    try {
      const sql = readFileSync(rollbackPath, 'utf-8');
      const doRollback = db.transaction(() => {
        db.exec(sql);
        db.prepare('DELETE FROM __migrations WHERE name = ?').run(baseName);
      });
      doRollback();
      console.log(`[migrate][rollback] Rolled back: ${baseName}`);
    } catch (err) {
      console.error(`[migrate][rollback] Failed to roll back: ${baseName}`, err);
      db.close();
      process.exit(1);
    }
  }

  db.close();
  console.log(`[migrate][rollback] Rolled back ${applied.length} migration(s).`);
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const validate = args.includes('--validate');
  const rollback = args.includes('--rollback');

  const dbPath = process.env.DATABASE_PATH || './data/app.sqlite';

  if (rollback) {
    const stepsIdx = args.indexOf('--steps');
    const stepsRaw = stepsIdx !== -1 ? args[stepsIdx + 1] : undefined;
    const steps = stepsRaw ? parseInt(stepsRaw, 10) : 1;
    console.log(`[migrate] Rolling back up to ${steps} migration(s) on: ${dbPath}`);
    rollbackMigrations(dbPath, steps);
  } else {
    const mode = [dryRun && 'dry-run', validate && 'validate'].filter(Boolean).join(', ');
    console.log(`[migrate] Running migrations on: ${dbPath}${mode ? ` (${mode})` : ''}`);
    const result = runMigrations(dbPath, {
      dryRun,
      validate,
      snapshotPath:
        process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH ??
        join(process.cwd(), 'notes/knowledge-sources.md'),
    });
    if (!result.valid) {
      process.exit(1);
    }
    console.log('[migrate] Done');
  }
}
