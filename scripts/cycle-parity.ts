// TypeScript half of the calendar/cycle parity harness. See scripts/parity.js.
//
// The TypeScript does this maths on local-time `Date` objects, so the harness
// runs it under a pinned TZ (see scripts/parity.js). The zone chosen has no
// daylight saving, which matters: `cycleDays` divides a millisecond difference
// by 86,400,000 and rounds, so in a DST zone a cycle containing a transition is
// 23 or 25 hours short of a whole number of days and only survives because of
// that rounding. The Rust port counts civil days directly and has no such
// wobble — a difference in mechanism that produces identical answers, which is
// exactly what a corpus is for.

import { monthGrid } from '../src/domain/dates';
import { cycleDays, cycleRange, inCycle, shiftCycle } from '../src/domain/cycle';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** `y-m-d` with a 0-based month, matching dump_cycle.rs. */
const show = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const v = arg.split('|').map(Number);

  let value: string;
  switch (kind) {
    case 'dim':
      value = String(new Date(v[0], v[1] + 1, 0).getDate());
      break;
    case 'grid':
      value = monthGrid(v[0], v[1]).map((c) => (c === null ? '_' : String(c))).join(',');
      break;
    case 'mk':
      value = show(new Date(v[0], v[1], v[2]));
      break;
    case 'range': {
      const r = cycleRange(new Date(v[0], v[1], v[2]), v[3]);
      value = `${show(r.start)} ${show(r.end)}`;
      break;
    }
    case 'incycle': {
      const ts = new Date(v[0], v[1], v[2]).getTime();
      value = String(inCycle(ts, new Date(v[3], v[4], v[5]), v[6]));
      break;
    }
    case 'shift':
      value = show(shiftCycle(new Date(v[0], v[1], v[2]), v[3], v[4]));
      break;
    case 'days':
      value = String(cycleDays(new Date(v[0], v[1], v[2]), v[3]));
      break;
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
