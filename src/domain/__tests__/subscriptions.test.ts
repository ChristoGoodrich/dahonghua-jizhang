import { nextDueDate, computeDueCharges } from '../subscriptions';
import type { Sub } from '../types';

const monthly: Sub = { id: 's1', name: 'Netflix', emoji: '🔁', amt: 30, freq: 'monthly', day: 15, cat: 'fun', created: new Date(2026, 0, 1).getTime() };

describe('nextDueDate', () => {
  it('monthly: same month if day not yet passed', () => {
    const d = nextDueDate(monthly, new Date(2026, 2, 10)); // Mar 10, day 15
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });
  it('monthly: rolls to next month once the day has passed', () => {
    const d = nextDueDate(monthly, new Date(2026, 2, 20)); // Mar 20
    expect(d.getMonth()).toBe(3); // April 15
  });
  it('yearly: honors the charge month (not hardcoded January)', () => {
    const yearly: Sub = { ...monthly, freq: 'yearly', month: 12, day: 1 };
    const d = nextDueDate(yearly, new Date(2026, 0, 1));
    expect(d.getMonth()).toBe(11); // December
  });
});

describe('computeDueCharges', () => {
  it('catches up missed monthly charges since lastCharged', () => {
    // last charged Jan 15 2026 (month 0), today Apr 20 -> due Feb15, Mar15, Apr15
    const sub: Sub = { ...monthly, lastCharged: '2026-0-15' };
    const { charges, lastCharged } = computeDueCharges(sub, new Date(2026, 3, 20));
    expect(charges).toHaveLength(3);
    const months = charges.map((ts) => new Date(ts).getMonth());
    expect(months).toEqual([1, 2, 3]);
    expect(lastCharged).toBe('2026-3-15');
  });

  it('charges nothing when not yet due', () => {
    const sub: Sub = { ...monthly, lastCharged: '2026-3-15' };
    const { charges } = computeDueCharges(sub, new Date(2026, 3, 20));
    expect(charges).toHaveLength(0);
  });

  it('first run since creation charges the due date(s) up to today', () => {
    const sub: Sub = { ...monthly, created: new Date(2026, 0, 1).getTime(), lastCharged: undefined };
    const { charges } = computeDueCharges(sub, new Date(2026, 0, 31)); // Jan: due Jan 15
    expect(charges).toHaveLength(1);
    expect(new Date(charges[0]).getDate()).toBe(15);
  });
});
