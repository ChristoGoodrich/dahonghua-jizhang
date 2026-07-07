import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StatsView } from '@/features/stats/StatsView';
import { I18N } from '@/i18n';
import type { Category, Entry, IO } from '@/domain/types';

const s = I18N.zh;
const custom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };

function textOf(json: any): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  return textOf(json.children);
}

describe('StatsView time-of-day section', () => {
  it('renders the 按时段 chart with the period the spend falls in', async () => {
    const at = (d: number, h: number) => new Date(2026, 5, d, h, 30).getTime(); // June 2026
    const all: Entry[] = [
      { id: '1', ts: at(8, 12), io: 'exp', cat: 'food', amt: 28 }, // noon
      { id: '2', ts: at(9, 21), io: 'exp', cat: 'shop', amt: 50 }, // night
    ];
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <StatsView all={all} anchor={new Date(2026, 5, 15)} cycleStart={1} customCats={custom} lang="zh" />,
      );
    });
    const txt = textOf(r.toJSON());
    expect(txt).toContain(s.stByTime); // 按时段 section header
    expect(txt).toContain(s.todNoon); // 中午
    expect(txt).toContain(s.todNight); // 晚上
  });
});
