#!/usr/bin/env node
// Generates the sync-engine parity corpus.
//
// Each line is a script both halves of the harness replay — the shipping
// engine against a faked Supabase client, and the Rust state machine against an
// equivalent fake. See `scripts/engine-parity.harness.ts` for the command
// vocabulary; the short version:
//
//   L id,ts  seed a local row      R id,ts  seed a server row
//   P sects  seed the server blob  FP/FC/FU fail pull/config-read/push
//   FQ       fail the config push only (the "rows landed, config did not" branch)
//   I        sign in               O        sign out
//   E sect   edit one section      N id,ts  write one entry locally
//   T id,ts  a realtime row        G sects  a realtime config blob
//   LF/TF    a row carrying per-field stamps — the merge path this port exists
//            for, and the only one where a push and a high stamp coincide
//   Y        retry now             S/S3/S6/S9  advance 1.2s / 3s / 62s / 70s
//   sect!    a section present but FALSY ('' — what curLedger holds for none)
//   OK       stop failing          NG/NQ    start failing pushes / config pushes
//
// **Seeds must precede `I`.** After sign-in the store's root subscription is
// live, so writing a row is a local edit and cannot be spelled as a seed; both
// harnesses refuse a seed after sign-in rather than quietly diverging.
//
// Deterministic: same seed, same corpus, so a divergence found today is
// reproducible tomorrow.

const fs = require('node:fs');
const path = require('node:path');

// ---------- a small deterministic PRNG ----------
//
// mulberry32, and it is `Math.imul` for a reason worth writing down: the
// obvious LCG (`seed = (seed * 1103515245 + 12345) & 0x7fffffff`) is wrong in
// JavaScript. The product passes 2^53, floating-point drops the low bits, and
// the sequence collapses — the first draft of this file produced 603 distinct
// scripts out of 104,000 attempts and reported the small number without
// complaint. `Math.imul` does the multiply in 32-bit integers, where the
// algorithm actually lives.
let seed = 20260826;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const upto = (n) => Math.floor(rnd() * (n + 1));

// Ids overlap deliberately: the interesting merges are the ones where a row
// exists on both sides with different stamps.
const IDS = ['a', 'b', 'c'];
// Zero is in here on purpose — `updatedAt ?? 0` and `> watermark` treat it as a
// row the server has already seen, which is a branch worth exercising.
const STAMPS = [0, 1, 50, 100, 200, 5000];
const SECTIONS = ['accounts', 'tags', 'settings', 'curLedger', 'lang', 'currencies'];
// Section stamps are relative to the shared epoch. A negative one is older than
// anything this device could have written; a large one is from the future,
// which a device with a skewed clock really does produce.
const AGES = [-100000, -1, 0, 1, 600, 1200, 60000];

function sections(n, stamped) {
  const out = [];
  const pool = [...SECTIONS];
  for (let i = 0; i < n; i++) {
    const k = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    // One section in six is present but falsy, which only a nullish presence
    // test adopts. Never `settings`: it is the one section the store re-wraps
    // on adoption (`{...cfg.settings, lock: keepLock}`), and spreading a falsy
    // value yields an empty object — the marker cannot survive, so the case
    // would compare the store's re-wrapping rather than the engine's decision.
    const name = k !== 'settings' && rnd() < 0.17 ? `${k}!` : k;
    out.push(stamped ? `${name}=${pick(AGES)}` : name);
  }
  return out.join(',');
}

function seedPart() {
  const cmds = [];
  for (let i = 0, n = upto(2); i < n; i++) {
    cmds.push(rnd() < 0.3
      ? `LF:${pick(IDS)},${pick(STAMPS)},${pick(STAMPS)}`
      : `L:${pick(IDS)},${pick(STAMPS)}`);
  }
  for (let i = 0, n = upto(2); i < n; i++) cmds.push(`R:${pick(IDS)},${pick(STAMPS)}`);
  const profile = upto(2);
  if (profile) cmds.push(`P:${sections(profile, rnd() < 0.7)}`);
  const fault = rnd();
  if (fault < 0.08) cmds.push('FP');
  else if (fault < 0.16) cmds.push('FC');
  else if (fault < 0.28) cmds.push('FU');
  else if (fault < 0.36) cmds.push('FQ');
  return cmds;
}

function action() {
  const r = rnd();
  if (r < 0.16) return `E:${pick(SECTIONS)}`;
  if (r < 0.3) return `N:${pick(IDS)},${pick(STAMPS)}`;
  if (r < 0.38) return `T:${pick(IDS)},${pick(STAMPS)}`;
  if (r < 0.44) return `TF:${pick(IDS)},${pick(STAMPS)},${pick(STAMPS)}`;
  if (r < 0.54) return `G:${sections(1 + upto(1), rnd() < 0.7)}`;
  if (r < 0.58) return 'GX';
  if (r < 0.605) return 'TX';
  if (r < 0.62) return 'TZ';
  if (r < 0.64) return 'Y';
  if (r < 0.68) return 'OK';
  // Turning failure back ON mid-script is what makes fail → succeed → fail
  // reachable, and that sequence is the only way to see whether a success
  // resets the backoff or whether a second failure re-arms a pending retry.
  if (r < 0.72) return 'NG';
  if (r < 0.75) return 'NQ';
  if (r < 0.77) return 'S9';
  if (r < 0.81) return 'S3';
  if (r < 0.83) return 'S6';
  if (r < 0.87) return 'O';
  if (r < 0.9) return 'I';
  return 'S';
}

const lines = new Set();

