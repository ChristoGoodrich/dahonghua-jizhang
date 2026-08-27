import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptBackup, decryptBackup } from './crypto';
import { backupName, listBackupNames, pruneBackups, type BackupInfo } from './backupNames';

// Re-exported so callers keep one import for "a backup"; the shape itself now
// lives with the naming rules it comes from.
export type { BackupInfo };

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

export async function createBackup(keep = MAX_BACKUPS, password?: string): Promise<string> {
  await ensureBackupDir();
  const entries = JSON.parse((await AsyncStorage.getItem('dhh_entries_v1')) ?? '[]');
  const config = JSON.parse((await AsyncStorage.getItem('dhh_config_v1')) ?? '{}');
  const data: BackupData = { version: 1, timestamp: Date.now(), entries, config };
  const path = BACKUP_DIR + backupName(data.timestamp, !!password);
  const payload = password
    ? await encryptBackup(JSON.stringify(data), password)
    : JSON.stringify(data);
  await FileSystem.writeAsStringAsync(path, payload);
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

/** A backup on disk. `path` is this module's; the rest is backupNames'. */
export type BackupOnDisk = BackupInfo & { path: string };

export async function listBackups(): Promise<BackupOnDisk[]> {
  await ensureBackupDir();
  const names = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  return listBackupNames(names).map((b) => ({ ...b, path: BACKUP_DIR + b.name }));
}

export async function restoreBackup(path: string, password?: string): Promise<BackupData> {
  const raw = await FileSystem.readAsStringAsync(path);
  const encrypted = path.endsWith('.enc.json');
  const json = encrypted ? await decryptBackup(raw, password!) : raw;
  return JSON.parse(json) as BackupData;
}

async function cleanOldBackups(keep = MAX_BACKUPS): Promise<void> {
  for (const b of pruneBackups(await listBackups(), keep)) {
    await FileSystem.deleteAsync((b as BackupOnDisk).path);
  }
}
