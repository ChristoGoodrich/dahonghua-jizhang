import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { EntryList } from '../EntryList';
import { Tap } from '@/components/ui/Tap';
import { I18N } from '@/i18n';
import type { Category, Entry, IO } from '@/domain/types';

const noCustom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };

// Flatten a react-test-renderer JSON tree into its concatenated text content.
function textOf(json: TestRenderer.ReactTestRendererJSON | TestRenderer.ReactTestRendererJSON[] | null | string): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  return textOf(json.children as never);
}

function render(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(el); });
  return r;
}

describe('EntryList', () => {
  const now = Date.now();
  const entries: Entry[] = [
    { id: 'e1', ts: now, io: 'exp', cat: 'food', amt: 30 },
    { id: 'e2', ts: now - 1000, io: 'inc', cat: 'salary', amt: 100 },
  ];

  it('renders category names, signed amounts, and the day expense total', () => {
    const r = render(<EntryList entries={entries} customCats={noCustom} lang="zh" onPress={() => {}} />);
    const text = textOf(r.toJSON());
    expect(text).toContain('餐饮'); // food (zh)
    expect(text).toContain('工资'); // salary (zh)
    expect(text).toContain('-30.00'); // expense is signed & symbol-less
    expect(text).toContain('+100.00'); // income
    expect(text).toContain('￥30.00'); // day header shows the expense total (only the 30 expense)
  });

  it('names the day group, in the current language', () => {
    // Nothing here looked at the header text, so moving the label decision into
    // grouping.ts and forgetting to spell it out again rendered the literal
    // word "today". Both are strings, so the typechecker was content.
    const r = render(<EntryList entries={entries} customCats={noCustom} lang="zh" onPress={() => {}} />);
    const text = textOf(r.toJSON());
    expect(text).toContain(I18N.zh.today);
    expect(text).not.toContain('today');
  });

  it('names yesterday, and dates anything older', () => {
    const older: Entry[] = [
      { id: 'y', ts: now - 86400000, io: 'exp', cat: 'food', amt: 1 },
      { id: 'o', ts: now - 86400000 * 9, io: 'exp', cat: 'food', amt: 1 },
    ];
    const r = render(<EntryList entries={older} customCats={noCustom} lang="en" onPress={() => {}} />);
    const text = textOf(r.toJSON());
    expect(text).toContain(I18N.en.yesterday);
    // the third label is a real date rather than either word
    const dated = new Date(now - 86400000 * 9).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', weekday: 'short',
    });
    expect(text).toContain(dated);
  });

  it('shows the default empty message with no entries', () => {
    const r = render(<EntryList entries={[]} customCats={noCustom} lang="zh" onPress={() => {}} />);
    expect(textOf(r.toJSON())).toContain(I18N.zh.empty);
  });

  it('uses the provided emptyText override', () => {
    const r = render(<EntryList entries={[]} customCats={noCustom} lang="zh" onPress={() => {}} emptyText="没找到" />);
    expect(textOf(r.toJSON())).toContain('没找到');
  });

  it('fires onPress / onLongPress with the entry id when a row is tapped', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const r = render(
      <EntryList entries={[entries[0]]} customCats={noCustom} lang="zh" onPress={onPress} onLongPress={onLongPress} />,
    );
    // the expense row is the one Tap uniquely identified by delayLongPress={400}
    const rows = r.root.findAllByType(Tap).filter((n) => n.props?.delayLongPress === 400);
    expect(rows.length).toBe(1);
    act(() => rows[0].props.onPress());
    expect(onPress).toHaveBeenCalledWith('e1');
    act(() => rows[0].props.onLongPress());
    expect(onLongPress).toHaveBeenCalledWith('e1');
  });
});
