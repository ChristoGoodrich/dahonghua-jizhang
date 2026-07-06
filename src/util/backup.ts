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

export async function createBackup(): Promise<string> {
  await ensureBackupDir();
  const entries = JSON.parse((await AsyncStorage.getItem('dhh_entries_v1')) ?? '[]');
  const config = JSON.parse((await AsyncStorage.getItem('dhh_config_v1')) ?? '{}');
  const data: BackupData = { version: 1, timestamp: Date.now(), entries, config };
  const name = `backup_${data.timestamp}.json`;
  const path = BACKUP_DIR + name;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(data));
  await cleanOldBackups();
  return path;
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

async function cleanOldBackups(): Promise<void> {
  const list = await listBackups();
  if (list.length > MAX_BACKUPS) {
    const excess = list.slice(MAX_BACKUPS);
    for (const b of excess) {
      await FileSystem.deleteAsync(b.path);
    }
  }
}
