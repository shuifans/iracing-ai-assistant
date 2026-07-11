import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

let canLoadBetterSqlite3 = false;
try {
  const Database = require('better-sqlite3');
  // 必须实际尝试创建实例来验证 native binding 可用
  const testDb = new Database(':memory:');
  testDb.close();
  canLoadBetterSqlite3 = true;
} catch {
  // native module not available or binding missing
}

// 动态导入 — 当 better-sqlite3 不可用时避免顶层 import 报错
let mod: typeof import('../../../src/db/client') | null = null;

async function loadClient() {
  if (!mod) {
    mod = await import('../../../src/db/client');
  }
  return mod;
}

describe.skipIf(!canLoadBetterSqlite3)('database client', () => {
  let tempDir: string;

  afterEach(async () => {
    const client = await loadClient();
    client.resetDbForTesting();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    delete process.env.DATABASE_PATH;
  });

  function setTempDbPath(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'iracing-test-'));
    const dbPath = join(tempDir, 'test.sqlite');
    process.env.DATABASE_PATH = dbPath;
    return dbPath;
  }

  it('getDb() returns a Drizzle instance', async () => {
    setTempDbPath();
    const { getDb } = await loadClient();
    const db = getDb();
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
    expect(typeof db.insert).toBe('function');
  });

  it('getDb() returns the same instance (singleton)', async () => {
    setTempDbPath();
    const { getDb } = await loadClient();
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it('getRawDb() returns the underlying better-sqlite3 Database', async () => {
    setTempDbPath();
    const { getRawDb } = await loadClient();
    const raw = getRawDb();
    expect(raw).toBeDefined();
    expect(typeof raw.exec).toBe('function');
    expect(typeof raw.prepare).toBe('function');
    expect(typeof raw.close).toBe('function');
  });

  it('closeDb() then getDb() creates a new instance', async () => {
    setTempDbPath();
    const { getDb, closeDb } = await loadClient();
    const db1 = getDb();
    closeDb();
    const db2 = getDb();
    expect(db2).toBeDefined();
    expect(db2).not.toBe(db1);
  });

  it('resetDbForTesting() resets the singleton', async () => {
    setTempDbPath();
    const { getDb, resetDbForTesting } = await loadClient();
    const db1 = getDb();
    resetDbForTesting();
    const db2 = getDb();
    expect(db2).toBeDefined();
    expect(db2).not.toBe(db1);
  });
});
