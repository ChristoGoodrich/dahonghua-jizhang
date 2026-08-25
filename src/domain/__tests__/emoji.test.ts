import { EMOJI_GROUPS } from '../emoji';

const allEmoji = () => EMOJI_GROUPS.flatMap((g) => g.emojis);

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
    expect(allEmoji().length).toBeGreaterThan(200);
  });

  it('contains no empty or placeholder tokens', () => {
    for (const e of allEmoji()) {
      expect(e.trim()).toBe(e);
      expect(e.length).toBeGreaterThan(0);
      expect(/[a-z]/.test(e)).toBe(false); // catches stray ascii like a bad paste
    }
  });

  it('never repeats an emoji inside one group', () => {
    // the same emoji twice in one picker section is a real mistake
    for (const g of EMOJI_GROUPS) {
      expect(new Set(g.emojis).size).toBe(g.emojis.length);
    }
  });

  it('repeats across groups only where both groups mean it', () => {
    // 420 entries, 408 distinct. The overlap is deliberate: a birthday cake
    // belongs in both Food and Gifts, and someone browsing Health should see
    // the meditation figure that also sits under Sport. Pinned so a future
    // "deduplicate the table" refactor has to argue with a test rather than
    // quietly narrowing what each section offers.
    const seen = new Map<string, string[]>();
    for (const g of EMOJI_GROUPS) {
      for (const e of g.emojis) seen.set(e, [...(seen.get(e) ?? []), g.key]);
    }
    const shared = [...seen].filter(([, groups]) => groups.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    // every repeat spans exactly two sections, never three
    for (const [, groups] of shared) expect(groups.length).toBe(2);
    // and the two sections are always different
    for (const [, groups] of shared) expect(new Set(groups).size).toBe(2);
  });
});
