import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RecordSheet } from '../RecordSheet';
import { store$ } from '@/store/ledger';
import { I18N } from '@/i18n';
import type { Category, IO } from '@/domain/types';

const noCustom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };
const s = I18N.zh;

// the sheet reads safe-area insets (like in the app, which mounts a provider at the root)
const METRICS = { insets: { top: 0, left: 0, right: 0, bottom: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } };
const withProvider = (el: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{el}</SafeAreaProvider>
);

beforeEach(() => {
  store$.data.set([]);
  store$.curAccount.set('default');
});

// Walk up from a text node to the nearest ancestor with an onPress handler.
function pressableFor(text: string, root: ReactTestInstance): ReactTestInstance {
  const node = root.find((n) => {
    const c = n.props?.children;
    return c === text || (Array.isArray(c) && c.includes(text));
  });
  let p: ReactTestInstance | null = node;
  while (p && typeof p.props?.onPress !== 'function') p = p.parent;
  if (!p) throw new Error(`no pressable ancestor for "${text}"`);
  return p;
}

describe('RecordSheet save flow', () => {
  it('adds a new entry with the typed amount and default category, then closes', () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        withProvider(
          <RecordSheet
            visible
            editId={null}
            lang="zh"
            customCats={noCustom}
            onClose={onClose}
            onSaved={onSaved}
          />,
        ),
      );
    });

    // type "30" on the calculator keypad
    const keypad = r.root.find((n) => typeof n.props?.onKey === 'function');
    act(() => {
      keypad.props.onKey('3');
      keypad.props.onKey('0');
    });

    // press the save button (re-query after the state update)
    act(() => pressableFor(s.save, r.root).props.onPress());

    const data = store$.data.peek();
    expect(data).toHaveLength(1);
    expect(data[0].amt).toBe(30);
    expect(data[0].io).toBe('exp');
    expect(data[0].cat).toBe('food'); // first expense category by default
    expect(onSaved).toHaveBeenCalledWith(true); // isNew
    expect(onClose).toHaveBeenCalled();
  });

  it('does not save a zero/empty amount', () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        withProvider(
          <RecordSheet visible editId={null} lang="zh" customCats={noCustom} onClose={onClose} onSaved={onSaved} />,
        ),
      );
    });

    act(() => pressableFor(s.save, r.root).props.onPress()); // no amount typed

    expect(store$.data.peek()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('再记 writes the entry, keeps the sheet open, and clears for the next one', () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        withProvider(
          <RecordSheet visible editId={null} lang="zh" customCats={noCustom} onClose={onClose} onSaved={onSaved} />,
        ),
      );
    });

    const keypad = r.root.find((n) => typeof n.props?.onKey === 'function');
    act(() => {
      keypad.props.onKey('4');
      keypad.props.onKey('5');
    });
    act(() => pressableFor(s.saveNext, r.root).props.onPress());

    expect(store$.data.peek()).toHaveLength(1);
    expect(store$.data.peek()[0].amt).toBe(45);
    expect(onSaved).toHaveBeenCalledWith(true, true);
    expect(onClose).not.toHaveBeenCalled();

    // amount cleared — a second entry can be typed straight away
    act(() => keypad.props.onKey('8'));
    act(() => pressableFor(s.saveNext, r.root).props.onPress());
    const data = store$.data.peek();
    expect(data).toHaveLength(2);
    expect(data[1].amt).toBe(8);
  });

  it('saves on a backdated day picked via the date field quick chips', () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        withProvider(
          <RecordSheet visible editId={null} lang="zh" customCats={noCustom} onClose={onClose} onSaved={onSaved} />,
        ),
      );
    });

    const keypad = r.root.find((n) => typeof n.props?.onKey === 'function');
    act(() => keypad.props.onKey('9'));

    // open the date field, then pick 昨天 from the quick chips
    const dateChip = r.root.findAll((n) => n.props?.accessibilityLabel === s.pickDate && typeof n.props?.onPress === 'function')[0];
    act(() => dateChip.props.onPress());
    act(() => pressableFor(s.yesterday, r.root).props.onPress());
    act(() => pressableFor(s.save, r.root).props.onPress());

    const d = store$.data.peek()[0];
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const saved = new Date(d.ts);
    expect([saved.getFullYear(), saved.getMonth(), saved.getDate()]).toEqual([y.getFullYear(), y.getMonth(), y.getDate()]);
    expect(onClose).toHaveBeenCalled();
  });

  it('suggests recent notes for the selected category and fills on tap', () => {
    store$.data.set([
      { id: 'n1', ts: 1, io: 'exp', cat: 'food', amt: 20, note: '午饭' },
      { id: 'n2', ts: 2, io: 'exp', cat: 'food', amt: 21, note: '午饭' },
    ]);
    const onSaved = jest.fn();
    const onClose = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        withProvider(
          <RecordSheet visible editId={null} lang="zh" customCats={noCustom} onClose={onClose} onSaved={onSaved} />,
        ),
      );
    });

    act(() => pressableFor('午饭', r.root).props.onPress());

    const keypad = r.root.find((n) => typeof n.props?.onKey === 'function');
    act(() => keypad.props.onKey('3'));
    act(() => pressableFor(s.save, r.root).props.onPress());

    const saved = store$.data.peek().find((d) => d.id !== 'n1' && d.id !== 'n2')!;
    expect(saved.note).toBe('午饭');
  });
});
