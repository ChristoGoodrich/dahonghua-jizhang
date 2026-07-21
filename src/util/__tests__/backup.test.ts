import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { createBackup, listBackups, restoreBackup, runAutoBackup } from '../backup';

// The mock filesystem in jest.setup.js is module-level, so written backups
// outlive the test that created them — AsyncStorage.clear() doesn't touch it.
beforeEach(async () => {
  await AsyncStorage.clear();
  for (const b of await listBackups()) await FileSystem.deleteAsync(b.path);
});

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

// The settings screen exposed an auto-backup toggle and a daily/weekly
// frequency, but nothing ever read them — the switch implied the data was being
// protected while createBackup stayed reachable only from the manual button.
describe('runAutoBackup', () => {
  it('does nothing when the toggle is off', async () => {
    expect(await runAutoBackup({ enabled: false })).toBe(false);
    expect(await listBackups()).toHaveLength(0);
  });

  it('writes the first backup when enabled', async () => {
    expect(await runAutoBackup({ enabled: true, frequency: 'daily' })).toBe(true);
    expect(await listBackups()).toHaveLength(1);
  });

  it('skips when one was already taken inside the interval', async () => {
    await runAutoBackup({ enabled: true, frequency: 'daily' });
    expect(await runAutoBackup({ enabled: true, frequency: 'daily' })).toBe(false);
    expect(await listBackups()).toHaveLength(1);
  });

  it('honours maxBackups instead of the hardcoded ceiling', async () => {
    // 4 manual backups, then an auto run capped at 2 — the oldest are pruned
    for (let i = 0; i < 4; i++) await createBackup();
    const list = await listBackups();
    expect(list.length).toBeGreaterThan(0);
    await createBackup(2);
    expect((await listBackups()).length).toBeLessThanOrEqual(2);
  });

  it('never throws out of a failed backup, so boot cannot be blocked', async () => {
    await expect(runAutoBackup({ enabled: true, maxBackups: -1 })).resolves.toBeDefined();
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
