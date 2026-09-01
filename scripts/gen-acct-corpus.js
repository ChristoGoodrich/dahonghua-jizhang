#!/usr/bin/env node
// Generates the account-detail row corpus.
//
// One kind:
//
//   rows   entriesJson|accountId    which entries touched it, and by how much
//
// The generator is built around the four ways this goes wrong, because a
// random ledger of ordinary expenses would agree under any implementation:
//
//   1. A transfer belongs to TWO accounts with DIFFERENT deltas. The out side
//      pays the fee, the in side receives the discount, so the two rows do not
//      cancel. Every generated transfer gets a fee or a discount often enough
//      that a port collapsing them into one signed number diverges.
//   2. An entry with no `acct` belongs to `default` — and an EMPTY STRING is
//      also no account, because JavaScript's `!d.acct` is falsy for both.
//   3. That rule does not extend to transfers, which name both sides.
//   4. Ties in `ts` must keep their input order, because JavaScript's sort is
//      stable. So timestamps are drawn from a small set and collisions are
//      frequent on purpose.

const fs = require('node:fs');
const path = require('node:path');

let seed = 20260901;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

// A small pool, so two entries share a stamp often and the stable sort is
// actually exercised rather than merely claimed.
const STAMPS = [
  1700000000000, 1700000000000, 1700086400000, 1700086400000,
  1700172800000, 0, -1, 1e12,
];

// `default` is here because it is the account that absorbs entries with none.
// The empty string is an account id nothing should ever match.
const ACCTS = ['default', 'wallet', 'bank', 'credit', ''];

const AMOUNTS = [0, 0.1, 1, 12.5, 99.99, 1e15, -5];

// Deliberately not in ascending order: see `entry` below.
const LABELS = ['m', 'c', 'z', 'a', 'q', 'f', 'b', 'x'];

function entry(i) {
  const io = pick(['exp', 'inc', 'exp', 'xfer']);
  // The id must NOT sort the same way as the input order. An earlier version
  // numbered them e0, e1, e2… in sequence, which made a tie-break by id
  // indistinguishable from a stable sort — an injection that replaced the
  // stable sort with `.then(id)` passed all 5,400 cases. The corpus could not
  // see the difference it existed to see.
  const d = { id: `e${LABELS[i % LABELS.length]}`, ts: pick(STAMPS), io, cat: io === 'xfer' ? 'transfer' : 'food' };
  d.amt = pick(AMOUNTS);

  if (io === 'xfer') {
    // Both sides named, sometimes the same account on both — which the `else
    // if` resolves to the out side only, and a port using two `if`s would
    // list twice.
    if (chance(0.9)) d.acct = pick(ACCTS);
    if (chance(0.9)) d.acctTo = pick(ACCTS);
    if (chance(0.5)) d.fee = pick([0, 0.5, 2, 1e-9]);
    if (chance(0.5)) d.discount = pick([0, 1, 3, 1e-9]);
  } else {
    // A third of ordinary entries carry no account at all, and some carry the
    // empty string — the two shapes that fall through to `default`.
    const r = rnd();
    if (r < 0.55) d.acct = pick(ACCTS);
    else if (r < 0.7) d.acct = '';
    // else: no `acct` key at all
  }

  if (chance(0.12)) d.deletedAt = pick([1, 1700000000000]);
  return d;
}

const lines = [];
for (let c = 0; c < 900; c++) {
  const n = 1 + Math.floor(rnd() * 7);
  const entries = [];
  for (let i = 0; i < n; i++) entries.push(entry(i));
  // Every ledger asked about every account, including the empty id — which has
  // to match nothing rather than everything.
  for (const id of [...ACCTS, 'missing']) {
    lines.push(`rows\t${JSON.stringify(entries)}|${id}`);
  }
}

const out = path.join(__dirname, '..', 'rust', 'parity', 'acct-corpus.tsv');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`${lines.length} cases -> ${path.relative(process.cwd(), out)}`);
