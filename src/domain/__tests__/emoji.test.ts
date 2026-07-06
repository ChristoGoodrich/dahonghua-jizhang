import { EMOJI_GROUPS, ALL_EMOJI } from '../emoji';

describe('emoji dataset', () => {
  it('has multiple non-empty groups with unique keys', () => {
    expect(EMOJI_GROUPS.length).toBeGreaterThanOrEqual(8);
    for (const g of EMOJI_GROUPS) {
      expect(g.emojis.length).toBeGreaterThan(0);
      expect(g.zh).toBeTruthy();
      expect(g.en).toBeTruthy();
    }
    const keys = EMOJI_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('offers a substantial set, far beyond the legacy 16', () => {
    expect(ALL_EMOJI.length).toBeGreaterThan(200);
  });

  it('contains no empty or placeholder tokens', () => {
    for (const e of ALL_EMOJI) {
      expect(e.trim()).toBe(e);
      expect(e.length).toBeGreaterThan(0);
      expect(/[a-z]/.test(e)).toBe(false); // catches stray ascii like a bad paste
    }
  });

  it('ALL_EMOJI is the flattened groups', () => {
    expect(ALL_EMOJI.length).toBe(EMOJI_GROUPS.reduce((s, g) => s + g.emojis.length, 0));
  });
});
