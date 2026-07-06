import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dhh_offline_queue';

export interface QueueChange {
  type: 'upsert' | 'delete';
  entryId: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

let queue: QueueChange[] = [];

export async function loadOfflineQueue(): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  queue = raw ? JSON.parse(raw) : [];
}

export function getQueueSize(): number {
  return queue.length;
}

export async function enqueueChange(change: QueueChange): Promise<void> {
  queue.push(change);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export async function dequeueChanges(): Promise<QueueChange[]> {
  const changes = [...queue];
  queue = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
  return changes;
}
