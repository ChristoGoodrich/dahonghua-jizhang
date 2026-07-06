import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase } from './db';
import type { Entry, Account } from '@/domain/types';

const MIGRATION_FLAG = 'asyncStorageMigrated';

/** Check whether the AsyncStorage→SQLite migration has already run. */
export function needsMigration(): boolean {
  const db = getDatabase();
  const row = db.getFirstSync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [MIGRATION_FLAG],
  );
  return !row;
}

/** Migrate entries and config from AsyncStorage into SQLite tables. */
export async function migrateToSQLite(): Promise<void> {
  const db = getDatabase();

  const [entriesRaw, configRaw] = await Promise.all([
    AsyncStorage.getItem('dhh_entries_v1'),
    AsyncStorage.getItem('dhh_config_v1'),
  ]);

  const entries: Entry[] = entriesRaw ? JSON.parse(entriesRaw) : [];
  const config: Record<string, unknown> = configRaw ? JSON.parse(configRaw) : {};

  db.execSync('BEGIN');
  try {
    // --- entries ---
    if (entries.length > 0) {
      const stmt = `INSERT OR REPLACE INTO entries (
        id, ts, io, cat, amt, note, acct, acctTo, fee, discount,
        subcat, cur, origAmt, tags, ledger, rb, rbAmt,
        refund, refundOf, fromSub, deletedAt, updatedAt, fieldTs, userId
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      for (const e of entries) {
        db.runSync(stmt, [
          e.id,
          e.ts,
          e.io,
          e.cat,
          e.amt,
          e.note ?? null,
          e.acct ?? null,
          e.acctTo ?? null,
          e.fee ?? null,
          e.discount ?? null,
          e.subcat ?? null,
          e.cur ?? null,
          e.origAmt ?? null,
          e.tags ? JSON.stringify(e.tags) : null,
          e.ledger ?? null,
          e.rb ?? null,
          e.rbAmt ?? null,
          e.refund ?? null,
          e.refundOf ?? null,
          e.fromSub ? 1 : 0,
          e.deletedAt ?? null,
          e.updatedAt ?? null,
          e.fieldTs ? JSON.stringify(e.fieldTs) : null,
          (e as unknown as Record<string, unknown>).userId as string ?? null,
        ]);
      }
    }

    // --- accounts ---
    const accounts = config.accounts as Account[] | undefined;
    if (accounts?.length) {
      const acctStmt =
        'INSERT OR REPLACE INTO accounts (id, name, nameEn, balance, kind) VALUES (?,?,?,?,?)';
      for (const a of accounts) {
        db.runSync(acctStmt, [a.id, a.name, a.nameEn ?? null, a.balance, a.kind ?? 'cash']);
      }
    }

    // --- settings (key-value pairs) ---
    const settings = config.settings as Record<string, unknown> | undefined;
    if (settings) {
      const settingStmt = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)';
      for (const [k, v] of Object.entries(settings)) {
        db.runSync(settingStmt, [k, JSON.stringify(v)]);
      }
    }

    // mark migration complete
    db.runSync(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [MIGRATION_FLAG, '1'],
    );

    db.execSync('COMMIT');
  } catch (err) {
    db.execSync('ROLLBACK');
    throw err;
  }
}
