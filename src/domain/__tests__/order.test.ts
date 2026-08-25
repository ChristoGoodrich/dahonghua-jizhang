import { descByAmt, ascByAmt } from '../order';

const sortDesc = (xs: number[]) => [...xs].sort(descByAmt);

describe('descByAmt', () => {
  it('ranks largest first', () => {
    expect(sortDesc([10, 50, 20])).toEqual([50, 20, 10]);
  });

  it('puts an unusable amount last wherever it started', () => {
    // the whole point: `b - a` leaves the first of these completely unsorted,
    // because a NaN comparator result makes the order implementation-defined
    expect(sortDesc([10, NaN, 50, 20])).toEqual([50, 20, 10, NaN]);
    expect(sortDesc([10, 20, 50, NaN])).toEqual([50, 20, 10, NaN]);
    expect(sortDesc([NaN, 10, 50])).toEqual([50, 10, NaN]);
  });

  it('is what `b - a` is not: a consistent comparator', () => {
    // non-transitivity is the defect, and it is checkable directly
    const naive = (a: number, b: number) => b - a;
    // under `naive`, NaN is "equal" to both 10 and 50 while 50 > 10
    expect(Number.isNaN(naive(10, NaN))).toBe(true);
    expect(Number.isNaN(naive(NaN, 50))).toBe(true);
    expect(naive(10, 50)).not.toBe(0);
    // under descByAmt no pair reports equal unless it really is
    expect(descByAmt(10, NaN)).toBe(-1);
    expect(descByAmt(NaN, 50)).toBe(1);
    expect(descByAmt(NaN, NaN)).toBe(0);
  });

  it('keeps ties in their original order', () => {
    const rows = [
      { k: 'a', v: 5 },
      { k: 'b', v: 5 },
      { k: 'c', v: 9 },
    ];
    expect([...rows].sort((x, y) => descByAmt(x.v, y.v)).map((r) => r.k)).toEqual(['c', 'a', 'b']);
  });

  it('handles infinities and negative zero', () => {
    expect(sortDesc([1, Infinity, -Infinity, 0])).toEqual([Infinity, 1, 0, -Infinity]);
    // -0 and 0 compare equal, so the original order survives
    expect(sortDesc([-0, 0]).map(Object.is.bind(null, -0))).toEqual([true, false]);
  });
});

describe('ascByAmt', () => {
  it('ranks smallest first and still puts NaN last', () => {
    expect([...[10, NaN, 50, 20]].sort(ascByAmt)).toEqual([10, 20, 50, NaN]);
  });
});
