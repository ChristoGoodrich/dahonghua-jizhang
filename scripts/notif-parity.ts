// TypeScript half of the notification-parser parity harness.
//
// This is the module where the two languages were most likely to disagree,
// because the whole of it is regular expressions over Chinese text. JavaScript
// without the `u` flag treats `\d` as ASCII `[0-9]`; a Unicode-aware engine also
// matches full-width ０-９, which turn up in real pushes. The Rust port spells
// every class out for that reason, and this corpus is what checks the spelling.

import {
  classifySource,
  fullText,
  parseMerchant,
  parseNotifAmount,
  parseNotifIO,
  parseNotification,
  parseBatch,
  toEntryDraft,
  type RawNotif,
} from '../src/domain/notifParse';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const EMPTY_CATS = { exp: [], inc: [], xfer: [] } as never;

/** `pkg|title|text|bigText|postedAt` — the corpus never generates a `|`. */
function parseRaw(arg: string, id: string): RawNotif {
  const f = arg.split('|');
  const opt = (i: number) => (f[i] ? f[i] : undefined);
  return {
    id,
    pkg: f[0] ?? '',
    title: opt(1),
    text: opt(2),
    bigText: opt(3),
    postedAt: Number(f[4] ?? 0),
  };
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
    case 'amount': {
      const v = parseNotifAmount(arg);
      value = v === null ? '_' : String(v);
      break;
    }
    case 'io':
      value = parseNotifIO(arg) ?? '_';
      break;
    case 'merchant':
      value = parseMerchant(arg) ?? '_';
      break;
    case 'text':
      value = fullText(parseRaw(arg, 'n0'));
      break;
    case 'source':
      value = classifySource(parseRaw(arg, 'n0')) ?? '_';
      break;
    case 'parse': {
      const c = parseNotification(parseRaw(arg, 'n0'));
      if (!c) {
        value = '_';
      } else {
        const d = toEntryDraft(c, EMPTY_CATS);
        value = [c.io, c.amt, c.merchant ?? '_', c.source, c.confident, d.cat, d.note].join('|');
      }
      break;
    }
    case 'batch': {
      const raws = arg.split(';;').map((a, i) => parseRaw(a, `n${i}`));
      value = parseBatch(raws)
        .map((c) => `${c.io}:${c.amt}:${c.merchant ?? '_'}`)
        .join(',');
      break;
    }
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${arg}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
