import {
  store$, addTemplate, removeTemplate, logTemplate,
  addTag, removeTag, setCurLedger,
} from '../ledger';

beforeEach(() => {
  store$.data.set([]);
  store$.templates.set([]);
  store$.tags.set({ normal: [], ledger: [] });
  store$.curLedger.set('');
  store$.curAccount.set('default');
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
});
