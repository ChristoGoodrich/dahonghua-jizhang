import {
  loadConflictLog,
  getConflictLog,
  logConflict,
  clearConflictLog,
  type ConflictEntry,
} from '../conflictLog';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dhh_conflict_log';

const makeEntry = (overrides?: Partial<ConflictEntry>): ConflictEntry => ({
  entryId: 'entry-1',
  localUpdatedAt: 1000,
  remoteUpdatedAt: 2000,
  resolution: 'remote',
  timestamp: Date.now(),
  ...overrides,
});

describe('conflictLog', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('starts with empty log', async () => {
    await loadConflictLog();
    expect(getConflictLog()).toEqual([]);
  });

  it('logs conflicts with entryId, timestamps, resolution', async () => {
    await loadConflictLog();
    const entry = makeEntry({ entryId: 'e1', resolution: 'local', timestamp: 5000 });
    await logConflict(entry);

    const log = getConflictLog();
    expect(log).toHaveLength(1);
    expect(log[0].entryId).toBe('e1');
    expect(log[0].resolution).toBe('local');
    expect(log[0].timestamp).toBe(5000);
  });

  it('prepends new entries (newest first)', async () => {
    await loadConflictLog();
    await logConflict(makeEntry({ entryId: 'first', timestamp: 1000 }));
    await logConflict(makeEntry({ entryId: 'second', timestamp: 2000 }));

    const log = getConflictLog();
    expect(log[0].entryId).toBe('second');
    expect(log[1].entryId).toBe('first');
  });

  it('limits log size to 100 entries', async () => {
    await loadConflictLog();
    for (let i = 0; i < 110; i++) {
      await logConflict(makeEntry({ entryId: `entry-${i}`, timestamp: i }));
    }

    const log = getConflictLog();
    expect(log).toHaveLength(100);
    expect(log[0].entryId).toBe('entry-109');
    expect(log[99].entryId).toBe('entry-10');
  });

  it('clears log completely', async () => {
    await loadConflictLog();
    await logConflict(makeEntry({ entryId: 'e1' }));
    await logConflict(makeEntry({ entryId: 'e2' }));
    expect(getConflictLog()).toHaveLength(2);

    await clearConflictLog();
    expect(getConflictLog()).toEqual([]);

    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    expect(stored).toBeNull();
  });

  it('persists to AsyncStorage and reloads', async () => {
    await loadConflictLog();
    await logConflict(makeEntry({ entryId: 'persisted', timestamp: 9999 }));

    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed[0].entryId).toBe('persisted');
  });

  it('loads existing entries from AsyncStorage', async () => {
    const existing = [makeEntry({ entryId: 'old', timestamp: 100 })];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    await loadConflictLog();
    expect(getConflictLog()).toHaveLength(1);
    expect(getConflictLog()[0].entryId).toBe('old');
  });
});
