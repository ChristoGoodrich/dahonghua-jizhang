// TypeScript half of the entry-list grouping parity harness.
//
// A corpus line is `kind<TAB>entriesJson|now`, where each entry carries its own
// `ts`. The Rust half is handed each entry's local calendar day rather than
// computing one, because the timezone is the platform's — so the generator
// writes the day alongside, computed in this same runtime.

import { groupByDay, flattenGroups } from '../src/features/list/grouping';
import type { Entry } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** `Sat Aug 26 2026` → `2026-8-26`, matching how the Rust side prints a Civil. */
function ymd(key: string): string {
  const d = new Date(key);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** JavaScript's own number spelling, which `num::js_num` reproduces. */
const n = (v: number) => String(v);

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const bar = arg.lastIndexOf('|');
  const entries = JSON.parse(arg.slice(0, bar)) as Entry[];
  const rest = arg.slice(bar + 1);

  let value: string;
  switch (kind) {
    case 'group': {
      // `nowMs,todayYmd` — this half wants the instant, the other the day
      const groups = groupByDay(entries, Number(rest.split(',')[0]));
      value = groups
        .map((g) => `${ymd(g.key)}/${g.label}/${n(g.dayExp)}/${n(g.dayInc)}/[${g.items.map((e) => e.id).join(',')}]`)
        .join(' ');
      break;
    }
    case 'flat': {
      // `nowMs,todayYmd,columns`
      const [nowRaw, , colsRaw] = rest.split(',');
      const groups = groupByDay(entries, Number(nowRaw));
      value = flattenGroups(groups, Number(colsRaw))
        .map((it) => {
          if (it.type === 'header') {
            return `H:${ymd(it.key)}/${it.label}/${n(it.dayExp)}/${n(it.dayInc)}`;
          }
          if (it.type === 'entry') return `E:${it.entry.id}@${ymd(it.groupKey)}`;
          return `R:[${it.entries.map((e) => e.id).join(',')}]@${ymd(it.groupKey)}`;
        })
        .join(' ');
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
