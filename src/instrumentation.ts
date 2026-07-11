export async function register() {
  // 仅在 Node.js runtime 执行（不在 Edge runtime）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { runMigrations } = await import('./db/migrate');
      const dbPath = process.env.DATABASE_PATH || './data/app.sqlite';
      runMigrations(dbPath);
      console.log('[instrumentation] Database migrations completed');
    } catch (err) {
      // 开发环境不阻塞启动
      if (process.env.NODE_ENV === 'production') {
        console.error('[instrumentation] Migration failed:', err);
        throw err;
      }
      console.warn('[instrumentation] Migration skipped (dev mode):', err);
    }
  }
}
