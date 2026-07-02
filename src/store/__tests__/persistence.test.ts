import AsyncStorage from '@react-native-async-storage/async-storage';
import { store$, loadPersisted } from '../ledger';

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
