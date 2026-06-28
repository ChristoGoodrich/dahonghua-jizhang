import { monthRecap } from '../recap';
import type { Entry } from '../types';

const day = (d: number) => new Date(2026, 5, d, 12).getTime();
const entries: Entry[] = [
  { id: '1', ts: day(1), io: 'exp', cat: 'food', amt: 40 },
  { id: '2', ts: day(1), io: 'exp', cat: 'food', amt: 20 }, // same day
  { id: '3', ts: day(2), io: 'exp', cat: 'trans', amt: 15 },
  { id: '4', ts: day(3), io: 'inc', cat: 'salary', amt: 500 },
];

describe('monthRecap', () => {
  it('totals income/expense/net', () => {
    const r = monthRecap(entries);
    expect(r.exp).toBe(75);
    expect(r.inc).toBe(500);
    expect(r.net).toBe(425);
  });
  it('counts entries and distinct active days', () => {
    const r = monthRecap(entries);
    expect(r.count).toBe(4);
    expect(r.activeDays).toBe(3); // days 1, 2, 3
  });
  it('finds the biggest expense category', () => {
    const r = monthRecap(entries);
    expect(r.topCatKey).toBe('food'); // 60 > 15
    expect(r.topCatAmt).toBe(60);
  });
  it('handles an empty cycle', () => {
    const r = monthRecap([]);
    expect(r).toMatchObject({ exp: 0, inc: 0, net: 0, count: 0, activeDays: 0, topCatKey: null });
  });
});
