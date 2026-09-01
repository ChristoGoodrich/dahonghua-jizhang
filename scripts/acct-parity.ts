// TypeScript half of the account-detail row parity harness.
//
// A corpus line is `rows<TAB>entriesJson|accountId`. The output names each row
// by its entry id and the delta it applied to that account, in order — so a
// port that gets the right set in the wrong order still fails, which is the
// point of the shared timestamps in the corpus.

import { acctRows } from '../src/features/assets/acctRows';
import type { Entry } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

// `String(n)` rather than toFixed: the corpus contains 1e15 and 1e-9, and the
// comparison has to be against JavaScript's own rendering of a number, which
// is what the Rust side's `js_num` reproduces.
const n = (v: number) => String(v);

const out: string[] = [];
for (const line of raw.split('\n')) {
  const l = line.replace(/\r$/, '');
  if (!l) continue;
  const tab = l.indexOf('\t');
  const kind = l.slice(0, tab);
  const arg = l.slice(tab + 1);
  const bar = arg.lastIndexOf('|');
  const entries = JSON.parse(arg.slice(0, bar)) as Entry[];
  const id = arg.slice(bar + 1);

  if (kind !== 'rows') throw new Error(`unknown kind ${kind}`);
  const value = acctRows(id, entries)
    .map((r) => `${r.d.id}:${n(r.delta)}`)
    .join(' ');
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
