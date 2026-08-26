// TypeScript half of the sync-decisions parity harness.
//
// Three files' worth of judgement with the I/O removed: the push watermark and
// its backoff, per-section config adoption, and the conflict log's cap. Each
// kind names one decision and renders the answer as text.

import {
  dirtySince, advanceWatermark, nextDelay, createPushScheduler,
} from '../src/sync/pushScheduler';
import {
  adoptSections, localNewerThan, sectionPresent, CONFIG_SECTIONS, type SectionKey, type Stamps,
} from '../src/sync/configMerge';

import { capLog, type ConflictEntry } from '../src/sync/conflictLog';

const raw = require('fs').readFileSync(0, 'utf8') as string;

interface Row {
  id: string;
  updatedAt?: number;
}
const stampOf = (e: Row) => e.updatedAt ?? 0;

/** Key-sorted, so the comparison does not depend on either side's key order. */
function showStamps(s: Stamps): string {
  return Object.keys(s)
    .sort()
    .map((k) => `${k}=${s[k]}`)
    .join(',');
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const parts = trimmed.slice(tab + 1).split('|');

  let value: string;
  switch (kind) {
    case 'dirty': {
      const rows = JSON.parse(parts[0]) as Row[];
      const wm = Number(parts[1]);
      value = dirtySince(rows, stampOf, wm).map((r) => r.id).join(',');
      break;
    }
    case 'bump': {
      // driven through the real scheduler rather than a copy of Math.max —
      // `bumpWatermark` is a method on the closure and this is the only way to
      // ask it anything
      const s = createPushScheduler<Row>({
        getDirty: () => [],
        stamp: stampOf,
        pushItems: async () => {},
        pushConfig: async () => {},
        onError: () => {},
        onSuccess: () => {},
      });
      for (const n of parts[0].split(',')) s.bumpWatermark(Number(n));
      value = String(s.watermark);
      break;
    }
    case 'advance': {
      const rows = JSON.parse(parts[0]) as Row[];
      const wm = Number(parts[1]);
      // the sequence the scheduler runs: take what is dirty, then advance past it
      const dirty = dirtySince(rows, stampOf, wm);
      value = String(advanceWatermark(wm, dirty, stampOf));
      break;
    }
    case 'delay': {
      // a whole retry sequence, so the cap and the reset are both visible
      const [base, max] = [Number(parts[0]), Number(parts[1])];
      const n = Number(parts[2]);
      let d = 0;
      const seen: number[] = [];
      for (let i = 0; i < n; i++) {
        d = nextDelay(d, base, max);
        seen.push(d);
      }
      value = seen.join(',');
      break;
    }
    case 'adopt': {
      const local = JSON.parse(parts[0]) as Stamps;
      const remote = parts[1] === 'none' ? undefined : (JSON.parse(parts[1]) as Stamps);
      const blob = JSON.parse(parts[2]) as Record<string, unknown>;
      const { take, stamps } = adoptSections(local, remote, (k) => sectionPresent(blob, k));
      value = `take=[${take.join(',')}] stamps=[${showStamps(stamps)}]`;
      break;
    }
    case 'newer': {
      const local = JSON.parse(parts[0]) as Stamps;
      const remote = parts[1] === 'none' ? undefined : (JSON.parse(parts[1]) as Stamps);
      value = String(localNewerThan(local, remote));
      break;
    }
    case 'present': {
      const blob = JSON.parse(parts[0]) as Record<string, unknown>;
      value = CONFIG_SECTIONS.filter((k) => sectionPresent(blob, k)).join(',');
      break;
    }
    case 'log': {
      const ids = JSON.parse(parts[0]) as string[];
      let log: ConflictEntry[] = [];
      for (const entryId of ids) {
        log = capLog(log, { entryId, localUpdatedAt: 0, remoteUpdatedAt: 0, resolution: 'remote', timestamp: 0 });
      }
      const at = log.map((c) => c.entryId);
      value = `${log.length}:${at.slice(0, 3).join(',')}..${at.slice(-2).join(',')}`;
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));

// `SectionKey` is imported for the cast above and for the reader's benefit.
export type { SectionKey };
