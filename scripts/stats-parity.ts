// TypeScript half of the stats parity harness.
//
// `byWeekday` and `byTimeOfDay` read `new Date(ts).getDay()` and `.getHours()`,
// which need a timezone the core does not own. The corpus therefore supplies a
// local weekday and hour directly, and this side builds a timestamp that lands
// on them rather than the other way round — so the runner's zone cancels out
// the same way it does in every other date-bearing harness.

import {
  byCategory,
  comparison,
  sixMonthTrend,
  statTotals,
  byTimeOfDay,
  byWeekday,
  donutSlices,
  overview,
  timeBucketOf,
  topEntries,
  type CatTotal,
} from '../src/domain/stats';
import type { Entry, IO } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const cell = (s: string | undefined) => (s === undefined || s === '_' ? undefined : s);

/** A local timestamp with the requested weekday and hour.
 *
 *  2026-08-23 is a Sunday, so adding `dow` lands on the matching weekday, and
 *  building from components keeps it local. */
function tsFor(dow: number, hour: number): number {
  return new Date(2026, 7, 23 + dow, hour, 30, 0).getTime();
}

/** io~cat~amt[~dow~hour]  — or io~cat~amt~y~m~d when a real date is meant.
 *
 *  The aggregation kinds only care which weekday or hour an entry lands on, so
 *  they name those directly. The cycle-shaped kinds compare against calendar
 *  boundaries, so they name a date. Six fields means the second. */
function parseEntry(rec: string, i: number): Entry {
  const f = rec.split('~');
  const ts =
    f.length >= 6
      ? new Date(Number(f[3]), Number(f[4]), Number(f[5]), 12, 0, 0).getTime()
      : tsFor(f[3] === undefined ? 0 : Number(f[3]), f[4] === undefined ? 12 : Number(f[4]));
  return {
    id: `e${i}`,
    ts,
    io: cell(f[0]) as IO,
    cat: f[1] ?? '',
    amt: Number(f[2]),
  } as Entry;
}

const n = (v: number) => String(v);

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const [body, extra] = arg.split('|');
  const entries = body ? body.split('^').map(parseEntry) : [];

  let value: string;
  switch (kind) {
    case 'cat':
      value = byCategory(entries, (cell(extra) ?? 'exp') as IO)
        .map((c) => `${c.cat}:${n(c.amt)}`)
        .join(',');
      break;
    case 'top': {
      const [io, count] = (extra ?? 'exp,5').split(',');
      // `_` means "not supplied", so the default parameter applies — the same
      // convention every other kind here uses
      value = topEntries(entries, (cell(io) ?? 'exp') as IO, Number(count))
        .map((e) => `${e.id}:${n(e.amt)}`)
        .join(',');
      break;
    }
    case 'over': {
      const o = overview(entries);
      value = `exp=${n(o.exp)} inc=${n(o.inc)} bal=${n(o.balance)} n=${o.count}`;
      break;
    }
    case 'donut': {
      // cat:amt^cat:amt|total
      const cats: CatTotal[] = body
        ? body.split('^').map((s) => {
            const [cat, amt] = s.split(':');
            return { cat, amt: Number(amt) };
          })
        : [];
      value = donutSlices(cats, Number(extra))
        .map((s) => `${s.cat}:${n(s.frac)}:${n(s.start)}`)
        .join(',');
      break;
    }
    case 'dow':
      value = byWeekday(entries, (cell(extra) ?? 'exp') as IO)
        .map((b) => `${b.dow}:${n(b.amt)}:${b.count}`)
        .join(',');
      break;
    case 'tod':
      value = byTimeOfDay(entries, (cell(extra) ?? 'exp') as IO)
        .map((b) => `${b.key}:${n(b.amt)}:${b.count}`)
        .join(',');
      break;
    case 'bucket':
      value = timeBucketOf(Number(arg));
      break;
    // The cycle-shaped three. `anchor` and `today` cross as civil y/m/d and are
    // rebuilt into local Dates here; entries carry a civil day of their own.
    case 'totals': {
      const [ay, am, ad, cs, ty, tm, td] = extra.split(',').map(Number);
      const r = statTotals(entries, new Date(ay, am, ad), cs, new Date(ty, tm, td, 12).getTime());
      value = `today=${n(r.todayExp)} avg=${n(r.avg)} top=${n(r.top)} n=${r.count}`;
      break;
    }
    case 'trend': {
      const [ay, am, ad, cs] = extra.split(',').map(Number);
      value = sixMonthTrend(entries, new Date(ay, am, ad), cs)
        .map((t) => `${t.label.getFullYear()}-${t.label.getMonth()}-${t.label.getDate()}:${n(t.total)}`)
        .join(',');
      break;
    }
    case 'cmp': {
      const [ay, am, ad, cs, ty, tm, td] = extra.split(',').map(Number);
      const r = comparison(entries, new Date(ay, am, ad), cs, new Date(ty, tm, td, 12).getTime());
      value =
        `this=[${r.thisCum.map(n).join(',')}] last=[${r.lastCum.map(n).join(',')}] ` +
        `tt=${n(r.thisTotal)} lt=${n(r.lastTotal)} days=${r.elapsedDays}`;
      break;
    }
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
