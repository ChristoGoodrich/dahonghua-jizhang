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

/** Newest first, bounded. The cap is applied AFTER the insert, so a full log
 *  still accepts a new entry and drops its oldest rather than refusing it.
 *
 *  Exported so the rule has one definition: `logConflict` awaits AsyncStorage,
 *  so nothing that wants to check the rule can call it, and a second copy of
 *  three lines is how two spellings of one rule start. */
export function capLog(log: ConflictEntry[], entry: ConflictEntry): ConflictEntry[] {
  const next = [entry, ...log];
  return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
}

export async function logConflict(entry: ConflictEntry): Promise<void> {
  cachedLog = capLog(cachedLog, entry);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedLog));
}

export async function clearConflictLog(): Promise<void> {
  cachedLog = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
}
