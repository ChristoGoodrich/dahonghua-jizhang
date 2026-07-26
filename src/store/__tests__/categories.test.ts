import { store$, addCustomCat, addSubcat, removeSubcat } from '../ledger';

beforeEach(() => {
  store$.customCats.set({ exp: [], inc: [], xfer: [] });
  store$.subcats.set({});
});

describe('addCustomCat', () => {
  it('adds a custom expense category', () => {
    const c = addCustomCat('exp', '奶茶', '🧋');
    expect(c.zh).toBe('奶茶');
    expect(c.en).toBe('奶茶');
    expect(c.e).toBe('🧋');
    expect(c.custom).toBe(true);
    expect(store$.customCats.exp.peek()).toHaveLength(1);
  });

  it('adds a custom income category', () => {
    const c = addCustomCat('inc', '奖金', '🎁');
    expect(store$.customCats.inc.peek()).toHaveLength(1);
    expect(c.k).toBeTruthy();
  });

  it('cycles through the palette colors', () => {
    const c1 = addCustomCat('exp', 'A', '🍎');
    const c2 = addCustomCat('exp', 'B', '🍌');
    expect(c1.c).not.toBe(c2.c);
  });

  it('wraps palette index when exceeding palette length', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 30; i++) {
      colors.add(addCustomCat('exp', 'cat' + i, '⭐').c);
    }
    // should have wrapped around at least once
    expect(colors.size).toBeLessThan(30);
  });
});

describe('addSubcat', () => {
  it('adds a subcategory to an existing category', () => {
    addSubcat('food', '奶茶');
    const map = store$.subcats.peek();
    expect(map.food).toHaveLength(1);
    expect(map.food[0].name).toBe('奶茶');
    expect(map.food[0].k).toBeTruthy();
  });

  it('appends to an existing subcategory list', () => {
    addSubcat('food', '奶茶');
    addSubcat('food', '火锅');
    expect(store$.subcats.peek().food).toHaveLength(2);
  });

  it('creates the list if the category has no subcats yet', () => {
    addSubcat('transport', '地铁');
    expect(store$.subcats.peek().transport).toHaveLength(1);
  });
});

describe('removeSubcat', () => {
  it('removes a specific subcategory', () => {
    addSubcat('food', '奶茶');
    addSubcat('food', '火锅');
    const toRemove = store$.subcats.peek().food[0];
    removeSubcat('food', toRemove.k);
    expect(store$.subcats.peek().food).toHaveLength(1);
    expect(store$.subcats.peek().food[0].name).toBe('火锅');
  });

  it('does nothing if the subcategory key does not exist', () => {
    addSubcat('food', '奶茶');
    removeSubcat('food', 'nonexistent');
    expect(store$.subcats.peek().food).toHaveLength(1);
  });

  it('creates an empty list when category had no subcats', () => {
    removeSubcat('unknown', 'x');
    expect(store$.subcats.peek().unknown).toEqual([]);
  });
});
