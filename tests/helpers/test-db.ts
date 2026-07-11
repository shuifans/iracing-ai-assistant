import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/db/schema';

export type TestDb = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = join(__dirname, '../../src/db/migrations');

/**
 * 创建内存 SQLite 数据库，执行全部迁移，返回 Drizzle 实例和清理函数。
 *
 * 如果 better-sqlite3 native 模块不可用（例如 Windows Node 24 编译失败），
 * import 阶段不会报错，仅在调用此函数时才会抛出异常。
 */
export function createTestDb(): {
  db: TestDb;
  rawDb: InstanceType<typeof import('better-sqlite3')>;
  cleanup: () => void;
} {
  // Lazy require so that a missing native module does not crash the import phase
  let Database: typeof import('better-sqlite3');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Database = require('better-sqlite3');
  } catch (err) {
    throw new Error(
      'better-sqlite3 native module is not available. ' +
        'createTestDb() requires a working native build. ' +
        `Original error: ${(err as Error).message}`,
    );
  }

  let drizzle: typeof import('drizzle-orm/better-sqlite3').drizzle;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    drizzle = require('drizzle-orm/better-sqlite3').drizzle;
  } catch (err) {
    throw new Error(
      `drizzle-orm/better-sqlite3 is not available. Original error: ${(err as Error).message}`,
    );
  }

  const rawDb = new Database(':memory:');
  rawDb.pragma('foreign_keys = ON');
  rawDb.pragma('busy_timeout = 5000');

  // 执行全部迁移 SQL
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    rawDb.exec(sql);
  }

  const db = drizzle(rawDb, { schema });

  return {
    db,
    rawDb,
    cleanup: () => {
      rawDb.close();
    },
  };
}
