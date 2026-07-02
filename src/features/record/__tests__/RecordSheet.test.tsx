import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { RecordSheet } from '../RecordSheet';
import { store$ } from '@/store/ledger';
import { I18N } from '@/i18n';
import type { Category, IO } from '@/domain/types';

const noCustom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };
const s = I18N.zh;

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
        <RecordSheet
          visible
          editId={null}
          lang="zh"
          customCats={noCustom}
          onClose={onClose}
          onSaved={onSaved}
        />,
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
        <RecordSheet visible editId={null} lang="zh" customCats={noCustom} onClose={onClose} onSaved={onSaved} />,
      );
    });

    act(() => pressableFor(s.save, r.root).props.onPress()); // no amount typed

    expect(store$.data.peek()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
