// TypeScript half of the subscription-engine parity harness.
//
// The TypeScript works in local-time Date objects and the Rust port works in
// civil dates, so the two are compared through y/m/d on both sides — the same
// shape as the cycle and period harnesses.
//
// This is also the module where the boundary was not just tidier but load-
// bearing: the cursor used to advance by 864e5 milliseconds instead of a
// calendar day, which on a spring-forward day skipped a charge outright. The
// TypeScript was fixed before the port, because there is nothing to compare
// against otherwise.

import { computeDueCharges, nextDueDate } from '../src/domain/subscriptions';
import type { Sub } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const show = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** freq|day|month|lastCharged|periods|charged */
function parseSub(f: string[], created: number): Sub {
  return {
    id: 's0',
    name: 'x',
    emoji: 'x',
    amt: 10,
    freq: f[0] === 'yearly' ? 'yearly' : 'monthly',
    day: Number(f[1]),
    ...(f[2] ? { month: Number(f[2]) } : {}),
    cat: 'fun',
    created,
    lastCharged: f[3] ?? '',
    ...(f[4] ? { periods: Number(f[4]) } : {}),
    ...(f[5] ? { charged: Number(f[5]) } : {}),
  };
}

/** The instalment cap, lifted out of runSubscriptions so it can be compared. */
function allowed(sub: Sub, charges: number): number {
  if (sub.periods && sub.periods > 0) {
    return Math.min(charges, Math.max(0, sub.periods - (sub.charged ?? 0)));
  }
  return charges;
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const f = arg.split('|');
  const n = (i: number) => Number(f[i]);

  let value: string;
  switch (kind) {
    case 'next': {
      const sub = parseSub(f, 0);
      value = show(nextDueDate(sub, new Date(n(6), n(7), n(8))));
      break;
    }
    case 'due': {
      const created = new Date(n(9), n(10), n(11)).getTime();
      const sub = parseSub(f, created);
      const r = computeDueCharges(sub, new Date(n(6), n(7), n(8)));
      value = [
        r.charges.map((ms) => show(new Date(ms))).join(','),
        r.lastCharged,
        allowed(sub, r.charges.length),
      ].join('|');
      break;
    }
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
