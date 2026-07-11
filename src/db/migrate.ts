import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function runMigrations(dbPath: string): void {
  const db = new Database(dbPath);

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

  // Run pending migrations
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');

    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
    });

    try {
      runMigration();
      console.log(`[migrate] Applied: ${file}`);
    } catch (err) {
      console.error(`[migrate] Failed: ${file}`, err);
      process.exit(1);
    }
  }

  db.close();
}

// CLI entry point
if (require.main === module) {
  const dbPath = process.env.DATABASE_PATH || './data/app.sqlite';
  console.log(`[migrate] Running migrations on: ${dbPath}`);
  runMigrations(dbPath);
  console.log('[migrate] Done');
}
