import { matchesSearch } from '../search';
import type { Category, Entry, IO } from '../types';

const custom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };
const entry: Entry = { id: '1', ts: 1, io: 'exp', cat: 'food', amt: 48.5, note: '叮咚买菜' };

describe('matchesSearch', () => {
  it('matches everything on empty query', () => {
    expect(matchesSearch(entry, '', custom, 'zh')).toBe(true);
    expect(matchesSearch(entry, '   ', custom, 'zh')).toBe(true);
  });
  it('matches category name (localized)', () => {
    expect(matchesSearch(entry, '餐饮', custom, 'zh')).toBe(true);
    expect(matchesSearch(entry, 'food', custom, 'en')).toBe(true);
  });
  it('matches note (case-insensitive)', () => {
    expect(matchesSearch(entry, '买菜', custom, 'zh')).toBe(true);
  });
  it('matches amount substring', () => {
    expect(matchesSearch(entry, '48', custom, 'zh')).toBe(true);
  });
  it('rejects non-matches', () => {
    expect(matchesSearch(entry, '交通', custom, 'zh')).toBe(false);
  });
  it('matches tags and ledger', () => {
    const tagged: Entry = { ...entry, tags: ['旅行', 'work'], ledger: '出差' };
    expect(matchesSearch(tagged, '旅行', custom, 'zh')).toBe(true);
    expect(matchesSearch(tagged, 'work', custom, 'en')).toBe(true);
    expect(matchesSearch(tagged, '出差', custom, 'zh')).toBe(true);
  });
  it('supports amount comparators', () => {
    expect(matchesSearch(entry, '>40', custom, 'zh')).toBe(true); // 48.5 > 40
    expect(matchesSearch(entry, '>50', custom, 'zh')).toBe(false);
    expect(matchesSearch(entry, '<50', custom, 'zh')).toBe(true);
    expect(matchesSearch(entry, '>=48.5', custom, 'zh')).toBe(true);
    expect(matchesSearch(entry, '<=48.5', custom, 'zh')).toBe(true);
    expect(matchesSearch(entry, '=48.5', custom, 'zh')).toBe(true);
    expect(matchesSearch(entry, '=49', custom, 'zh')).toBe(false);
  });
});
