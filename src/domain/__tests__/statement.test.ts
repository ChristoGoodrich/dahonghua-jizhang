import { lastStatementClose, dueDateFor, statementSummary, dueSoon } from '../statement';
import type { Account, Entry } from '../types';

const card: Account = { id: 'c1', name: '信用卡', balance: 0, kind: 'credit', statementDay: 5, dueDay: 25 };
const accounts: Account[] = [{ id: 'default', name: '现金', balance: 0 }, card];

// helper: an expense on the card (grows debt) / a payment to the card (income)
const spend = (day: number, amt: number): Entry => ({ id: 's' + day + amt, ts: new Date(2026, 0, day).getTime(), io: 'exp', cat: 'shop', amt, acct: 'c1' });
const pay = (day: number, amt: number): Entry => ({ id: 'p' + day + amt, ts: new Date(2026, 0, day).getTime(), io: 'inc', cat: 'other', amt, acct: 'c1' });

describe('lastStatementClose', () => {
  it('closes this month when ref is on/after the statement day', () => {
    const close = new Date(lastStatementClose(5, new Date(2026, 0, 20).getTime()));
    expect(close.getMonth()).toBe(0); // Jan
    expect(close.getDate()).toBe(5);
  });
  it('closes last month when ref is before the statement day', () => {
    const close = new Date(lastStatementClose(5, new Date(2026, 0, 3).getTime()));
    expect(close.getMonth()).toBe(11); // Dec
    expect(close.getFullYear()).toBe(2025);
  });
});

describe('dueDateFor', () => {
  it('same month when due day is after the statement day', () => {
    const close = lastStatementClose(5, new Date(2026, 0, 20).getTime());
    const due = new Date(dueDateFor(close, 5, 25));
    expect(due.getMonth()).toBe(0);
    expect(due.getDate()).toBe(25);
  });
  it('next month when due day is on/before the statement day', () => {
    const close = lastStatementClose(25, new Date(2026, 0, 26).getTime());
    const due = new Date(dueDateFor(close, 25, 10));
    expect(due.getMonth()).toBe(1); // Feb
    expect(due.getDate()).toBe(10);
  });
});

describe('statementSummary', () => {
  const ref = new Date(2026, 0, 20).getTime();

  it('splits billed vs unbilled across the statement close', () => {
    // spend 1000 on Jan 2 (billed, before Jan 5 close), 300 on Jan 10 (unbilled)
    const entries = [spend(2, 1000), spend(10, 300)];
    const sm = statementSummary(card, accounts, entries, ref)!;
    expect(sm.billedDue).toBe(1000);
    expect(sm.unbilled).toBe(300);
    expect(sm.currentDebt).toBe(1300);
    expect(sm.overpay).toBe(0);
    const due = new Date(sm.dueDate!);
    expect(due.getDate()).toBe(25);
    expect(sm.daysToDue).toBe(5); // Jan 20 -> Jan 25
  });

  it('reports overpayment when the card was paid beyond its balance', () => {
    // spend 1000 Jan 2, pay 1200 Jan 3 -> balance at close +200
    const sm = statementSummary(card, accounts, [spend(2, 1000), pay(3, 1200)], ref)!;
    expect(sm.billedDue).toBe(0);
    expect(sm.overpay).toBe(200);
  });

  it('counts a post-close payment against unbilled, not billed', () => {
    // billed 1000 (Jan 2); pay 400 after close (Jan 10) -> billed still 1000, no new charges
    const sm = statementSummary(card, accounts, [spend(2, 1000), pay(10, 400)], ref)!;
    expect(sm.billedDue).toBe(1000);
    expect(sm.unbilled).toBe(0); // a payment isn't a new charge
    expect(sm.currentDebt).toBe(600);
  });

  it('returns null for a non-credit or unconfigured account', () => {
    expect(statementSummary({ id: 'x', name: 'x', balance: 0, kind: 'cash' }, accounts, [], ref)).toBeNull();
    expect(statementSummary({ id: 'y', name: 'y', balance: 0, kind: 'credit' }, accounts, [], ref)).toBeNull();
  });
});

describe('dueSoon', () => {
  it('lists cards with a balance due within the window, soonest first', () => {
    const ref = new Date(2026, 0, 20).getTime(); // due Jan 25 -> 5 days
    const reminders = dueSoon(accounts, [spend(2, 1000)], ref, 7);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].account.id).toBe('c1');
    expect(reminders[0].daysToDue).toBe(5);
    expect(reminders[0].billedDue).toBe(1000);
  });
  it('excludes a fully-paid card', () => {
    const ref = new Date(2026, 0, 20).getTime();
    // paid off before close -> no billed balance
    expect(dueSoon(accounts, [spend(2, 1000), pay(3, 1000)], ref, 7)).toHaveLength(0);
  });
});
