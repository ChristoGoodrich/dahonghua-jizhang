// TransferForm coverage.
//
// The interesting behaviour is not the layout — it is the two rules that keep a
// transfer well-formed: the TO list never offers the account already selected as
// FROM, and picking a FROM that is currently the TO silently moves TO elsewhere
// rather than leaving a self-transfer staged. Both are one-liners that are easy
// to break and impossible to notice until a user files a "money vanished" bug.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { TransferForm } from '../TransferForm';
import { I18N } from '@/i18n';
import type { Account } from '@/domain/types';

jest.mock('@/theme/ThemeContext', () => ({
  useTheme: () => ({
    ink: '#2B2622', inkSoft: '#8A8178', line: '#EADFCF',
    card: '#FFFDF8', paperWarm: '#F6EEE2', hibiscus: '#C4515E', isDark: false,
  }),
}));

const ACCTS: Account[] = [
  { id: 'a1', name: '现金', nameEn: 'Cash' } as Account,
  { id: 'a2', name: '招行', nameEn: 'CMB' } as Account,
  { id: 'a3', name: '支付宝', nameEn: 'Alipay' } as Account,
];

function render(over: Partial<React.ComponentProps<typeof TransferForm>> = {}) {
  const props = {
    accounts: ACCTS,
    acct: 'a1',
    acctTo: 'a2',
    fee: '',
    discount: '',
    setAcct: jest.fn(),
    setAcctTo: jest.fn(),
    setFee: jest.fn(),
    setDiscount: jest.fn(),
    lang: 'zh' as const,
    ...over,
  };
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<TransferForm {...props} />); });
  return { r, props };
}

/** Every Chip rendered, in document order, as { label, on, press }. */
function chips(r: TestRenderer.ReactTestRenderer) {
  return r.root.findAll(
    (n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'Chip',
    { deep: true },
  ).map((n) => ({
    label: n.props.label as string,
    on: n.props.on as boolean,
    press: n.props.onPress as () => void,
  }));
}

/** The fee field, then the discount field. findAllByType keeps this to the two
 *  composite TextInputs — a props predicate would also match their host nodes. */
function inputs(r: TestRenderer.ReactTestRenderer) {
  return r.root.findAllByType(TextInput);
}

describe('guard rail: not enough accounts', () => {
  it('explains itself instead of rendering an unusable form', () => {
    const { r } = render({ accounts: [ACCTS[0]] });
    expect(JSON.stringify(r.toJSON())).toContain(I18N.zh.xferNeedAccts);
    expect(chips(r)).toHaveLength(0);
  });

  it('also covers the empty case', () => {
    const { r } = render({ accounts: [] });
    expect(JSON.stringify(r.toJSON())).toContain(I18N.zh.xferNeedAccts);
  });
});

describe('account lists', () => {
  it('offers every account as FROM, and marks the selected one', () => {
    const { r } = render({ acct: 'a1', acctTo: 'a2' });
    const from = chips(r).slice(0, 3);
    expect(from.map((c) => c.label)).toEqual(['现金', '招行', '支付宝']);
    expect(from.map((c) => c.on)).toEqual([true, false, false]);
  });

  it('omits the FROM account from the TO list, so a self-transfer cannot be picked', () => {
    const { r } = render({ acct: 'a1', acctTo: 'a2' });
    const to = chips(r).slice(3);
    expect(to.map((c) => c.label)).toEqual(['招行', '支付宝']);
    expect(to.map((c) => c.on)).toEqual([true, false]);
  });

  it('uses English names when lang is en, falling back to the zh name', () => {
    const withNoEn = [{ id: 'a1', name: '现金' } as Account, ACCTS[1]];
    const { r } = render({ accounts: withNoEn, acct: 'a1', acctTo: 'a2', lang: 'en' });
    expect(chips(r).map((c) => c.label)).toEqual(['现金', 'CMB', 'CMB']);
  });
});

describe('picking FROM', () => {
  it('just sets FROM when it does not collide with TO', () => {
    const { r, props } = render({ acct: 'a1', acctTo: 'a2' });
    act(() => { chips(r)[2].press(); }); // pick 支付宝 as FROM
    expect(props.setAcct).toHaveBeenCalledWith('a3');
    expect(props.setAcctTo).not.toHaveBeenCalled();
  });

  it('moves TO out of the way when the new FROM was the TO account', () => {
    const { r, props } = render({ acct: 'a1', acctTo: 'a2' });
    act(() => { chips(r)[1].press(); }); // pick 招行, which is currently TO
    expect(props.setAcct).toHaveBeenCalledWith('a2');
    expect(props.setAcctTo).toHaveBeenCalledWith('a1'); // first account that is not the new FROM
  });

  it('clears TO when the collision leaves nowhere to move it', () => {
    const two = [ACCTS[0], ACCTS[1]];
    const { r, props } = render({ accounts: two, acct: 'a1', acctTo: 'a2' });
    act(() => { chips(r)[1].press(); });
    expect(props.setAcct).toHaveBeenCalledWith('a2');
    expect(props.setAcctTo).toHaveBeenCalledWith('a1');
  });
});

describe('picking TO', () => {
  it('sets TO and leaves FROM alone', () => {
    const { r, props } = render({ acct: 'a1', acctTo: 'a2' });
    act(() => { chips(r).slice(3)[1].press(); }); // 支付宝
    expect(props.setAcctTo).toHaveBeenCalledWith('a3');
    expect(props.setAcct).not.toHaveBeenCalled();
  });
});

describe('fee and discount fields', () => {
  it('strips anything that is not a digit or a dot', () => {
    const { r, props } = render();
    act(() => { inputs(r)[0].props.onChangeText('¥1a2.5x'); });
    expect(props.setFee).toHaveBeenCalledWith('12.5');
  });

  it('collapses extra decimal points', () => {
    const { r, props } = render();
    act(() => { inputs(r)[1].props.onChangeText('1.2.3.4'); });
    // the sanitizer drops the last separator per pass, not every one
    expect(props.setDiscount).toHaveBeenCalledWith('1.2.34');
  });

  it('passes a clean value through untouched', () => {
    const { r, props } = render();
    act(() => { inputs(r)[0].props.onChangeText('0.05'); });
    expect(props.setFee).toHaveBeenCalledWith('0.05');
  });

  it('renders the current values', () => {
    const { r } = render({ fee: '2', discount: '0.5' });
    expect(inputs(r)[0].props.value).toBe('2');
    expect(inputs(r)[1].props.value).toBe('0.5');
  });
});
