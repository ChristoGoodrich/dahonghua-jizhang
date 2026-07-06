import AsyncStorage from '@react-native-async-storage/async-storage';
import { initDatabase, getDatabase } from '../db';
import { needsMigration, migrateToSQLite } from '../migration';

beforeEach(() => {
  // reset AsyncStorage
  AsyncStorage.clear();
  // reset the in-memory database by re-creating tables
  initDatabase();
});

describe('AsyncStorage → SQLite migration', () => {
  it('needsMigration returns true before migration', () => {
    expect(needsMigration()).toBe(true);
  });

  it('migrateToSQLite completes without errors', async () => {
    // seed some AsyncStorage data
    await AsyncStorage.setItem(
      'dhh_entries_v1',
      JSON.stringify([
        { id: 'e1', ts: 1000, io: 'exp', cat: 'food', amt: 25, note: 'lunch' },
        { id: 'e2', ts: 2000, io: 'inc', cat: 'salary', amt: 5000 },
      ]),
    );
    await AsyncStorage.setItem(
      'dhh_config_v1',
      JSON.stringify({
        accounts: [{ id: 'a1', name: '现金', balance: 100, kind: 'cash' }],
        settings: { budget: 3000, cycleStart: 1 },
      }),
    );

    await expect(migrateToSQLite()).resolves.toBeUndefined();

    // verify entries landed
    const db = getDatabase();
    const count = db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM entries');
    expect(count?.cnt).toBe(2);

    // verify account landed
    const acct = db.getFirstSync<{ name: string }>(
      'SELECT name FROM accounts WHERE id = ?',
      ['a1'],
    );
    expect(acct?.name).toBe('现金');

    // verify settings landed
    const budget = db.getFirstSync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      ['budget'],
    );
    expect(JSON.parse(budget!.value)).toBe(3000);
  });

  it('needsMigration returns false after migration', async () => {
    await migrateToSQLite();
    expect(needsMigration()).toBe(false);
  });
});
