import { streakDays } from '../streak';

const day = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();

describe('streakDays', () => {
  const now = new Date(2026, 5, 10, 9); // June 10

  it('is 0 with no entries', () => {
    expect(streakDays([], now)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const ts = [day(2026, 5, 10), day(2026, 5, 9), day(2026, 5, 8)];
    expect(streakDays(ts, now)).toBe(3);
  });

  it('still counts when nothing logged today but yesterday is covered', () => {
    const ts = [day(2026, 5, 9), day(2026, 5, 8)];
    expect(streakDays(ts, now)).toBe(2);
  });

  it('breaks on a gap', () => {
    const ts = [day(2026, 5, 10), day(2026, 5, 8)]; // missing the 9th
    expect(streakDays(ts, now)).toBe(1);
  });

  it('is 0 when the most recent entry is older than yesterday', () => {
    const ts = [day(2026, 5, 7)];
    expect(streakDays(ts, now)).toBe(0);
  });
});
