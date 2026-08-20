// TypeScript half of the bill-dedup parity harness.
//
// Scenarios are field-separated rather than JSON, because the interesting part
// is a *sequence* of bills meeting a *sequence* of existing entries and the
// order in which slots get consumed. `^` separates fields and `~` separates
// records; neither appears in any generated string.
//
// Days cross the boundary as an offset from a fixed base, so both sides build
// the same calendar day without either needing the other's clock.

import { mapCategory, composeNote, toCandidates } from '../src/domain/billDedup';
import type { RawBill } from '../src/domain/billParse';
import type { Category, Entry, IO } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** Day `n` of the scenario calendar. */
const dayMs = (n: number) => new Date(2026, 0, 1 + n, 12, 0, 0).getTime();

const CUSTOM: Record<string, Record<IO, Category[]>> = {
  none: { exp: [], inc: [], xfer: [] },
  coffee: {
    exp: [{ k: 'c1', e: '☕', zh: '咖啡', en: 'Coffee', c: '#000', custom: true }],
    inc: [],
    xfer: [],
  },
  both: {
    exp: [{ k: 'c1', e: '☕', zh: '咖啡', en: 'Coffee', c: '#000', custom: true }],
    inc: [{ k: 'c2', e: '💰', zh: '工资', en: 'Salary', c: '#111', custom: true }],
    xfer: [],
  },
};

const opt = (s: string) => (s === '' ? undefined : s);

/** io^amt^day^srcCat^party^desc */
function parseBill(rec: string): RawBill {
  const f = rec.split('^');
  return {
    io: f[0] as 'exp' | 'inc',
    amt: Number(f[1]),
    ts: dayMs(Number(f[2])),
    srcCat: opt(f[3]),
    party: opt(f[4]),
    desc: opt(f[5]),
  };
}

/** io^amt^day^note^src^deleted */
function parseEntry(rec: string, i: number): Entry {
  const f = rec.split('^');
  return {
    id: `e${i}`,
    ts: dayMs(Number(f[2])),
    io: f[0] as IO,
    cat: 'other',
    amt: Number(f[1]),
    note: opt(f[3]),
    ...(f[4] ? { src: f[4] as 'notif' | 'bill' } : {}),
    ...(f[5] === '1' ? { deletedAt: 1 } : {}),
  } as Entry;
}

const civil = (ms: number) => {
  const d = new Date(ms);
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
};

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
    case 'cat':
      // io^srcCat^note^customSet
      value = JSON.stringify(
        mapCategory(f[0] as 'exp' | 'inc', opt(f[1]), opt(f[2]), CUSTOM[f[3]]),
      );
      break;
    case 'note': {
      // party^desc
      const b = { io: 'exp', amt: 1, ts: 0, party: opt(f[0]), desc: opt(f[1]) } as RawBill;
      value = JSON.stringify(composeNote(b));
      break;
    }
    case 'cand': {
      // customSet|bills~bills|entries~entries   (a section may be empty)
      const [set, billSec, entrySec] = arg.split('|');
      const bills = billSec ? billSec.split('~').map(parseBill) : [];
      const existing = entrySec ? entrySec.split('~').map(parseEntry) : [];
      value = JSON.stringify(
        toCandidates(bills, existing, CUSTOM[set]).map((c) => ({
          io: c.io,
          cat: c.cat,
          amt: c.amt,
          note: c.note,
          ...civil(c.ts),
          dup: c.dup,
        })),
      );
      break;
    }
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
