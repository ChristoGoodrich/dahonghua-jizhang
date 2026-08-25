// Comparators that are total orders.
//
// `sort((a, b) => b.amt - a.amt)` looks like the obvious way to rank amounts
// largest-first, and it is — right up until one amount is NaN. Then the
// subtraction is NaN, and ECMA-262 says a comparator that is not consistent
// leaves the sort order **implementation-defined**. That is not a theoretical
// footnote:
//
//   [10, NaN, 50, 20]  sorted descending in Node  →  10, NaN, 50, 20
//   [10, 20, 50, NaN]  sorted descending in Node  →  50, 20, 10, NaN
//
// The first list comes back untouched, including the two entries that had
// nothing to do with the NaN. Move the NaN and the same comparator sorts
// properly. A different engine is free to answer differently again — and this
// app ships on Hermes, not on the V8 the tests run under, so the behaviour
// under test is not even the behaviour that ships.
//
// A NaN amount is not a normal state, but it is reachable: an import with a
// malformed number, a currency conversion with a missing rate, a hand-edited
// backup. When it happens the ranking should be boringly wrong in a fixed way,
// not differently wrong per device.
//
// So: unusable amounts sort last, and everything else compares normally.

/** Largest first, with NaN last. A total order, unlike `b - a`. */
export function descByAmt(a: number, b: number): number {
  const an = Number.isNaN(a);
  const bn = Number.isNaN(b);
  if (an) return bn ? 0 : 1;
  if (bn) return -1;
  return b < a ? -1 : b > a ? 1 : 0;
}

/** Smallest first, with NaN last. */
export function ascByAmt(a: number, b: number): number {
  const an = Number.isNaN(a);
  const bn = Number.isNaN(b);
  if (an) return bn ? 0 : 1;
  if (bn) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
