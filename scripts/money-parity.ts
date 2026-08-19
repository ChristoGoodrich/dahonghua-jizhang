// TypeScript half of the money parity harness. See scripts/parity.js.
//
// The rate table here must stay identical to the one in
// rust/core/examples/dump_money.rs, including the deliberate ZERO entry — a
// zero rate is falsy in JavaScript, so `r ? amt * r : amt` leaves the amount
// alone, and a Rust port that checked only for presence would silently
// multiply by zero and wipe the value out.

import { curSymbol, fmt, fmtNum, fmtShort, setDisplaySymbol, toBase } from '../src/domain/money';
import type { Currencies } from '../src/domain/types';

const currencies: Currencies = {
  base: 'CNY',
  rates: { USD: 7.2, JPY: 0.048, EUR: 7.85, ZERO: 0 },
};

const raw = require('fs').readFileSync(0, 'utf8') as string;

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);

  let value: string;
  switch (kind) {
    case 'fmtnum':
      value = fmtNum(Number(arg));
      break;
    case 'fmt': {
      const [n, sym] = arg.split('|');
      // the Rust port takes the symbol as an argument rather than carrying
      // module-level display state, so drive the TS through the same door
      setDisplaySymbol(sym);
      value = fmt(Number(n));
      setDisplaySymbol(null);
      break;
    }
    case 'fmtshort': {
      const [n, sym] = arg.split('|');
      setDisplaySymbol(sym);
      value = fmtShort(Number(n));
      setDisplaySymbol(null);
      break;
    }
    case 'cursym':
      value = curSymbol(arg);
      break;
    case 'tobase': {
      const [amt, code, ov] = arg.split('|');
      value = String(
        toBase(Number(amt), code || undefined, currencies, ov === '' || ov === undefined ? undefined : Number(ov)),
      );
      break;
    }
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
