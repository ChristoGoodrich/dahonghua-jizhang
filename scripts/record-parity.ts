// TypeScript half of the record-form parity harness.
//
// A corpus line is `kind<TAB>json`. Each kind names one decision the record
// sheet makes; what is compared is the answer rendered as text, so a rejection
// shows as its kind rather than as a message — spelling one is Intl, which the
// port deliberately leaves to the caller.

import {
  validate, rateSource, initialFields, pickIo, shouldPatchTs, draft, afterSaveNext,
  type FormFields, type FormDefaults,
} from '../src/features/record/form';
import type { Currencies, Entry, IO } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** JavaScript's own number spelling, which `num::js_num` reproduces. */
const n = (v: number | undefined) => (v === undefined ? '_' : String(v));
const str = (v: string | undefined) => (v === undefined || v === '' ? '_' : v);
/** Absent and empty are different answers, and a renderer that maps both to
 *  `_` hides an injection that turns one into the other. */
const opt = (v: string | undefined) => (v === undefined ? '_' : `'${v}'`);
const optList = (v: string[] | undefined) => (v === undefined ? '_' : `[${v.join(',')}]`);

function showFields(f: FormFields): string {
  return [
    f.io, str(f.cat), str(f.amt), str(f.note), str(f.acct), str(f.acctTo),
    str(f.fee), str(f.discount), `[${f.tags.join(',')}]`, str(f.ledger),
    str(f.cur), str(f.subcat), f.ts === null ? '_' : String(f.ts),
  ].join('|');
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = JSON.parse(trimmed.slice(tab + 1)) as Record<string, unknown>;

  let value: string;
  switch (kind) {
    case 'validate': {
      const r = validate(arg.f as FormFields, arg.base as string, arg.rates as Record<string, number>);
      value = r === null ? 'ok' : r.kind === 'noRate' ? `noRate:${r.cur}` : r.kind;
      break;
    }
    case 'rateSource':
      value = String(rateSource(arg.fetched as number | null, arg.cached as number | undefined));
      break;
    case 'initial':
      value = showFields(
        initialFields(arg.source as Entry | undefined, arg.editing as boolean, arg.d as FormDefaults),
      );
      break;
    case 'pickIo': {
      const p = pickIo(
        arg.next as IO,
        arg.f as FormFields,
        arg.accounts as string[],
        arg.current as string,
        (io) => `first-${io}`,
      );
      // a partial — only the keys it names, in a fixed order
      value = ['io', 'subcat', 'cat', 'acct', 'acctTo']
        .map((k) => `${k}=${(p as Record<string, unknown>)[k] ?? '_'}`)
        .join(' ');
      break;
    }
    case 'patchTs':
      value = String(shouldPatchTs(arg.orig as number | undefined, arg.form as number | null));
      break;
    case 'draft': {
      const d = draft(
        arg.f as FormFields,
        arg.base as string,
        arg.currencies as Currencies,
        arg.rate as number | undefined,
      );
      if (!d) {
        value = 'none';
      } else if (d.kind === 'xfer') {
        value = `xfer ${d.from}>${d.to} ${n(d.amt)} fee=${n(d.fee)} disc=${n(d.discount)} note=${str(d.note)} ledger=${str(d.ledger)} ts=${d.ts ?? '_'}`;
      } else {
        value = `entry ${d.io} ${d.cat} ${n(d.amt)} note=${str(d.note)} acct=${str(d.acct)}`
          + ` tags=${optList(d.tags)} ledger=${opt(d.ledger)} subcat=${opt(d.subcat)}`
          + ` cur=${opt(d.cur)} orig=${n(d.origAmt)} rate=${n(d.rate)} ts=${d.ts ?? '_'}`;
      }
      break;
    }
    case 'afterNext':
      value = showFields(afterSaveNext(arg.f as FormFields));
      break;
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
