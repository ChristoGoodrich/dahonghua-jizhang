import { groupByDay, flattenGroups, labelFor } from '../grouping';
import type { Entry } from '@/domain/types';

const T = new Date(2026, 7, 26, 13, 0, 0).getTime(); // a local Wednesday afternoon
const DAY = 86400000;

const at = (id: string, ts: number, io: Entry['io'], amt: number): Entry =>
  ({ id, ts, io, cat: 'food', amt });

describe('groupByDay', () => {
  it('puts the newest day first, and the newest entry first within it', () => {
    const g = groupByDay([
      at('old', T - DAY * 2, 'exp', 1),
      at('new', T, 'exp', 2),
      at('mid', T - 3600000, 'exp', 3),
    ], T);
    expect(g).toHaveLength(2);
    expect(g[0].items.map((e) => e.id)).toEqual(['new', 'mid']);
    expect(g[1].items.map((e) => e.id)).toEqual(['old']);
  });

  it('counts a transfer in neither total, but still shows it', () => {
    const g = groupByDay([
      at('e', T, 'exp', 10),
      at('i', T - 1, 'inc', 100),
      at('x', T - 2, 'xfer', 5000),
    ], T);
    expect(g[0].dayExp).toBe(10);
    expect(g[0].dayInc).toBe(100);
    expect(g[0].items).toHaveLength(3);
  });

  it('keeps entries stamped in the same millisecond in the order they arrived', () => {
    // a bill import stamps a whole batch inside one millisecond
    const g = groupByDay([at('a', T, 'exp', 1), at('b', T, 'exp', 1), at('c', T, 'exp', 1)], T);
    expect(g[0].items.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not filter a tombstone — the caller decides what reaches the list', () => {
    const gone = { ...at('gone', T, 'exp', 5), deletedAt: 1 };
    expect(groupByDay([gone], T)[0].items).toHaveLength(1);
  });

  it('labels today, yesterday, and dates the rest', () => {
    const g = groupByDay([
      at('t', T, 'exp', 1),
      at('y', T - DAY, 'exp', 1),
      at('o', T - DAY * 9, 'exp', 1),
    ], T);
    expect(g.map((x) => x.label)).toEqual(['today', 'yesterday', 'date']);
  });

  it('gives nothing back for nothing', () => {
    expect(groupByDay([], T)).toEqual([]);
  });
});

describe('labelFor', () => {
  it('counts whole calendar days, not elapsed hours', () => {
    // the point of daysAgo: on the morning after the clocks go forward,
    // twenty-four hours back is the day before yesterday
    const key = new Date(T - DAY).toDateString();
    expect(labelFor(key, T)).toBe('yesterday');
  });

  it('dates a day in the future rather than calling it today', () => {
    expect(labelFor(new Date(T + DAY).toDateString(), T)).toBe('date');
  });
});

describe('flattenGroups', () => {
  const g = () => groupByDay([
    at('a', T, 'exp', 1),
    at('b', T - 1, 'exp', 1),
    at('c', T - 2, 'exp', 1),
    at('d', T - 3, 'exp', 1),
  ], T);

  it('emits a header then its entries', () => {
    const flat = flattenGroups(g(), 1);
    expect(flat.map((i) => i.type)).toEqual(['header', 'entry', 'entry', 'entry', 'entry']);
  });

  it('packs into rows above one column, keeping a short last row', () => {
    const flat = flattenGroups(g(), 3);
    expect(flat.map((i) => i.type)).toEqual(['header', 'entryrow', 'entryrow']);
    const rows = flat.filter((i) => i.type === 'entryrow');
    expect(rows[1].type === 'entryrow' && rows[1].entries).toHaveLength(1);
  });

  it('treats zero columns as one, rather than looping forever', () => {
    // `i += columns` with columns = 0 never advances; the `> 1` guard is what
    // stops it, and this is the test that says so
    expect(flattenGroups(g(), 0)).toEqual(flattenGroups(g(), 1));
  });
});
