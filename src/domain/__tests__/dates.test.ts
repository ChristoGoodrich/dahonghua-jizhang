import { onDay, sameDay, daysAgo, monthGrid } from '../dates';

describe('dates', () => {
  it('onDay moves the calendar day but keeps the time-of-day', () => {
    const src = new Date(2026, 6, 14, 9, 30, 12, 345).getTime();
    const moved = new Date(onDay(src, 2026, 5, 3));
    expect([moved.getFullYear(), moved.getMonth(), moved.getDate()]).toEqual([2026, 5, 3]);
    expect([moved.getHours(), moved.getMinutes(), moved.getSeconds(), moved.getMilliseconds()]).toEqual([9, 30, 12, 345]);
  });

  it('sameDay ignores time but respects the midnight boundary', () => {
    expect(sameDay(new Date(2026, 6, 14, 0, 0).getTime(), new Date(2026, 6, 14, 23, 59).getTime())).toBe(true);
    expect(sameDay(new Date(2026, 6, 14, 23, 59).getTime(), new Date(2026, 6, 15, 0, 0).getTime())).toBe(false);
  });

  it('daysAgo counts calendar days, not 24h windows', () => {
    const now = new Date(2026, 6, 14, 0, 30).getTime();
    expect(daysAgo(new Date(2026, 6, 14, 0, 0).getTime(), now)).toBe(0);
    // 31 minutes earlier, but across midnight -> yesterday
    expect(daysAgo(new Date(2026, 6, 13, 23, 59).getTime(), now)).toBe(1);
    expect(daysAgo(new Date(2026, 6, 12, 12, 0).getTime(), now)).toBe(2);
  });

  it('monthGrid is Monday-first with leading blanks', () => {
    // July 2026 starts on a Wednesday -> 2 leading nulls, 31 days
    const cells = monthGrid(2026, 6);
    expect(cells.slice(0, 3)).toEqual([null, null, 1]);
    expect(cells.filter((c) => c !== null)).toHaveLength(31);
    expect(cells[cells.length - 1]).toBe(31);
    // June 2026 starts on a Monday -> no leading blanks
    expect(monthGrid(2026, 5)[0]).toBe(1);
  });
});
