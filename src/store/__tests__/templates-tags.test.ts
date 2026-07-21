import {
  store$, addTemplate, removeTemplate, logTemplate,
  addTag, removeTag, setCurLedger, archiveLedger,
  addAccount, archiveAccount,
} from '../ledger';

beforeEach(() => {
  store$.data.set([]);
  store$.templates.set([]);
  store$.tags.set({ normal: [], ledger: [] });
  store$.curLedger.set('');
  store$.curAccount.set('default');
  store$.accounts.set([{ id: 'default', name: '默认', nameEn: 'Default', balance: 0 }]);
  store$.settings.set({ budget: 0, cycleStart: 1, theme: 'default', dark: false });
});

describe('templates', () => {
  it('adds and logs a template as a new entry', () => {
    const tpl = addTemplate({ io: 'exp', cat: 'food', amt: 18, note: '奶茶', name: '奶茶' });
    expect(store$.templates.peek()).toHaveLength(1);
    const e = logTemplate(tpl.id)!;
    expect(e.io).toBe('exp');
    expect(e.amt).toBe(18);
    expect(e.note).toBe('奶茶');
    expect(store$.data.peek()).toHaveLength(1);
  });

  it('stamps the active ledger onto a logged template entry', () => {
    setCurLedger('Travel');
    const tpl = addTemplate({ io: 'exp', cat: 'trans', amt: 30, name: 'Taxi' });
    const e = logTemplate(tpl.id)!;
    expect(e.ledger).toBe('Travel');
  });

  it('removes a template', () => {
    const tpl = addTemplate({ io: 'exp', cat: 'food', amt: 10, name: 'x' });
    removeTemplate(tpl.id);
    expect(store$.templates.peek()).toHaveLength(0);
  });
});

describe('tags', () => {
  it('adds without duplicates and removes', () => {
    addTag('normal', '旅行');
    addTag('normal', '旅行'); // dup ignored
    addTag('ledger', '家庭');
    expect(store$.tags.peek().normal).toEqual(['旅行']);
    expect(store$.tags.peek().ledger).toEqual(['家庭']);
    removeTag('normal', '旅行');
    expect(store$.tags.peek().normal).toEqual([]);
  });

  it('clears curLedger when its ledger tag is deleted', () => {
    addTag('ledger', '家庭');
    setCurLedger('家庭');
    removeTag('ledger', '家庭');
    expect(store$.curLedger.peek()).toBe('');
  });

  it('archives/unarchives a ledger and resets the active filter on archive', () => {
    addTag('ledger', '日本行');
    setCurLedger('日本行');
    archiveLedger('日本行', true);
    expect(store$.settings.archivedLedgers.peek()).toEqual(['日本行']);
    expect(store$.curLedger.peek()).toBe(''); // active filter reset
    // tag still exists (history preserved), just archived
    expect(store$.tags.peek().ledger).toEqual(['日本行']);
    archiveLedger('日本行', false);
    expect(store$.settings.archivedLedgers.peek()).toBeUndefined();
  });
});

describe('account archiving', () => {
  it('archives a non-default account and clears it as current', () => {
    const a = addAccount('旧卡', 0, 'credit');
    store$.curAccount.set(a.id);
    archiveAccount(a.id, true);
    expect(store$.accounts.peek().find((x) => x.id === a.id)?.archived).toBe(true);
    expect(store$.curAccount.peek()).toBe('default'); // no longer the default target
    archiveAccount(a.id, false);
    expect(store$.accounts.peek().find((x) => x.id === a.id)?.archived).toBeUndefined();
  });

  it('never archives the default account', () => {
    archiveAccount('default', true);
    expect(store$.accounts.peek().find((x) => x.id === 'default')?.archived).toBeUndefined();
  });
});
