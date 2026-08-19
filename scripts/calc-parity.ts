// TypeScript half of the calculator parity harness.
//
// Reads the shared corpus on stdin, writes `kind<TAB>arg<TAB>result` on stdout,
// in the same format as rust/core/examples/dump_calc.rs. `npm run parity:calc`
// runs both and diffs the two streams: any divergence between the shipping
// TypeScript and the Rust port shows up as a diff line rather than as a bug
// report from a user months into the migration.

import { applyKey, evalExpr, hasOperator } from '../src/domain/calc';

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
    case 'eval':
      value = String(evalExpr(arg));
      break;
    case 'hasop':
      value = String(hasOperator(arg));
      break;
    case 'keys': {
      let e = '';
      for (const k of arg.split(',')) e = applyKey(e, k);
      value = e;
      break;
    }
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
