// TypeScript half of the recap / streak / weekly parity harness.

import { monthRecap } from '../src/domain/recap';
import { streakDays } from '../src/domain/streak';
import { getWeekRange, calculateWeeklyBudget, getWeeklyStatus } from '../src/domain/weekly';
import type { Entry, IO } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const cell = (f: string[], i: number): string | undefined => {
  const v = f[i];
  return v === undefined || v === '_' || v === '' ? undefined : v;
};
function num(f: string[], i: number): number | undefined {
  const v = cell(f, i);
  if (v === undefined) return undefined;
  return v === 'nan' ? NaN : Number(v);
}

/** io~cat~amt~y~m~d~del — placed at noon, so the local day is never in doubt */
function parseEntry(rec: string, i: number): Entry {
  const f = rec.split('~');
  return {
    id: `e${i}`,
    ts: new Date(num(f, 3) ?? 2026, num(f, 4) ?? 5, num(f, 5) ?? 10, 12, 0, 0).getTime(),
    io: cell(f, 0) as IO,
    cat: f[1] ?? '',
    amt: num(f, 2) ?? 0,
    deletedAt: num(f, 6),
  } as Entry;
}

const n = (v: number) => String(v);
const dayStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const [body, extra = ''] = arg.split('|');
  const entries = body ? body.split('^').map(parseEntry) : [];

  const f = extra.split(',');
  const at = (from: number) =>
    new Date(num(f, from) ?? 2026, num(f, from + 1) ?? 5, num(f, from + 2) ?? 10, 12, 0, 0);

  let value: string;
  switch (kind) {
    case 'recap': {
      const r = monthRecap(entries);
      value =
        `exp=${n(r.exp)} inc=${n(r.inc)} net=${n(r.net)} n=${r.count}` +
        ` active=${r.activeDays} top=${r.topCatKey ?? '-'} topAmt=${n(r.topCatAmt)}`;
      break;
    }
    case 'streak':
      value = n(streakDays(entries.map((e) => e.ts), at(0)));
      break;
    case 'weekrange': {
      const r = getWeekRange(at(0));
      value = `${dayStr(r.start)}..${dayStr(r.end)}`;
      break;
    }
    case 'dailyeq':
      value = n(calculateWeeklyBudget(num(f, 0) ?? 0));
      break;
    case 'weekly': {
      const s = getWeeklyStatus(entries, num(f, 0) ?? 0, at(1).getTime());
      value =
        `spent=${n(s.spent)} left=${n(s.remaining)} over=${s.over}` +
        ` days=${n(s.daysLeft)} daily=${n(s.dailyBudget)}`;
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
