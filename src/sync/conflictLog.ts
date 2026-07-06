import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dhh_conflict_log';
const MAX_ENTRIES = 100;

export interface ConflictEntry {
  entryId: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  resolution: 'local' | 'remote' | 'merged';
  timestamp: number;
}

let cachedLog: ConflictEntry[] = [];

export async function loadConflictLog(): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  cachedLog = raw ? JSON.parse(raw) : [];
}

export function getConflictLog(): ConflictEntry[] {
  return cachedLog;
}

export async function logConflict(entry: ConflictEntry): Promise<void> {
  cachedLog.unshift(entry);
  if (cachedLog.length > MAX_ENTRIES) {
    cachedLog = cachedLog.slice(0, MAX_ENTRIES);
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedLog));
}

export async function clearConflictLog(): Promise<void> {
  cachedLog = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
}
