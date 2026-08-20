// TypeScript half of the bill-import parity harness.
//
// Bill exports are the one corpus whose input is itself full of commas, quotes,
// tabs and newlines, so answers are rendered as JSON rather than with an ad-hoc
// separator that the input could forge. Corpus args carry their own tabs and
// newlines escaped, so one case stays one line.
//
// Dates cross the boundary as civil y/m/d h:mi:s. `parseDateMs` builds a local
// Date and hands back epoch milliseconds, which the Rust port cannot produce
// without a timezone — the same seam every other date-bearing harness uses.

import {
  autoMap,
  detectSource,
  findHeaderRow,
  parseAmount,
  parseBills,
  parseCSV,
  parseDateMs,
  parseIO,
} from '../src/domain/billParse';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const unescape = (s: string) =>
  s.replace(/\\(.)/g, (_, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c === '\\' ? '\\' : `\\${c}`,
  );

/** Civil components of a local-time epoch millisecond. */
function civil(ms: number) {
  const d = new Date(ms);
  return {
    y: d.getFullYear(),
    m: d.getMonth(),
    d: d.getDate(),
    h: d.getHours(),
    mi: d.getMinutes(),
    s: d.getSeconds(),
  };
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const esc = trimmed.slice(tab + 1);
  const arg = unescape(esc);

  let value: string;
  switch (kind) {
    case 'csv':
      value = JSON.stringify(parseCSV(arg));
      break;
    case 'header': {
      const rows = parseCSV(arg);
      const h = findHeaderRow(rows);
      value = JSON.stringify({
        headerRow: h,
        source: detectSource(rows),
        columns: h >= 0 ? autoMap(rows[h]) : null,
      });
      break;
    }
    case 'date': {
      const ms = parseDateMs(arg);
      value = ms == null ? 'null' : JSON.stringify(civil(ms));
      break;
    }
    case 'amt': {
      const n = parseAmount(arg);
      value = n == null ? 'null' : String(n);
      break;
    }
    case 'io': {
      const io = parseIO(arg);
      value = io == null ? 'null' : JSON.stringify(io);
      break;
    }
    case 'bills': {
      const r = parseBills(arg);
      value = JSON.stringify({
        source: r.source,
        headerRow: r.headerRow,
        columns: r.columns,
        dataRows: r.dataRows,
        skipped: r.skipped,
        bills: r.bills.map((b) => ({
          ...civil(b.ts),
          io: b.io,
          amt: b.amt,
          // JSON.stringify drops undefined keys; the Rust side writes null, so
          // spell the absent ones out to keep the two shapes comparable
          srcCat: b.srcCat ?? null,
          party: b.party ?? null,
          desc: b.desc ?? null,
          method: b.method ?? null,
          status: b.status ?? null,
        })),
        errors: r.errors,
      });
      break;
    }
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
  out.push(`${kind}\t${esc}\t${value}`);
}

process.stdout.write(out.join('\n') + '\n');
