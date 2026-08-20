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

describe('daylight saving', () => {
  // The cursor used to advance by 864e5 milliseconds rather than by a calendar
  // day. On a spring-forward day that lands at 01:00, and a subscription due
  // the following day lost the comparison against its own due date and was
  // pushed a whole month — one charge silently never recorded.
  //
  // These dates are Sydney's 2026 transitions, which is the zone this suite
  // runs in. In a zone without daylight saving the assertions hold trivially,
  // which is the point: the fix removed the dependency rather than papering
  // over one zone's version of it.
  const monthly = (day: number, lastCharged: string) => ({
    id: 's0', name: 'x', emoji: 'x', amt: 10, freq: 'monthly' as const,
    day, cat: 'fun', created: 0, lastCharged,
  });

  it('charges the day after a spring-forward transition', () => {
    // DST starts Sun 4 Oct 2026; cursor sits on the transition day
    const { charges } = computeDueCharges(monthly(5, '2026-9-4'), new Date(2026, 9, 20));
    expect(charges).toHaveLength(1);
    const d = new Date(charges[0]);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 5]);
  });

  it('charges the day after a fall-back transition', () => {
    // DST ends Sun 5 Apr 2026
    const { charges } = computeDueCharges(monthly(6, '2026-3-5'), new Date(2026, 3, 20));
    expect(charges).toHaveLength(1);
    const d = new Date(charges[0]);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 3, 6]);
  });
});
