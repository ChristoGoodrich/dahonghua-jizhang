// TypeScript half of the *stateful* parity harness.
//
// The pure modules compare a function's answer to one input. A ledger has no
// single answer — it has a history — so this replays a command sequence and
// compares the ledger it leaves behind.
//
// Three things have to be pinned for that comparison to mean anything:
//
//   * **The clock.** addEntry/updateEntry/removeEntry all call Date.now()
//     internally. Mocked here so a sequence is reproducible; the Rust side
//     takes `now` as an argument, which is the same pinning done properly.
//   * **Identity.** newId() mixes a clock, a counter and Math.random(). Rather
//     than trying to reproduce that in Rust — id generation is a platform
//     concern, not ledger logic — ids are normalised to insertion order (e0,
//     e1, …) on both sides, references included.
//   * **The store.** This runs under jest.parity.config.js because state.ts
//     imports AsyncStorage. It is not part of `npm test`.
//
// It is written as a jest test purely to get those module mocks; it asserts
// nothing itself. `npm run parity` diffs its output against the Rust dump.

import * as fs from 'fs';
import type { Entry } from '@/domain/types';

const IN = process.env.PARITY_IN as string;
const OUT = process.env.PARITY_OUT as string;

/** Fields compared, in a fixed order. Anything absent renders as `_`. */
const FIELDS = ['ts', 'io', 'cat', 'amt', 'refund', 'refundOf', 'deletedAt', 'updatedAt'] as const;

function render(entries: Entry[], idOf: Map<string, string>): string {
  return entries
    .map((e) => {
      const cells = FIELDS.map((f) => {
        const v = e[f as keyof Entry];
        if (v === undefined || v === null) return '_';
        if (f === 'refundOf') return idOf.get(String(v)) ?? String(v);
        return String(v);
      });
      const ft = Object.keys(e.fieldTs ?? {})
        .sort()
        .map((k) => `${k}=${e.fieldTs![k]}`)
        .join(';');
      return [idOf.get(e.id) ?? e.id, ...cells, ft || '_'].join(',');
    })
    .join(' | ');
}

/** One `verb:args` step. */
function runScenario(script: string): string {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const store = require('@/store/state') as typeof import('@/store/state');
  store.store$.data.set([]);

  let clock = 1_000_000;
  const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);

  /** insertion order → stable name, and back */
  const idOf = new Map<string, string>();
  const byName = new Map<string, string>();
  let seq = 0;
  const undos: ReturnType<typeof store.removeEntry>[] = [];

  const name = (realId: string) => {
    const n = `e${seq++}`;
    idOf.set(realId, n);
    byName.set(n, realId);
    return n;
  };

  for (const step of script.split('|')) {
    const [verb, rawArgs = ''] = step.split(':');
    const args = rawArgs ? rawArgs.split(',') : [];
    clock += 10; // every command lands at a distinct, predictable time

    switch (verb) {
      case 'add': {
        const [ts, io, cat, amt, refundOf, refund] = args;
        const e = store.addEntry({
          ts: Number(ts),
          io: io as Entry['io'],
          cat,
          amt: Number(amt),
          ...(refundOf ? { refundOf: byName.get(refundOf) ?? refundOf } : {}),
          ...(refund ? { refund: Number(refund) } : {}),
        });
        name(e.id);
        break;
      }
      case 'upd': {
        const [target, field, value] = args;
        const patch: Record<string, unknown> = {};
        patch[field] = field === 'amt' || field === 'refund' || field === 'ts' ? Number(value) : value;
        store.updateEntry(byName.get(target) ?? target, patch);
        break;
      }
      case 'rm':
        undos.push(store.removeEntry(byName.get(args[0]) ?? args[0]));
        break;
      case 'undo': {
        const u = undos[Number(args[0])];
        if (u) store.unremoveEntry(u);
        break;
      }
      default:
        throw new Error(`unknown verb ${verb}`);
    }
  }

  const out = render(store.store$.data.peek(), idOf);
  nowSpy.mockRestore();
  return out;
}

it('renders the ledger after each corpus scenario', () => {
  const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
  const out = lines.map((line) => {
    const script = line.replace(/\r$/, '');
    return `${script}\t${runScenario(script)}`;
  });
  fs.writeFileSync(OUT, out.join('\n') + '\n');
});
