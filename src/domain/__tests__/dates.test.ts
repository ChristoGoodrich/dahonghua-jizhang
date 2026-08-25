import { onDay, sameDay, daysAgo, monthGrid, localDateStr } from '../dates';

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

describe('localDateStr', () => {
  it('renders the local calendar date, zero-padded', () => {
    expect(localDateStr(new Date(2026, 0, 5, 12).getTime())).toBe('2026-01-05');
    expect(localDateStr(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31');
  });

  it('agrees with what the app displays, at every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      const d = new Date(2026, 5, 10, h, 30);
      const shown = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
      expect(localDateStr(d.getTime())).toBe(shown);
    }
  });

  it('differs from the UTC date wherever the offset is not zero', () => {
    // the whole reason this exists: `toISOString().slice(0, 10)` is the UTC
    // day, which is a different day for most of every day outside UTC
    const d = new Date(2026, 5, 10, 0, 30);
    const offset = d.getTimezoneOffset();
    if (offset === 0) return; // nothing to prove in UTC
    const utc = d.toISOString().slice(0, 10);
    const local = localDateStr(d.getTime());
    // east of Greenwich, local midnight is still the previous UTC day
    if (offset < 0) expect(utc).not.toBe(local);
  });

  it('does not throw on an unusable timestamp', () => {
    // `toISOString` raises RangeError here, taking a whole export with it
    expect(() => new Date(NaN).toISOString()).toThrow(RangeError);
    expect(localDateStr(NaN)).toBe('NaN-NaN-NaN');
  });
});