// The hand-written cases first: one obvious script per branch, so a corpus
// failure names the branch rather than a random walk.
for (const l of [
  'I',
  'I|O',
  'I|O|I',
  'L:a,100|I',
  'R:b,200|I',
  'L:a,100|R:b,200|I',
  'L:a,100|R:a,200|I',
  'L:a,200|R:a,100|I',
  'L:a,0|R:a,0|I',
  'FP|I',
  'FC|R:b,200|I',
  'FU|L:a,100|I',
  'FU|I',
  'P:accounts=5,tags=9|I',
  'P:accounts|I',
  'P:accounts=5|I|E:tags|S',
  'I|E:accounts|S',
  'I|E:accounts|E:tags|S',
  'I|N:z,300|S',
  'I|N:z,300|N:z,400|S',
  'I|T:c,400|S',
  'I|T:c,400|T:c,500|S',
  'I|G:tags=9|S',
  'I|E:accounts|S|G:accounts=1|S',
  'I|E:accounts|S|G:accounts=60000|S',
  'I|GX|S',
  'I|TX|S',
  'I|TZ|S',
  'L:a,100|I|TZ|S',
  'FU|I|E:accounts|S|OK|Y|S',
  'FU|I|E:accounts|S|S9',
  'FU|I|E:accounts|S|S9|S9|OK|S9',
  'I|O|E:accounts|S',
  'I|E:accounts|O|I|S',
  'FU|L:a,100|I|OK|Y|S',
  'FU|L:a,100|I|Y|S9|OK|S9',
  // the config-only failure: the rows land, the config does not, and the
  // watermark must still move past the rows that landed
  'FQ|L:a,100|I',
  'FQ|I|N:a,100|S',
  'FQ|I|N:a,100|S|OK|S9|N:b,200|S',
  'FQ|I|N:a,100|S|S3|S3',
  // fail, succeed, fail again — the backoff must start from base the second
  // time, not from where it left off
  'FU|I|E:tags|S|OK|S9|NG|E:tags|S|S3',
  'I|E:tags|S|NG|E:tags|S|S3|S3',
  'I|E:tags|S|NG|E:tags|S|E:accounts|S|S3',
  // fail → succeed → fail. The only sequence in which "a success resets the
  // backoff" is observable: without the reset the second failure waits 4s
  // rather than 2s, and the 3s window tells them apart.
  'I|NG|E:tags|S|OK|S9|NG|E:tags|S|S3',
  'I|NG|E:tags|S|OK|S9|NG|E:tags|S|S3|S3',
  'I|NG|N:a,100|S|OK|S9|NG|N:b,200|S|S3',
  // retry-now resets it too, and only a 3s window says so
  'I|NG|E:tags|S|Y|S3',
  'I|NG|E:tags|S|Y|Y|S3',
  // sign-out resets both the delay and the pending flag; leaving the flag set
  // would stop the NEXT session ever arming a retry at all
  'I|NG|E:tags|S|O|I|E:tags|S|S3',
  'I|NG|E:tags|S|O|I|N:a,100|S|S3',
  // six failures reach the 60s ceiling; an uncapped backoff would be at 64s,
  // and 62s is the only window that can tell
  'I|NG|E:tags|S|S9|S9|S9|S9|S9|S6',
  'I|NG|E:tags|S|S9|S9|S9|S9|S9|S9|S6',
  // a section present but falsy — adopted by a nullish test, refused by a
  // truthy one
  'I|G:curLedger!|S',
  'I|G:curLedger!=60000|S',
  'P:curLedger!|I',
  'I|E:curLedger|S|G:curLedger!=60000|S',
  // a remote stamp exactly equal to the local one is NOT adopted
  'I|E:accounts|G:accounts=1200|S',
  'I|E:tags|G:tags=1200|S',
  // The field-level merge against the watermark. Ours keeps the note, theirs
  // brings the amount, and the merged row is one the server has never seen —
  // so the watermark must NOT move past it, or the push that carries it is
  // filtered out by the very filter meant to find it.
  'LF:a,1000,1000|I|TF:a,2000,2000|S',
  'LF:a,1000,5000|I|TF:a,2000,2000|S',
  'LF:a,1000,1000|I|TF:a,5000,5000|S',
  'LF:a,1000,1000|R:b,50|I|TF:a,2000,2000|S',
  'LF:a,1000,1000|I|TF:a,2000,2000|TF:a,5000,5000|S',
  // sign-out must clear the pending flag, or the NEXT session can never arm a
  // retry at all — the earlier script never reached this because the failure
  // was still on when it signed back in, so the second start never finished
  'I|NG|E:tags|S|O|OK|I|NG|E:tags|S|S3',
  'I|NG|E:tags|S|O|OK|I|NG|N:a,100|S|S3',
]) {
  lines.add(l);
}

// Bounded by attempts, not by size. The command alphabet is small and short
// scripts collide often, so a `while (lines.size < N)` loop can spin forever
// once the reachable space is exhausted — which is a generator that hangs
// rather than one that says it ran out.
const TARGET = 2600;
for (let tries = 0; tries < TARGET * 40 && lines.size < TARGET; tries++) {
  const cmds = seedPart();
  cmds.push('I');
  for (let i = 0, n = 1 + upto(5); i < n; i++) cmds.push(action());
  // always settle at the end, or half the scripts would compare a state with a
  // push still pending and never measure whether it was the right one
  cmds.push('S');
  lines.add(cmds.join('|'));
}

const out = [...lines].join('\n') + '\n';
const dest = path.join(__dirname, '..', 'rust', 'parity', 'engine-corpus.tsv');
fs.writeFileSync(dest, out);
console.log(`${lines.size} cases → ${path.relative(path.join(__dirname, '..'), dest)}`);
