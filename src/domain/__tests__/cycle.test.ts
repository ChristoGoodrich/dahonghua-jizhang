import { cycleRange, inCycle, shiftCycle, cycleDays } from '../cycle';

describe('cycleRange', () => {
  it('default cycle (start=1) is the natural month', () => {
    const { start, end } = cycleRange(new Date(2026, 5, 10), 1); // June 10
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(5); // June
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(6); // July 1
    expect(end.getDate()).toBe(1);
  });

  it('custom cycle (start=25) spans two months and picks the right window', () => {
    // June 10 is before the 25th -> belongs to May 25 .. June 25 window
    const { start, end } = cycleRange(new Date(2026, 5, 10), 25);
    expect(start.getMonth()).toBe(4); // May
    expect(start.getDate()).toBe(25);
    expect(end.getMonth()).toBe(5); // June
    expect(end.getDate()).toBe(25);
  });

  it('custom cycle on/after the start day rolls into the current month', () => {
    const { start } = cycleRange(new Date(2026, 5, 25), 25); // exactly the 25th
    expect(start.getMonth()).toBe(5); // June
    expect(start.getDate()).toBe(25);
  });
});

describe('inCycle', () => {
  it('includes start, excludes end', () => {
    const anchor = new Date(2026, 5, 10);
    const { start, end } = cycleRange(anchor, 1);
    expect(inCycle(start.getTime(), anchor, 1)).toBe(true);
    expect(inCycle(end.getTime(), anchor, 1)).toBe(false);
    expect(inCycle(end.getTime() - 1, anchor, 1)).toBe(true);
  });
});

describe('shiftCycle', () => {
  it('moves to previous/next cycle by start day', () => {
    const prev = shiftCycle(new Date(2026, 5, 10), -1, 25);
    expect(prev.getMonth()).toBe(3); // April 25 (since June 10 belongs to May window)
    expect(prev.getDate()).toBe(25);
  });
});

describe('cycleDays', () => {
  it('counts the days in the cycle window', () => {
    expect(cycleDays(new Date(2026, 5, 10), 1)).toBe(30); // June has 30 days
    expect(cycleDays(new Date(2026, 5, 10), 25)).toBe(31); // May25..Jun25 = 31 days
  });
});
