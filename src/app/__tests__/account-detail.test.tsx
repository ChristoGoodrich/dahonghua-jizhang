import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import AccountDetailScreen from '@/app/account-detail';
import { store$ } from '@/store/ledger';
import { I18N } from '@/i18n';
import type { Account, Entry } from '@/domain/types';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'cardX' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false }),
}));

const s = I18N.zh;
const card: Account = { id: 'cardX', name: '招商信用卡', nameEn: 'CMB', balance: 0, kind: 'credit', statementDay: 5, dueDay: 25 };

function textOf(json: any): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  return textOf(json.children);
}

beforeAll(() => {
  // fix "today" to 2026-01-20 so the statement math is deterministic
  jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 0, 20).getTime());
});
afterAll(() => { (Date.now as jest.Mock).mockRestore?.(); });

describe('AccountDetailScreen statement card', () => {
  it('shows billed-due, unbilled and the due date for a credit card', async () => {
    act(() => {
      store$.accounts.set([{ id: 'default', name: '现金', balance: 0 }, card]);
      store$.data.set([
        { id: 'a', ts: new Date(2026, 0, 2).getTime(), io: 'exp', cat: 'shop', amt: 1000, acct: 'cardX' } as Entry,
        { id: 'b', ts: new Date(2026, 0, 10).getTime(), io: 'exp', cat: 'food', amt: 200, acct: 'cardX' } as Entry,
      ]);
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<AccountDetailScreen />); });
    const txt = textOf(r.toJSON());

    expect(txt).toContain(s.stmtBilledDue); // 本期待还
    expect(txt).toContain('1,000'); // billed (before Jan 5 close)
    expect(txt).toContain(s.stmtUnbilled); // 未出账
    expect(txt).toContain('200'); // charged after the close
    expect(txt).toContain(s.stmtDueOn); // 还款日
    expect(txt).toContain('5'); // Jan 20 -> due Jan 25 = 5 days
  });

  it('shows no statement card for a plain cash account', async () => {
    act(() => {
      store$.accounts.set([{ id: 'cardX', name: '钱包', balance: 100, kind: 'cash' }]);
      store$.data.set([]);
    });
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<AccountDetailScreen />); });
    expect(textOf(r.toJSON())).not.toContain(s.stmtBilledDue);
  });
});
