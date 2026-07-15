export async function register() {
  // 仅在 Node.js runtime 执行（不在 Edge runtime）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { runMigrations } = await import('./db/migrate');
      const { join } = await import('node:path');
      const dbPath = process.env.DATABASE_PATH || './data/app.sqlite';
      runMigrations(dbPath, {
        snapshotPath:
          process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH ??
          join(process.cwd(), 'notes/knowledge-sources.md'),
      });
      console.log('[instrumentation] Database migrations completed');
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        err.code === 'WEB_SOURCES_SNAPSHOT_WRITE_FAILED'
      ) {
        throw err;
      }
      // Migrations are applied explicitly during deploy (deploy.sh runs
      // `npx tsx src/db/migrate.ts` from source). This startup hook is a best-effort
      // safety net; in the standalone build the bundled migrate.ts resolves the
      // migrations dir to `.next/.../chunks/migrations` (the .sql files are read
      // dynamically, so Next.js doesn't auto-trace them there), so a scan can throw
      // here. Never crash the server on a migration scan failure — log and continue;
      // the deploy step has already applied migrations.
      console.error('[instrumentation] Migration skipped (applied via deploy step):', err);
    }
  }
}
