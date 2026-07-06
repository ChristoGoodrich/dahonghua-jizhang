import {
  loadOfflineQueue,
  getQueueSize,
  enqueueChange,
  dequeueChanges,
  type QueueChange,
} from '../offlineQueue';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dhh_offline_queue';

const makeChange = (overrides?: Partial<QueueChange>): QueueChange => ({
  type: 'upsert',
  entryId: 'entry-1',
  data: { amount: 100 },
  timestamp: 1000,
  ...overrides,
});

describe('offlineQueue', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('starts with empty queue', async () => {
    await loadOfflineQueue();
    expect(getQueueSize()).toBe(0);
    expect(await dequeueChanges()).toEqual([]);
  });

  it('enqueues changes with type, entryId, data', async () => {
    await loadOfflineQueue();
    await enqueueChange(makeChange({ type: 'upsert', entryId: 'e1', data: { amount: 50 }, timestamp: 1000 }));

    expect(getQueueSize()).toBe(1);
  });

  it('dequeues changes in FIFO order', async () => {
    await loadOfflineQueue();
    await enqueueChange(makeChange({ entryId: 'first', timestamp: 1000 }));
    await enqueueChange(makeChange({ entryId: 'second', timestamp: 2000 }));
    await enqueueChange(makeChange({ entryId: 'third', timestamp: 3000 }));

    const changes = await dequeueChanges();
    expect(changes).toHaveLength(3);
    expect(changes[0].entryId).toBe('first');
    expect(changes[1].entryId).toBe('second');
    expect(changes[2].entryId).toBe('third');
  });

  it('clears queue after dequeue', async () => {
    await loadOfflineQueue();
    await enqueueChange(makeChange({ entryId: 'e1' }));
    await enqueueChange(makeChange({ entryId: 'e2' }));

    const changes = await dequeueChanges();
    expect(changes).toHaveLength(2);
    expect(getQueueSize()).toBe(0);

    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    expect(stored).toBeNull();
  });

  it('persists to AsyncStorage and reloads', async () => {
    await loadOfflineQueue();
    await enqueueChange(makeChange({ entryId: 'persisted', timestamp: 9999 }));

    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed[0].entryId).toBe('persisted');
  });

  it('loads existing entries from AsyncStorage', async () => {
    const existing = [makeChange({ entryId: 'old', timestamp: 100 })];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    await loadOfflineQueue();
    expect(getQueueSize()).toBe(1);
  });

  it('handles delete type changes', async () => {
    await loadOfflineQueue();
    await enqueueChange(makeChange({ type: 'delete', entryId: 'e1', data: undefined, timestamp: 5000 }));

    const changes = await dequeueChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('delete');
    expect(changes[0].data).toBeUndefined();
  });
});
