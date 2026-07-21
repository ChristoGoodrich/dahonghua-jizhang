import { resolveCategory, normalizeParsed, buildUserPrompt, type ParsedEntry } from '../parse';
import type { Category, IO } from '@/domain/types';

const noCustom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };

describe('resolveCategory', () => {
  it('matches a base category by zh name', () => {
    expect(resolveCategory('餐饮', 'exp', noCustom)).toBe('food');
  });
  it('matches by en name, case-insensitive', () => {
    expect(resolveCategory('transit', 'exp', noCustom)).toBe('trans');
    expect(resolveCategory('SALARY', 'inc', noCustom)).toBe('salary');
  });
  it('matches by emoji', () => {
    expect(resolveCategory('🛍️', 'exp', noCustom)).toBe('shop');
  });
  it('matches a custom category', () => {
    const custom: Record<IO, Category[]> = {
      exp: [{ k: 'pet', e: '🐼', zh: '宠物', en: 'Pet', c: '#000' }],
      inc: [],
      xfer: [],
    };
    expect(resolveCategory('宠物', 'exp', custom)).toBe('pet');
  });
  it('falls back to the last category for an unknown label', () => {
    expect(resolveCategory('zzz unknown', 'exp', noCustom)).toBe('other');
  });
  it('falls back for an empty label', () => {
    expect(resolveCategory('', 'exp', noCustom)).toBe('other');
  });
});

describe('normalizeParsed', () => {
  it('builds a sheet-ready draft', () => {
    const raw: ParsedEntry = { io: 'exp', amount: 35, category: '餐饮', note: '午饭' };
    expect(normalizeParsed(raw, noCustom)).toEqual({ io: 'exp', cat: 'food', amt: '35', note: '午饭' });
  });
  it('rounds the amount to 2dp and clamps negatives to 0', () => {
    expect(normalizeParsed({ io: 'exp', amount: 12.345, category: '其他' }, noCustom).amt).toBe('12.35');
    expect(normalizeParsed({ io: 'exp', amount: -9, category: '其他' }, noCustom).amt).toBe('');
  });
  it('handles income and trims the note', () => {
    const r = normalizeParsed({ io: 'inc', amount: 5000, category: 'salary', note: '  March pay  ' }, noCustom);
    expect(r).toEqual({ io: 'inc', cat: 'salary', amt: '5000', note: 'March pay' });
  });
  it('coerces a bad io to expense and a non-finite amount to 0', () => {
    const r = normalizeParsed({ io: 'weird' as 'exp', amount: NaN, category: '餐饮' }, noCustom);
    expect(r.io).toBe('exp');
    expect(r.amt).toBe('');
  });
});

describe('buildUserPrompt', () => {
  it('embeds the available category labels and the entry text', () => {
    const p = buildUserPrompt('午饭35', noCustom, 'zh');
    expect(p).toContain('餐饮');
    expect(p).toContain('工资');
    expect(p).toContain('午饭35');
  });

  it('omits custom category names when passed no custom cats (privacy path)', () => {
    const withCustom: Record<IO, Category[]> = {
      exp: [{ k: 'therapy', e: '🛋️', zh: '心理治疗', en: 'Therapy', c: '#000' }],
      inc: [],
      xfer: [],
    };
    // sharing on: the sensitive custom name is included
    expect(buildUserPrompt('x', withCustom, 'zh')).toContain('心理治疗');
    // sharing off (client passes empty custom cats): only built-ins are sent
    const priv = buildUserPrompt('x', noCustom, 'zh');
    expect(priv).not.toContain('心理治疗');
    expect(priv).toContain('餐饮'); // built-ins still present, so AI can still classify
  });
});

// Models do not reliably honour the schema. These are the deviations seen most
// often, and the two that used to slip through into a real entry amount.
describe('normalizeParsed against malformed model output', () => {
  const amt = (raw: unknown) => normalizeParsed(raw as ParsedEntry, noCustom).amt;

  it('accepts an amount returned as a string', () => {
    // the single most common deviation; Number.isFinite('35') is false, so this
    // used to resolve to 0 and silently produce nothing
    expect(amt({ io: 'exp', amount: '35', category: '餐饮' })).toBe('35');
    expect(amt({ io: 'exp', amount: '35.50', category: '餐饮' })).toBe('35.5');
    expect(amt({ io: 'exp', amount: '¥35', category: '餐饮' })).toBe('35');
  });

  it('rejects an implausible amount rather than letting it become an entry', () => {
    expect(amt({ io: 'exp', amount: 1e21, category: '餐饮' })).toBe('');
    expect(amt({ io: 'exp', amount: 5e15, category: '餐饮' })).toBe('');
    // 1e21 formats as "1e+21", which the amount field's parser reads as 1+21=22
    expect(amt({ io: 'exp', amount: 1e21, category: '餐饮' })).not.toContain('e');
  });

  it('still accepts a large but plausible amount', () => {
    expect(amt({ io: 'exp', amount: 250000, category: '餐饮' })).toBe('250000');
  });

  it('survives a non-object reply', () => {
    const d = normalizeParsed([1, 2, 3] as unknown as ParsedEntry, noCustom);
    expect(d.amt).toBe('');
    expect(d.io).toBe('exp');
  });

  it('coerces junk amounts to nothing', () => {
    expect(amt({ io: 'exp', amount: 'abc', category: '餐饮' })).toBe('');
    expect(amt({ io: 'exp', amount: null, category: '餐饮' })).toBe('');
    expect(amt({ io: 'exp', amount: Infinity, category: '餐饮' })).toBe('');
    expect(amt({ io: 'exp', amount: -50, category: '餐饮' })).toBe('');
  });
});
