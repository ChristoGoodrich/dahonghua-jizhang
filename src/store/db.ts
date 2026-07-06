import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('dahonghua.db');
  }
  return db;
}

export function initDatabase(): void {
  const database = getDatabase();
  
  // 启用 WAL 模式提升性能
  database.execSync('PRAGMA journal_mode = WAL;');
  
  // 创建 entries 表 — 使用 camelCase 列名匹配 TypeScript 类型
  database.execSync(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      io TEXT NOT NULL CHECK(io IN ('exp', 'inc', 'xfer')),
      cat TEXT NOT NULL,
      amt REAL NOT NULL,
      note TEXT,
      acct TEXT,
      acctTo TEXT,
      fee REAL,
      discount REAL,
      subcat TEXT,
      cur TEXT,
      origAmt REAL,
      tags TEXT,
      ledger TEXT,
      rb TEXT,
      rbAmt REAL,
      refund REAL,
      refundOf TEXT,
      fromSub INTEGER,
      deletedAt INTEGER,
      updatedAt INTEGER,
      fieldTs TEXT,
      userId TEXT
    );
  `);

  // 创建索引
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_entries_ts ON entries(ts);
    CREATE INDEX IF NOT EXISTS idx_entries_io ON entries(io);
    CREATE INDEX IF NOT EXISTS idx_entries_cat ON entries(cat);
    CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(userId);
    CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deletedAt);
  `);

  // 创建 accounts 表 — 使用 camelCase 列名匹配 TypeScript 类型
  database.execSync(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nameEn TEXT,
      balance REAL NOT NULL DEFAULT 0,
      kind TEXT DEFAULT 'cash'
    );
  `);

  // 创建 settings 表 (key-value 存储)
  database.execSync(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
