// TypeScript half of the filter parity harness.
//
// `parseDateRange` reads `new Date()` for every relative query, so the clock is
// pinned here and passed as an argument on the Rust side. Answers are compared
// as civil y/m/d h:mi:s: the TypeScript builds local-time epochs and the port
// cannot produce those without a timezone, which is the same seam every other
// date-bearing harness uses.

import { matchesFilter, parseDateRange, parseSearchQuery } from '../src/domain/filter';
import type { Entry, IO } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const civil = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
};

/** `_` is absent, `~` is the empty string. */
const cell = (s: string | undefined) =>
  s === undefined || s === '_' ? undefined : s === '~' ? '' : s;
const num = (s: string | undefined) => {
  const v = cell(s);
  return v === undefined ? undefined : Number(v);
};

/** Pin the clock to the corpus's `today`, then restore it. */
function withToday<T>(y: number, m: number, d: number, f: () => T): T {
  const RealDate = Date;
  const fixed = new RealDate(y, m, d, 12, 0, 0).getTime();
  // @ts-expect-error — swapping the global for the duration of one call
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      // @ts-expect-error — forwarding a variadic constructor
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  try {
    return f();
  } finally {
    globalThis.Date = RealDate;
  }
}

// Render a string so both halves of the harness spell it the same way.
//
// Rust's `{:?}` escapes a control character; `JSON.stringify` leaves anything
// above U+001F raw. The two agreed for as long as the corpus held only ordinary
// text, and stopped the moment it held a NEL — a difference in the *harness*,
// reported as a difference in the code.
function showText(s: string): string {
  let out = '"';
  for (const c of s) {
    const n = c.codePointAt(0)!;
    const odd =
      n < 0x20 ||
      (n >= 0x7f && n <= 0xa0) ||
      n === 0x1680 ||
      (n >= 0x2000 && n <= 0x200f) ||
      (n >= 0x2028 && n <= 0x202f) ||
      (n >= 0x205f && n <= 0x2060) ||
      n === 0x3000 ||
      n === 0xfeff;
    out += odd ? `<U+${n.toString(16).toUpperCase().padStart(4, '0')}>` : c;
  }
  return out + '"';
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const f = arg.split('^');

  let value: string;
  switch (kind) {
    case 'range': {
      // query^todayY^todayM^todayD
      const r = withToday(Number(f[1]), Number(f[2]), Number(f[3]), () => parseDateRange(f[0]));
      value = r == null ? 'null' : `${civil(r.from!)} .. ${civil(r.to!)}`;
      break;
    }
    case 'query': {
      // query^todayY^todayM^todayD
      const r = withToday(Number(f[1]), Number(f[2]), Number(f[3]), () => parseSearchQuery(f[0]));
      const range =
        r.filter.dateFrom == null ? 'null' : `${civil(r.filter.dateFrom)} .. ${civil(r.filter.dateTo!)}`;
      value = `text=${showText(r.text)} io=${r.filter.io ?? '_'} range=${range}`;
      break;
    }
    case 'match': {
      // entryIo^entryCat^entryAcct^entryTs ^ io^cat^acct^from^to
      const e = {
        id: 'e1',
        ts: Number(f[3]),
        io: cell(f[0]) as IO,
        cat: cell(f[1]) ?? '',
        amt: 10,
        ...(cell(f[2]) !== undefined ? { acct: cell(f[2]) } : {}),
      } as Entry;
      value = String(
        matchesFilter(e, {
          ...(cell(f[4]) !== undefined ? { io: cell(f[4]) as IO } : {}),
          ...(cell(f[5]) !== undefined ? { cat: cell(f[5]) } : {}),
          ...(cell(f[6]) !== undefined ? { acct: cell(f[6]) } : {}),
          ...(num(f[7]) !== undefined ? { dateFrom: num(f[7]) } : {}),
          ...(num(f[8]) !== undefined ? { dateTo: num(f[8]) } : {}),
        }),
      );
      break;
    }
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
