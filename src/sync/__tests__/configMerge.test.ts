import {
  adoptSections, localNewerThan, sectionPresent, CONFIG_SECTIONS, type Stamps,
} from '../configMerge';

const all = () => (k: string) => CONFIG_SECTIONS.includes(k as never);
const only = (...ks: string[]) => (k: string) => ks.includes(k);

describe('sectionPresent', () => {
  it('accepts a falsy-but-real value', () => {
    // curLedger is '' when no ledger filter is active. A truthiness test made
    // that value unadoptable, which is why it was special-cased; the rule is
    // nullish now so lang and curAccount cannot grow the same bug.
    expect(sectionPresent({ curLedger: '' }, 'curLedger')).toBe(true);
    expect(sectionPresent({ lang: '' }, 'lang')).toBe(true);
    expect(sectionPresent({ curAccount: '' }, 'curAccount')).toBe(true);
    expect(sectionPresent({ accounts: [] }, 'accounts')).toBe(true);
  });

  it('refuses a section a legacy blob left null', () => {
    // adopting would write the null straight into the store
    expect(sectionPresent({ settings: null }, 'settings')).toBe(false);
    expect(sectionPresent({}, 'settings')).toBe(false);
  });
});

describe('adoptSections', () => {
  it('adopts a remotely-newer section and leaves a locally-newer one', () => {
    const local: Stamps = { accounts: 100, tags: 900 };
    const { take, stamps } = adoptSections(local, { accounts: 500, tags: 500 }, all());
    expect(take).toContain('accounts');
    expect(take).not.toContain('tags');
    expect(stamps.accounts).toBe(500); // the remote stamp comes with the section
    expect(stamps.tags).toBe(900);
  });

  it('does not mutate the stamps it was given', () => {
    const local: Stamps = { accounts: 1 };
    adoptSections(local, { accounts: 500 }, all());
    expect(local).toEqual({ accounts: 1 });
  });

  it('skips a section the blob does not carry', () => {
    const { take, stamps } = adoptSections({}, { accounts: 500 }, only('tags'));
    expect(take).toEqual(['tags']);
    expect(stamps.accounts).toBeUndefined(); // untouched, not stamped
  });

  it('lets a fresh device adopt a legacy blob that carries no stamps at all', () => {
    const { take, stamps } = adoptSections({}, undefined, all());
    expect(take).toEqual([...CONFIG_SECTIONS]);
    expect(stamps.accounts).toBe(1); // barely newer than "never edited"
  });

  it('lets any real local edit beat a legacy blob', () => {
    const { take } = adoptSections({ accounts: Date.now() }, undefined, all());
    expect(take).not.toContain('accounts');
  });

  it('is a stalemate on an equal stamp, so neither side flips the other', () => {
    const { take } = adoptSections({ accounts: 500 }, { accounts: 500 }, only('accounts'));
    expect(take).toEqual([]);
    expect(localNewerThan({ accounts: 500 }, { accounts: 500 })).toBe(false);
  });
});

describe('localNewerThan', () => {
  it('asks for a push when a local edit is newer than the blob', () => {
    expect(localNewerThan({ tags: 900 }, { tags: 500 })).toBe(true);
  });

  it('does not ask when the blob is level or ahead', () => {
    expect(localNewerThan({ tags: 500 }, { tags: 900 })).toBe(false);
    expect(localNewerThan({}, { tags: 900 })).toBe(false);
  });

  it('does not ask on a legacy blob this device has never edited', () => {
    // 0 > 1 is false: a never-edited section does not out-rank a missing stamp
    expect(localNewerThan({}, undefined)).toBe(false);
  });

  it('does ask on a legacy blob this device has edited', () => {
    expect(localNewerThan({ subs: 2 }, undefined)).toBe(true);
  });

  it('never asks to push back a section it just adopted', () => {
    // the two run back to back in the realtime handler. If a section could be
    // adopted and then immediately pushed over, two devices would trade the
    // same blob forever, each undoing the other.
    for (const [l, r] of [[0, 0], [0, 5], [5, 0], [5, 5], [1, 1]] as const) {
      const local = l ? { tags: l } : {};
      const remote = r ? { tags: r } : {};
      const { take, stamps } = adoptSections(local, remote, only('tags'));
      if (take.includes('tags')) {
        expect(localNewerThan(stamps, remote)).toBe(false);
      }
    }
  });

  it('does ask when the blob carries a section it has no stamp for', () => {
    // not a disagreement with adoptSections: the remote has no record of the
    // edit this device made, so the server copy really is behind
    const { take, stamps } = adoptSections({ tags: 5 }, {}, only('tags'));
    expect(take).toEqual([]);
    expect(localNewerThan(stamps, {})).toBe(true);
  });
});
