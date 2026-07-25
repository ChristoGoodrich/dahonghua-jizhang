import { toBase, curSymbol, fmtShort, fmt, fmtNum, setDisplaySymbol } from '../money';
import type { Currencies } from '../types';

const currencies: Currencies = { base: 'CNY', rates: { USD: 7.2, JPY: 0.048 } };

describe('toBase', () => {
  it('returns the amount unchanged for the base currency', () => {
    expect(toBase(100, 'CNY', currencies)).toBe(100);
    expect(toBase(100, undefined, currencies)).toBe(100);
  });

  it('converts a foreign amount using its rate', () => {
    expect(toBase(10, 'USD', currencies)).toBeCloseTo(72);
    expect(toBase(1000, 'JPY', currencies)).toBeCloseTo(48);
  });

  it('falls back to the raw amount when no rate is known', () => {
    expect(toBase(10, 'EUR', currencies)).toBe(10);
  });

  it('uses override rate when provided (stored rate on entry)', () => {
    // Entry was recorded at rate 7.5 even though current USD rate is 7.2
    expect(toBase(10, 'USD', currencies, 7.5)).toBeCloseTo(75);
  });

  it('ignores override rate for base currency', () => {
    expect(toBase(100, 'CNY', currencies, 999)).toBe(100);
  });

  it('treats undefined override rate as no override', () => {
    expect(toBase(10, 'USD', currencies, undefined)).toBeCloseTo(72);
  });
});

describe('curSymbol', () => {
  it('maps known codes and falls back to "CODE "', () => {
    expect(curSymbol('USD')).toBe('$');
    expect(curSymbol('XYZ')).toBe('XYZ ');
  });
});

describe('fmtShort', () => {
  it('rounds and prefixes the language symbol', () => {
    expect(fmtShort(1234.6, 'zh')).toBe('￥1,235');
    expect(fmtShort(1000, 'en')).toBe('$1,000');
  });
});

describe('setDisplaySymbol', () => {
  afterEach(() => setDisplaySymbol(null)); // restore language-default fallback

  it('overrides the language default for fmt/fmtShort with the base currency symbol', () => {
    setDisplaySymbol(curSymbol('AUD'));
    expect(fmt(1000, 'zh')).toBe('A$1,000.00');
    expect(fmt(1000, 'en')).toBe('A$1,000.00');
    expect(fmtShort(1000, 'en')).toBe('A$1,000');
  });

  it('falls back to the language symbol when cleared', () => {
    setDisplaySymbol(null);
    expect(fmt(50, 'zh')).toBe('￥50.00');
    expect(fmt(50, 'en')).toBe('$50.00');
  });
});

describe('fmtNum', () => {
  it('formats with two decimals and no currency symbol', () => {
    expect(fmtNum(1234.5)).toBe('1,234.50');
  });
});
