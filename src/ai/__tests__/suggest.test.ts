import { suggestCategory, detectAnomaly } from '../suggest';
import type { Entry, Category, IO } from '@/domain/types';

const noCustom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };

const history: Entry[] = [
  { id: '1', ts: 1, io: 'exp', cat: 'food', amt: 30, note: '午饭' },
  { id: '2', ts: 2, io: 'exp', cat: 'food', amt: 35, note: '午饭拉面' },
  { id: '3', ts: 3, io: 'exp', cat: 'food', amt: 25, note: '午饭便当' },
  { id: '4', ts: 4, io: 'exp', cat: 'trans', amt: 10, note: '地铁' },
  { id: '5', ts: 5, io: 'exp', cat: 'trans', amt: 12, note: '地铁通勤' },
  { id: '6', ts: 6, io: 'exp', cat: 'shop', amt: 200, note: '买衣服' },
  { id: '7', ts: 7, io: 'exp', cat: 'food', amt: 50, note: '晚饭' },
  { id: '8', ts: 8, io: 'exp', cat: 'food', amt: 45, note: '晚饭火锅' },
];

describe('suggestCategory', () => {
  it('returns food for lunch-related notes', () => {
    const result = suggestCategory('午饭', history, noCustom, 'zh');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].cat).toBe('food');
    expect(result[0].confidence).toBeGreaterThan(0);
  });

  it('returns empty for unknown notes', () => {
    const result = suggestCategory('量子力学考试', history, noCustom, 'zh');
    expect(result).toEqual([]);
  });

  it('returns at most 3 suggestions', () => {
    const result = suggestCategory('午饭', history, noCustom, 'zh');
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns suggestions sorted by confidence descending', () => {
    const result = suggestCategory('午饭', history, noCustom, 'zh');
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].confidence).toBeGreaterThanOrEqual(result[i].confidence);
    }
  });

  it('matches transit notes', () => {
    const result = suggestCategory('地铁', history, noCustom, 'zh');
    expect(result[0].cat).toBe('trans');
  });
});

describe('detectAnomaly', () => {
  const normalHistory: Entry[] = [
    { id: '1', ts: 1, io: 'exp', cat: 'food', amt: 30 },
    { id: '2', ts: 2, io: 'exp', cat: 'food', amt: 32 },
    { id: '3', ts: 3, io: 'exp', cat: 'food', amt: 28 },
    { id: '4', ts: 4, io: 'exp', cat: 'food', amt: 35 },
    { id: '5', ts: 5, io: 'exp', cat: 'food', amt: 27 },
    { id: '6', ts: 6, io: 'exp', cat: 'food', amt: 31 },
  ];

  it('flags anomalous amounts (>2 std deviations)', () => {
    const entry: Entry = { id: '10', ts: 10, io: 'exp', cat: 'food', amt: 200 };
    const result = detectAnomaly(entry, normalHistory);
    expect(result).not.toBeNull();
    expect(result!.isAnomaly).toBe(true);
    expect(result!.avgAmount).toBeCloseTo(30.5, 0);
    expect(result!.deviation).toBeGreaterThan(2);
  });

  it('does not flag normal amounts', () => {
    const entry: Entry = { id: '10', ts: 10, io: 'exp', cat: 'food', amt: 33 };
    const result = detectAnomaly(entry, normalHistory);
    expect(result).not.toBeNull();
    expect(result!.isAnomaly).toBe(false);
  });

  it('returns null when fewer than 5 similar entries exist', () => {
    const sparseHistory: Entry[] = [
      { id: '1', ts: 1, io: 'exp', cat: 'food', amt: 30 },
      { id: '2', ts: 2, io: 'exp', cat: 'food', amt: 32 },
      { id: '3', ts: 3, io: 'exp', cat: 'food', amt: 28 },
    ];
    const entry: Entry = { id: '10', ts: 10, io: 'exp', cat: 'food', amt: 200 };
    expect(detectAnomaly(entry, sparseHistory)).toBeNull();
  });

  it('returns null when no similar entries exist', () => {
    const entry: Entry = { id: '10', ts: 10, io: 'exp', cat: 'travel', amt: 5000 };
    expect(detectAnomaly(entry, normalHistory)).toBeNull();
  });
});
