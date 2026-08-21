import { matchesFilter, parseDateRange, parseSearchQuery, type FilterState } from '../filter';
import type { Entry } from '../types';

const entry = (p: Partial<Entry>): Entry =>
  ({ id: 'e1', ts: 1_000, io: 'exp', cat: 'food', amt: 10, ...p }) as Entry;

describe('matchesFilter', () => {
  it('passes an entry when nothing is filtered', () => {
    expect(matchesFilter(entry({}), {})).toBe(true);
  });

  it('filters by direction, category and account', () => {
    const e = entry({ io: 'exp', cat: 'food', acct: 'a1' });
    expect(matchesFilter(e, { io: 'exp' })).toBe(true);
    expect(matchesFilter(e, { io: 'inc' })).toBe(false);
    expect(matchesFilter(e, { cat: 'food' })).toBe(true);
    expect(matchesFilter(e, { cat: 'trans' })).toBe(false);
    expect(matchesFilter(e, { acct: 'a1' })).toBe(true);
    expect(matchesFilter(e, { acct: 'a2' })).toBe(false);
  });

  it('treats the date range as inclusive at both ends', () => {
    const e = entry({ ts: 1_000 });
    expect(matchesFilter(e, { dateFrom: 1_000, dateTo: 1_000 })).toBe(true);
    expect(matchesFilter(e, { dateFrom: 1_001 })).toBe(false);
    expect(matchesFilter(e, { dateTo: 999 })).toBe(false);
  });

  it('ignores a zero bound, because the guards are truthiness tests', () => {
    // `if (filter.dateFrom && …)` — epoch 0 reads as "no bound"
    const e = entry({ ts: -5 });
    expect(matchesFilter(e, { dateFrom: 0 })).toBe(true);
  });

  it('requires every active filter, not any', () => {
    const e = entry({ io: 'exp', cat: 'food' });
    const f: FilterState = { io: 'exp', cat: 'trans' };
    expect(matchesFilter(e, f)).toBe(false);
  });
});

describe('parseDateRange', () => {
  const civil = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
  };

  it('reads a single day as that day, not from the start of its year', () => {
    // `from` was built from the year capture alone, so searching one day
    // returned everything since January 1st
    const r = parseDateRange('2024-01-15')!;
    expect(civil(r.from!)).toBe('2024-0-15 0:0:0');
    expect(civil(r.to!)).toBe('2024-0-15 23:59:59');
  });

  it('reads a month to its real last day', () => {
    expect(civil(parseDateRange('2024-02')!.to!)).toBe('2024-1-29 23:59:59');
    expect(civil(parseDateRange('2025-02')!.to!)).toBe('2025-1-28 23:59:59');
  });

  it('reads an explicit range', () => {
    const r = parseDateRange('2024-01-01~2024-01-31')!;
    expect(civil(r.from!)).toBe('2024-0-1 0:0:0');
    expect(civil(r.to!)).toBe('2024-0-31 23:59:59');
  });

  it('rejects a day outside the ISO grammar but rolls one inside it', () => {
    // the date-time string grammar bounds DD to 01-31; anything in range then
    // rolls, which is why Feb 29 of a common year is March 1 rather than null
    expect(parseDateRange('2024-01-32')).toBeNull();
    expect(civil(parseDateRange('2025-02-29')!.to!)).toBe('2025-2-1 23:59:59');
  });

  it('returns null for anything it does not recognise', () => {
    for (const q of ['', '肯德基', '2024', '24-01', '2024-1', 'next week']) {
      expect(parseDateRange(q)).toBeNull();
    }
  });
});

describe('parseSearchQuery', () => {
  it('picks up the english direction keywords', () => {
    expect(parseSearchQuery('expense lunch')).toEqual({ text: 'lunch', filter: { io: 'exp' } });
    expect(parseSearchQuery('spent 5')).toEqual({ text: '5', filter: { io: 'exp' } });
    expect(parseSearchQuery('income')).toEqual({ text: '', filter: { io: 'inc' } });
    expect(parseSearchQuery('transfer')).toEqual({ text: '', filter: { io: 'xfer' } });
  });

  it('picks up the chinese direction keywords', () => {
    // These never matched: `\b` is defined against \w, which holds no CJK
    // character, so `\b支出\b` could not fire. In a Chinese-language ledger
    // that meant searching 支出 set no filter at all.
    expect(parseSearchQuery('支出')).toEqual({ text: '', filter: { io: 'exp' } });
    expect(parseSearchQuery('买菜 支出')).toEqual({ text: '买菜', filter: { io: 'exp' } });
    expect(parseSearchQuery('花掉 100')).toEqual({ text: '100', filter: { io: 'exp' } });
    expect(parseSearchQuery('收入 工资')).toEqual({ text: '工资', filter: { io: 'inc' } });
    expect(parseSearchQuery('进账')).toEqual({ text: '', filter: { io: 'inc' } });
    expect(parseSearchQuery('转账 给妈妈')).toEqual({ text: '给妈妈', filter: { io: 'xfer' } });
  });

  it('keeps the word boundary where it still means something', () => {
    // the reason `\b` is worth keeping around the ASCII words
    expect(parseSearchQuery('inexpensive')).toEqual({ text: 'inexpensive', filter: {} });
    expect(parseSearchQuery('transferred')).toEqual({ text: 'transferred', filter: {} });
    expect(parseSearchQuery('expenses')).toEqual({ text: 'expenses', filter: {} });
  });

  it('matches the english keywords case-insensitively', () => {
    expect(parseSearchQuery('EXPENSE')).toEqual({ text: '', filter: { io: 'exp' } });
    expect(parseSearchQuery('Income')).toEqual({ text: '', filter: { io: 'inc' } });
  });

  it('takes the first direction that strips anything', () => {
    // expense is tested before income, so a query naming both reads as expense
    expect(parseSearchQuery('支出 收入').filter.io).toBe('exp');
  });

  it('leaves a query with no keyword alone', () => {
    expect(parseSearchQuery('肯德基')).toEqual({ text: '肯德基', filter: {} });
    expect(parseSearchQuery('  ')).toEqual({ text: '', filter: {} });
  });

  it('does not carry regex state between calls', () => {
    // the keyword patterns are module-level and /g/; `.test()` on those would
    // advance lastIndex and make the second call disagree with the first
    for (let i = 0; i < 5; i++) {
      expect(parseSearchQuery('支出 买菜')).toEqual({ text: '买菜', filter: { io: 'exp' } });
    }
  });

  it('clears the text when the whole query is a date', () => {
    const r = parseSearchQuery('2024-01');
    expect(r.text).toBe('');
    expect(r.filter.dateFrom).toBeDefined();
    expect(r.filter.dateTo).toBeDefined();
  });
});
