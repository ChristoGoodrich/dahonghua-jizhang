import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKUP_DIR = FileSystem.documentDirectory + 'backups/';
const MAX_BACKUPS = 10;

export interface BackupData {
  version: number;
  timestamp: number;
  entries: unknown[];
  config: unknown;
}

async function ensureBackupDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
  }
}

export async function createBackup(keep = MAX_BACKUPS): Promise<string> {
  await ensureBackupDir();
  const entries = JSON.parse((await AsyncStorage.getItem('dhh_entries_v1')) ?? '[]');
  const config = JSON.parse((await AsyncStorage.getItem('dhh_config_v1')) ?? '{}');
  const data: BackupData = { version: 1, timestamp: Date.now(), entries, config };
  const name = `backup_${data.timestamp}.json`;
  const path = BACKUP_DIR + name;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(data));
  await cleanOldBackups(keep);
  return path;
}

const DAY_MS = 864e5;

export interface AutoBackupOpts {
  enabled?: boolean;
  frequency?: 'daily' | 'weekly';
  maxBackups?: number;
}

/**
 * Create a backup if auto-backup is on and one is due. Call at boot.
 *
 * The settings screen has offered an auto-backup toggle and a daily/weekly
 * frequency since the feature shipped, but nothing ever read either value —
 * `createBackup` was only reachable from the manual button, so the toggle sat
 * there implying the data was being protected when it wasn't.
 *
 * Returns true when a backup was actually written.
 */
export async function runAutoBackup(opts: AutoBackupOpts): Promise<boolean> {
  if (!opts.enabled) return false;
  const keep = opts.maxBackups && opts.maxBackups > 0 ? opts.maxBackups : MAX_BACKUPS;
  const interval = opts.frequency === 'weekly' ? 7 * DAY_MS : DAY_MS;
  try {
    const list = await listBackups();
    const newest = list[0]; // listBackups sorts newest-first
    if (newest && Date.now() - newest.time < interval) return false;
    await createBackup(keep);
    return true;
  } catch {
    return false; // a failed backup must never block boot
  }
}

export async function listBackups(): Promise<{ name: string; path: string; time: number }[]> {
  await ensureBackupDir();
  const names = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  const backups = names
    .filter((n) => n.startsWith('backup_') && n.endsWith('.json'))
    .map((name) => {
      const ts = Number(name.replace('backup_', '').replace('.json', ''));
      return { name, path: BACKUP_DIR + name, time: ts };
    });
  backups.sort((a, b) => b.time - a.time);
  return backups;
}

export async function restoreBackup(path: string): Promise<BackupData> {
  const raw = await FileSystem.readAsStringAsync(path);
  return JSON.parse(raw) as BackupData;
}

async function cleanOldBackups(keep = MAX_BACKUPS): Promise<void> {
  const list = await listBackups();
  if (list.length > keep) {
    const excess = list.slice(keep);
    for (const b of excess) {
      await FileSystem.deleteAsync(b.path);
    }
  }
}
