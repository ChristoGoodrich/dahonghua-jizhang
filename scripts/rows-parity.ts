// TypeScript half of the sync-row parity harness.
//
// Two directions and two shapes. An entry omits what it does not have; a row
// nulls it. That asymmetry is the whole of `rows.ts`, so the harness renders
// both sides through the same stable serialisation and lets the nulls and the
// omissions speak for themselves.
//
// A corpus line is `kind<TAB>json`, where kind is `torow` (an entry, plus a
// trailing `|userId`) or `toentry` (a server row).

import { entryToRow, rowToEntry, type DbEntry } from '../src/sync/rows';
import type { Entry } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** Deep key-sorted JSON, matching `jsval::stable` on the other side. */
function stable(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stable(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);

  let value: string;
  switch (kind) {
    case 'torow': {
      const bar = arg.lastIndexOf('|');
      const e = JSON.parse(arg.slice(0, bar)) as Entry;
      const userId = arg.slice(bar + 1);
      value = stable(entryToRow(e, userId));
      break;
    }
    case 'toentry':
      value = stable(rowToEntry(JSON.parse(arg) as DbEntry));
      break;
    case 'roundtrip': {
      // entry -> row -> entry, which is not the identity: the row's updated_at
      // cannot be null, so an entry without one comes back carrying `ts`
      const bar = arg.lastIndexOf('|');
      const e = JSON.parse(arg.slice(0, bar)) as Entry;
      value = stable(rowToEntry(entryToRow(e, arg.slice(bar + 1))));
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
