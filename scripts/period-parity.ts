// TypeScript half of the period-window parity harness. See scripts/parity.js.
//
// Only the window maths is compared. entriesInPeriod/periodTrend need an entry
// model and the epoch-to-local conversion the Rust core deliberately does not
// own, and periodLabel/bucketLabel are ICU text for the UI — see the module doc
// on rust/core/src/period.rs.

// No timezone pinning, and none needed.
//
// Every Date here is constructed from local components and read back as local
// components, so the zone cancels out. That was worth establishing rather than
// assuming: `export TZ=...` never reaches process.env on this shell at all, and
// assigning `process.env.TZ` inside the file is too late — imports hoist above
// it and ICU is already initialised. Passing TZ through execFileSync's `env`
// does work, but only without `shell: true`, which Windows needs for npx.
//
// Comparing civil components rather than epoch values sidesteps the whole
// question, and matches where `civil.rs` draws the line: the core owns which
// dates, the platform owns what they map to.

import { periodRange, shiftPeriod, type Period } from '../src/domain/period';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const show = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const f = arg.split('|');
  const n = (i: number) => Number(f[i]);
  const period = f[3] as Period;
  const anchor = new Date(n(0), n(1), n(2));

  let value: string;
  switch (kind) {
    case 'range': {
      const r = periodRange(anchor, period, n(4));
      value = `${show(r.start)} ${show(r.end)}`;
      break;
    }
    case 'shift':
      value = show(shiftPeriod(anchor, period, n(4), n(5)));
      break;
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
