// The boot gate between the fast (current-month) hydration pass and the full
// load. Regression coverage for a family of data-loss races: autosave
// persisting the month-only subset over the full history, the full load
// replacing entries written during the window, and subscription catch-up firing
// against the incomplete ledger (whose advanced cursor made the lost charge
// unrecoverable). Modules are re-required per test so the module-level gate
// starts closed each time.
import type { Entry } from '@/domain/types';

const now = new Date();
const curTs = new Date(now.getFullYear(), now.getMonth(), 15).getTime();
const oldTs = new Date(now.getFullYear(), now.getMonth() - 2, 15).getTime();

const E = (over: Partial<Entry> & { id: string }): Entry => ({
  ts: curTs,
  io: 'exp',
  cat: 'food',
  amt: 10,
  ...over,
});

function fresh() {
  jest.resetModules();
  const mod = require('@react-native-async-storage/async-storage');
  const AsyncStorage = mod.default ?? mod;
  const ledger = require('@/store/ledger');
  return { AsyncStorage, ledger };
}

async function seedDisk(AsyncStorage: any, entries: Entry[], config: Record<string, unknown> = {}) {
  await AsyncStorage.setItem('dhh_entries_v1', JSON.stringify(entries));
  await AsyncStorage.setItem('dhh_config_v1', JSON.stringify(config));
}

const diskIds = async (AsyncStorage: any): Promise<string[]> =>
  (JSON.parse((await AsyncStorage.getItem('dhh_entries_v1')) ?? '[]') as Entry[]).map((e) => e.id);

afterEach(() => {
  jest.useRealTimers();
});

describe('autosave gating', () => {
  it('never persists the month-only subset over the full history', async () => {
    jest.useFakeTimers();
    const { AsyncStorage, ledger } = fresh();
    await seedDisk(AsyncStorage, [E({ id: 'cur' }), E({ id: 'old', ts: oldTs })]);

    await ledger.loadPersistedCurrentMonth();
    ledger.startAutosave();
    ledger.addEntry({ io: 'exp', cat: 'food', amt: 1 });
    await jest.advanceTimersByTimeAsync(600); // past the 400ms debounce

    // the deferred write must NOT have truncated history on disk
    expect(await diskIds(AsyncStorage)).toEqual(expect.arrayContaining(['cur', 'old']));
  });

  it('flushes writes made during the window once the full load opens the gate', async () => {
    jest.useFakeTimers();
    const { AsyncStorage, ledger } = fresh();
    await seedDisk(AsyncStorage, [E({ id: 'cur' }), E({ id: 'old', ts: oldTs })]);

    await ledger.loadPersistedCurrentMonth();
    ledger.startAutosave();
    const added = ledger.addEntry({ io: 'exp', cat: 'food', amt: 1 });

    await ledger.hydrateFull();
    await jest.advanceTimersByTimeAsync(600);

    const ids = await diskIds(AsyncStorage);
    expect(ids).toEqual(expect.arrayContaining(['cur', 'old', added.id]));
    expect(ledger.store$.data.peek()).toHaveLength(3);
  });
});

describe('loadPersistedFull merge', () => {
  it('keeps an entry added after the fast pass', async () => {
    const { AsyncStorage, ledger } = fresh();
    await seedDisk(AsyncStorage, [E({ id: 'cur' }), E({ id: 'old', ts: oldTs })]);

    await ledger.loadPersistedCurrentMonth();
    const added = ledger.addEntry({ io: 'exp', cat: 'food', amt: 1 });
    await ledger.loadPersistedFull();

    const ids = ledger.store$.data.peek().map((e: Entry) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['cur', 'old', added.id]));
  });

  it('keeps an edit made during the window over the stale disk copy', async () => {
    const { AsyncStorage, ledger } = fresh();
    await seedDisk(AsyncStorage, [E({ id: 'cur', updatedAt: 100 }), E({ id: 'old', ts: oldTs })]);

    await ledger.loadPersistedCurrentMonth();
    ledger.updateEntry('cur', { amt: 99 });
    await ledger.loadPersistedFull();

    const data = ledger.store$.data.peek() as Entry[];
    expect(data.find((e) => e.id === 'cur')!.amt).toBe(99);
    expect(data.find((e) => e.id === 'old')).toBeTruthy();
  });

  it('keeps a delete (tombstone) made during the window', async () => {
    const { AsyncStorage, ledger } = fresh();
    await seedDisk(AsyncStorage, [E({ id: 'cur', updatedAt: 100 }), E({ id: 'old', ts: oldTs })]);

    await ledger.loadPersistedCurrentMonth();
    ledger.removeEntry('cur');
    await ledger.loadPersistedFull();

    const data = ledger.store$.data.peek() as Entry[];
    expect(data.find((e) => e.id === 'cur')!.deletedAt).toBeTruthy();
  });
});

describe('subscription catch-up gating', () => {
  it('hydrateCurrentMonth defers charges until the full ledger is loaded', async () => {
    const { AsyncStorage, ledger } = fresh();
    const created = Date.now() - 70 * 864e5;
    await seedDisk(
      AsyncStorage,
      [E({ id: 'old', ts: oldTs })],
      { subs: [{ id: 's1', name: 'Netflix', amt: 30, freq: 'monthly', day: 1, cat: 'fun', created, lastCharged: '' }] },
    );

    await ledger.hydrateCurrentMonth();
    // gate still closed — no charge may fire against the month-only subset
    expect((ledger.store$.data.peek() as Entry[]).some((e) => e.fromSub)).toBe(false);

    await ledger.hydrateFull();
    await ledger.whenDataReady();
    await Promise.resolve(); // let the deferred runSubscriptions callback run

    const data = ledger.store$.data.peek() as Entry[];
    expect(data.some((e) => e.fromSub)).toBe(true); // charged
    expect(data.some((e) => e.id === 'old')).toBe(true); // history intact
  });
});
