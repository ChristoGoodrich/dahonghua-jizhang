import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBackup, listBackups, restoreBackup } from '../backup';

beforeEach(() => AsyncStorage.clear());

describe('createBackup', () => {
  it('returns a path containing "backup_"', async () => {
    const path = await createBackup();
    expect(path).toContain('backup_');
  });
});

describe('listBackups', () => {
  it('returns at least one backup after creation', async () => {
    await createBackup();
    const list = await listBackups();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});

describe('restoreBackup', () => {
  it('returns valid data with entries', async () => {
    await AsyncStorage.setItem('dhh_entries_v1', JSON.stringify([{ id: '1', ts: 0, io: 'exp', cat: 'food', amt: 10 }]));
    await AsyncStorage.setItem('dhh_config_v1', JSON.stringify({ theme: 'default' }));
    const path = await createBackup();
    const data = await restoreBackup(path);
    expect(data.entries).toEqual([{ id: '1', ts: 0, io: 'exp', cat: 'food', amt: 10 }]);
    expect(data.config).toEqual({ theme: 'default' });
    expect(data.version).toBe(1);
    expect(data.timestamp).toBeGreaterThan(0);
  });
});
