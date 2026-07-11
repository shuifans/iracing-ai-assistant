import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

export type Db = BetterSQLite3Database<typeof schema>;

let _db: Db | null = null;
let _rawDb: Database.Database | null = null;

function createDatabase(dbPath: string): { drizzleDb: Db; rawDb: Database.Database } {
  // 确保数据库文件目录存在
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const rawDb = new Database(dbPath);

  // PRAGMA 配置（SPEC 第 4.2 节 + 性能优化）
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('foreign_keys = ON');
  rawDb.pragma('busy_timeout = 5000');
  rawDb.pragma('synchronous = NORMAL');
  rawDb.pragma('cache_size = -20000'); // 20MB 页缓存
  rawDb.pragma('temp_store = MEMORY');
  rawDb.pragma('wal_autocheckpoint = 1000');

  const drizzleDb = drizzle(rawDb, { schema });

  return { drizzleDb, rawDb };
}

/**
 * 获取数据库单例。Web 进程和 Worker 进程各维护自己的实例。
 * 首次调用时创建连接并执行 PRAGMA 初始化。
 */
export function getDb(): Db {
  if (!_db) {
    // 延迟导入 env 避免测试时的副作用
    const dbPath = process.env.DATABASE_PATH || './data/app.sqlite';
    const { drizzleDb, rawDb } = createDatabase(dbPath);
    _db = drizzleDb;
    _rawDb = rawDb;
  }
  return _db;
}

/**
 * 获取底层 better-sqlite3 Database 实例。
 * 仅用于需要直接执行 SQL 的场景（如迁移）。
 */
export function getRawDb(): Database.Database {
  if (!_rawDb) {
    getDb(); // 触发初始化
  }
  return _rawDb!;
}

/**
 * 关闭数据库连接。用于优雅退出。
 */
export function closeDb(): void {
  if (_rawDb) {
    _rawDb.close();
    _db = null;
    _rawDb = null;
  }
}

/**
 * 重置数据库单例（仅供测试使用）。
 */
export function resetDbForTesting(): void {
  closeDb();
}
