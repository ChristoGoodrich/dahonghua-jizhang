import { monthKey } from '../indexes';

describe('monthKey', () => {
  it('returns YYYY-MM for a known timestamp', () => {
    // 2026-03-15 10:00 UTC
    expect(monthKey(Date.UTC(2026, 2, 15, 10))).toBe('2026-03');
  });

  it('pads single-digit months with a leading zero', () => {
    expect(monthKey(Date.UTC(2026, 0, 1))).toBe('2026-01');
  });
});
