import { noteSuggestions } from '../notes';
import type { Entry } from '../types';

let seq = 0;
const E = (over: Partial<Entry>): Entry => ({ id: 'e' + seq++, ts: 1, io: 'exp', cat: 'food', amt: 10, ...over });

describe('noteSuggestions', () => {
  it('orders by frequency then recency and caps at limit', () => {
    const entries = [
      E({ note: '午饭', ts: 1 }),
      E({ note: '午饭', ts: 2 }),
      E({ note: '咖啡', ts: 9 }),
      E({ note: '早饭', ts: 3 }),
    ];
    expect(noteSuggestions(entries, 'exp', 'food')).toEqual(['午饭', '咖啡', '早饭']);
    expect(noteSuggestions(entries, 'exp', 'food', 2)).toEqual(['午饭', '咖啡']);
  });

  it('filters by io+cat and skips deleted or blank notes', () => {
    const entries = [
      E({ note: '午饭' }),
      E({ note: '打车', cat: 'transport' }),
      E({ note: '工资', io: 'inc', cat: 'salary' }),
      E({ note: '删了', deletedAt: 5 }),
      E({ note: '   ' }),
      E({}),
    ];
    expect(noteSuggestions(entries, 'exp', 'food')).toEqual(['午饭']);
    expect(noteSuggestions(entries, 'exp', 'transport')).toEqual(['打车']);
    expect(noteSuggestions(entries, 'inc', 'salary')).toEqual(['工资']);
  });

  it('dedupes identical notes after trimming', () => {
    const entries = [E({ note: '午饭 ' }), E({ note: '午饭' })];
    expect(noteSuggestions(entries, 'exp', 'food')).toEqual(['午饭']);
  });
});
