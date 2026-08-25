// TypeScript half of the sync-merge parity harness.
//
// Rows are arbitrary JSON on both sides, because `mergeById` is generic over
// the row and the fields it does *not* know about are exactly what field-level
// merge has to carry across.
//
// Output goes through a stable serialisation rather than `JSON.stringify`, so
// the comparison does not depend on the key order either implementation
// happens to build — which is the same property the merge itself needs.

import { mergeById, mergeOne, liveRows, type SyncRow, type ConflictInfo } from '../src/sync/merge';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** Deep key-sorted JSON, matching `jsval::stable` on the other side. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stable(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

const n = (v: number) => String(v);

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const bar = arg.indexOf('|');
  const local = JSON.parse(bar < 0 ? arg : arg.slice(0, bar)) as SyncRow[];
  const remote = JSON.parse(bar < 0 ? '[]' : arg.slice(bar + 1)) as SyncRow[];

  let value: string;
  switch (kind) {
    case 'merge': {
      const conflicts: ConflictInfo[] = [];
      const r = mergeById(local, remote, (c) => conflicts.push(c));
      value =
        `merged=[${r.merged.map(stable).join(',')}]` +
        ` push=[${r.toPush.map(stable).join(',')}]` +
        ` conflicts=[${conflicts
          .map((c) => `${c.entryId}:${n(c.localUpdatedAt)}:${n(c.remoteUpdatedAt)}:${c.resolution}`)
          .join(',')}]`;
      break;
    }
    case 'mergeone': {
      // the realtime path: one incoming row, folded into the local set
      const conflicts: ConflictInfo[] = [];
      const r = mergeOne(local, remote[0], (c) => conflicts.push(c));
      value =
        `rows=[${r.rows.map(stable).join(',')}]` +
        ` push=${r.push ? stable(r.push) : 'none'}` +
        ` conflicts=[${conflicts
          .map((c) => `${c.entryId}:${n(c.localUpdatedAt)}:${n(c.remoteUpdatedAt)}:${c.resolution}`)
          .join(',')}]`;
      break;
    }
    case 'live':
      value = `[${liveRows(local).map(stable).join(',')}]`;
      break;
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
