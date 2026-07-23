// Regression coverage for the import path. Each case here is a bug that shipped:
// a malformed file could wipe the ledger, restored entries never reached the
// cloud, and most of the user's settings were silently dropped on restore.
import { importV7, migrateBackup } from '../importV7';
import { store$ } from '@/store/ledger';
import type { Entry } from '@/domain/types';

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1', ts: 1000, io: 'exp', cat: 'food', amt: 10, ...over,
});

beforeEach(() => {
  store$.data.set([]);
  store$.settings.set({ budget: 0, cycleStart: 1, theme: 'default', dark: false });
  store$.lang.set('zh');
  store$.curLedger.set('');
});

describe('migrateBackup', () => {
  it('rejects anything without a data array', () => {
    expect(() => migrateBackup(null)).toThrow();
    expect(() => migrateBackup({})).toThrow();
    expect(() => migrateBackup({ data: 'nope' })).toThrow();
  });

  it('treats a version-less v7 web export as v7 and walks it forward', () => {
    expect(migrateBackup({ data: [] }).version).toBe(8);
  });
});

describe('importV7 validation', () => {
  it('refuses a file whose rows are all malformed instead of wiping the ledger', () => {
    const existing = [entry({ id: 'keep' })];
    store$.data.set(existing);
    expect(() => importV7({ version: 8, data: [1, 2, 3] })).toThrow();
    expect(store$.data.peek()).toEqual(existing);
  });

  it('drops individual malformed rows and reports the count', () => {
    const res = importV7({
      version: 8,
      data: [entry({ id: 'ok' }), { id: 'no-ts', io: 'exp', cat: 'food', amt: 5 }, { nonsense: true }],
    });
    expect(res.entries).toBe(1);
    expect(res.skipped).toBe(2);
    expect(store$.data.peek().map((e) => e.id)).toEqual(['ok']);
  });

  it('accepts a genuinely empty backup', () => {
    expect(importV7({ version: 8, data: [] })).toEqual({ entries: 0, net: 0, skipped: 0 });
  });
});

describe('importV7 sync stamping', () => {
  it('restamps updatedAt so restored entries clear the push watermark', () => {
    const before = Date.now();
    // a v7 web export carries no updatedAt at all
    importV7({ version: 8, data: [entry({ id: 'a' }), entry({ id: 'b' })] });
    for (const e of store$.data.peek()) {
      expect(e.updatedAt).toBeGreaterThanOrEqual(before);
    }
  });

  it('drops stale fieldTs so the restore wins whole-row LWW', () => {
    importV7({ version: 8, data: [entry({ id: 'a', fieldTs: { amt: 1 } })] });
    expect(store$.data.peek()[0].fieldTs).toBeUndefined();
  });

  it('keeps updatedAt distinct so ordering is stable', () => {
    importV7({ version: 8, data: [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })] });
    const stamps = store$.data.peek().map((e) => e.updatedAt);
    expect(new Set(stamps).size).toBe(3);
  });
});

describe('importV7 settings restore', () => {
  it('carries every persisted setting, not just the handful that used to survive', () => {
    importV7({
      version: 8,
      data: [],
      settings: {
        budget: 3000, cycleStart: 5, theme: 'ocean', dark: true,
        dailyBudget: 100, weeklyBudget: 700, budgetMode: 'weekly',
        hideAmounts: true, archivedLedgers: ['old'],
        aiShareCategories: false, autoBackup: true, backupFrequency: 'weekly',
      },
    });
    const st = store$.settings.peek();
    expect(st.dailyBudget).toBe(100);
    expect(st.weeklyBudget).toBe(700);
    expect(st.budgetMode).toBe('weekly');
    expect(st.hideAmounts).toBe(true);
    expect(st.archivedLedgers).toEqual(['old']);
    expect(st.aiShareCategories).toBe(false);
    expect(st.autoBackup).toBe(true);
    expect(st.backupFrequency).toBe('weekly');
  });

  it('never restores the device lock or a legacy passcode', () => {
    store$.settings.assign({ lock: true });
    importV7({
      version: 8,
      data: [],
      settings: { budget: 1, lock: false, passcode: '1234', passHash: 'x', passSalt: 'y' },
    });
    const st = store$.settings.peek() as Record<string, unknown>;
    expect(st.lock).toBe(true); // device-local, untouched by the restore
    expect(st.passcode).toBeUndefined();
    expect(st.passHash).toBeUndefined();
    expect(st.passSalt).toBeUndefined();
  });

  it('restores lang and curLedger', () => {
    importV7({ version: 8, data: [], lang: 'en', curLedger: '旅行' });
    expect(store$.lang.peek()).toBe('en');
    expect(store$.curLedger.peek()).toBe('旅行');
  });

  it('reports the net of the imported entries', () => {
    const res = importV7({
      version: 8,
      data: [entry({ id: 'a', io: 'inc', amt: 100 }), entry({ id: 'b', io: 'exp', amt: 30 })],
    });
    expect(res.net).toBe(70);
  });
});
