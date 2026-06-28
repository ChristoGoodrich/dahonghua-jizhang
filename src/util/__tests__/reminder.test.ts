import { isValidTime } from '../reminder';

describe('isValidTime', () => {
  it('accepts valid 24h HH:MM', () => {
    ['0:00', '00:00', '9:05', '09:05', '21:30', '23:59'].forEach((t) => expect(isValidTime(t)).toBe(true));
  });
  it('trims surrounding whitespace', () => {
    expect(isValidTime('  21:30 ')).toBe(true);
  });
  it('rejects malformed or out-of-range times', () => {
    ['24:00', '12:60', '9', '9:5', 'abc', '', '99:99'].forEach((t) => expect(isValidTime(t)).toBe(false));
  });
});
