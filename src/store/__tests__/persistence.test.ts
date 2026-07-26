import AsyncStorage from '@react-native-async-storage/async-storage';
import { store$, loadPersisted, loadPersistedCurrentMonth, loadPersistedFull } from '../ledger';

beforeEach(async () => {
  await AsyncStorage.clear();
  store$.lang.set('zh');
  store$.curAccount.set('default');
  store$.data.set([]);
});

describe('split persistence', () => {
  it('loads entries and config from their separate keys', async () => {
    await AsyncStorage.setItem('dhh_config_v1', JSON.stringify({ lang: 'en', curAccount: 'x' }));
    await AsyncStorage.setItem('dhh_entries_v1', JSON.stringify([{ id: 'a', ts: 1, io: 'exp', cat: 'food', amt: 5 }]));

    await loadPersisted();

    expect(store$.lang.peek()).toBe('en');
    expect(store$.curAccount.peek()).toBe('x');
    expect(store$.data.peek()).toHaveLength(1);
    expect(store$.data.peek()[0].amt).toBe(5);
  });

  it('migrates the legacy single-blob key into the split keys and removes it', async () => {
    await AsyncStorage.setItem(
      'dhh_state_v1',
      JSON.stringify({ lang: 'en', curAccount: 'y', data: [{ id: 'a', ts: 1, io: 'exp', cat: 'food', amt: 9 }] }),
    );

    await loadPersisted();

    // state applied
    expect(store$.curAccount.peek()).toBe('y');
    expect(store$.data.peek()[0].amt).toBe(9);

    // legacy dropped, split keys written
    expect(await AsyncStorage.getItem('dhh_state_v1')).toBeNull();
    const cfg = JSON.parse((await AsyncStorage.getItem('dhh_config_v1'))!);
    const ent = JSON.parse((await AsyncStorage.getItem('dhh_entries_v1'))!);
    expect(cfg.data).toBeUndefined(); // entries are NOT in the config blob
    expect(cfg.curAccount).toBe('y');
    expect(ent[0].amt).toBe(9);
  });

  it('is a no-op with empty storage (keeps defaults)', async () => {
    await loadPersisted();
    expect(store$.data.peek()).toHaveLength(0);
    expect(store$.lang.peek()).toBe('zh');
  });
});

describe('lazy hydration', () => {
  it('loadPersistedCurrentMonth only loads entries from the current month', async () => {
    const now = new Date();
    const currentTs = new Date(now.getFullYear(), now.getMonth(), 15).getTime();
    const oldTs = new Date(now.getFullYear(), now.getMonth() - 2, 15).getTime();

    await AsyncStorage.setItem('dhh_config_v1', JSON.stringify({ lang: 'en', curAccount: 'x' }));
    await AsyncStorage.setItem(
      'dhh_entries_v1',
      JSON.stringify([
        { id: 'cur', ts: currentTs, io: 'exp', cat: 'food', amt: 10 },
        { id: 'old', ts: oldTs, io: 'exp', cat: 'food', amt: 20 },
      ]),
    );

    await loadPersistedCurrentMonth();

    expect(store$.lang.peek()).toBe('en');
    const data = store$.data.peek();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('cur');
  });

  it('loadPersistedFull replaces the month-only subset with all entries', async () => {
    const now = new Date();
    const currentTs = new Date(now.getFullYear(), now.getMonth(), 15).getTime();
    const oldTs = new Date(now.getFullYear(), now.getMonth() - 2, 15).getTime();

    await AsyncStorage.setItem(
      'dhh_entries_v1',
      JSON.stringify([
        { id: 'cur', ts: currentTs, io: 'exp', cat: 'food', amt: 10 },
        { id: 'old', ts: oldTs, io: 'exp', cat: 'food', amt: 20 },
      ]),
    );

    await loadPersistedCurrentMonth();
    expect(store$.data.peek()).toHaveLength(1);

    await loadPersistedFull();
    expect(store$.data.peek()).toHaveLength(2);
  });

  it('loadPersistedFull is a no-op when storage is empty', async () => {
    await loadPersistedFull();
    expect(store$.data.peek()).toHaveLength(0);
  });
});
