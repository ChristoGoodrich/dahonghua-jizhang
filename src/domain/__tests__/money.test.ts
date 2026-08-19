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

  // These two guard the *pin*, not the runner. Asserting a literal only proves
  // the machine running the suite agrees; comparing against both locales proves
  // the formatter stopped asking the device. Before this was pinned, a German
  // handset rendered ￥1.234.567,50 and an en-IN one ￥12,34,567.50, whatever
  // language the user had chosen in the app.
  it('groups the way zh-CN and en-US do, on any device', () => {
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    expect(fmtNum(1234567.5)).toBe((1234567.5).toLocaleString('en-US', opts));
    expect(fmtNum(1234567.5)).toBe((1234567.5).toLocaleString('zh-CN', opts));
  });

  it('does not follow a device locale that groups differently', () => {
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    expect(fmtNum(1234567.5)).not.toBe((1234567.5).toLocaleString('de-DE', opts));
    expect(fmtNum(1234567.5)).not.toBe((1234567.5).toLocaleString('en-IN', opts));
  });
});

describe('negative zero', () => {
  // An amount of -0.3 rounds to -0, and JS renders that as "-0" — so the
  // compact summary read "￥-0". Caught by the TS/Rust parity harness.
  it('never renders a minus sign on a zero', () => {
    expect(fmtNum(-0)).toBe('0.00');
    expect(fmtNum(-0.001)).toBe('0.00');
    expect(fmtShort(-0.3, 'zh')).toBe('￥0');
    expect(fmt(-0, 'en')).toBe('$0.00');
  });

  it('still signs a real negative', () => {
    expect(fmtNum(-1)).toBe('-1.00');
    expect(fmtShort(-1.4, 'zh')).toBe('￥-1');
  });
});

describe('fmtShort', () => {
  it('is pinned the same way as fmtNum', () => {
    expect(fmtShort(1234567, 'en')).toBe('$' + (1234567).toLocaleString('en-US'));
    expect(fmtShort(1234567, 'en')).not.toBe('$' + (1234567).toLocaleString('de-DE'));
  });
});
