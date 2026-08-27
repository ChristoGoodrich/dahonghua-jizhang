#!/usr/bin/env node
// Generates the backup-naming parity corpus.
//
// Four kinds, tab-separated from their arguments:
//
//   name   ts|encrypted            what a snapshot is called
//   parse  filename                what a filename reads back as
//   list   names,comma,separated   the listing, newest first
//   prune  names|keep              which of it gets deleted
//
// The names deliberately include the ones that break a careless
// implementation: `.enc.json` (which also ends with `.json`), a name with no
// number in it, one with a negative or fractional time, and names that only
// look like backups.

const fs = require('node:fs');
const path = require('node:path');

let seed = 20260827;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const upto = (n) => Math.floor(rnd() * (n + 1));

// Zero and the negatives are reachable from a device with a wrong clock; the
// fractional one from a hand-edited directory.
const STAMPS = [0, 1, -1, 100, 1700000000000, 1700000000001, 12.5, 1e21];

/** Names that are backups, and names that only look like them. */
const ODD = [
  'backup_.json',
  'backup_draft.json',
  'backup_.enc.json',
  'backup_1700',
  'backup_1700.txt',
  'backup_1700.json.bak',
  'entries.json',
  'config.json',
  'prefix_backup_1700.json',
  'backup_1700.enc.json',
  'backup_backup_1700.json',
  'BACKUP_1700.json',
  'backup_0.json',
  'backup_-1.json',
];

function aName() {
  return rnd() < 0.3
    ? pick(ODD)
    : `backup_${pick(STAMPS)}${rnd() < 0.3 ? '.enc.json' : '.json'}`;
}

const lines = new Set();

// One obvious case per rule first, so a failure names the rule.
for (const l of [
  'name\t1700|0',
  'name\t1700|1',
  'name\t0|0',
  'name\t-1|1',
  'parse\tbackup_1700.json',
  'parse\tbackup_1700.enc.json',
  'parse\tbackup_.json',
  'parse\tbackup_draft.json',
  'parse\tbackup_1700',
  'parse\tentries.json',
  'parse\tprefix_backup_1700.json',
  'parse\tbackup_1700.json.bak',
  'list\t',
  'list\tbackup_100.json',
  'list\tbackup_100.json,backup_300.json,backup_200.enc.json',
  'list\tbackup_300.json,backup_draft.json,backup_100.json',
  'list\tentries.json,config.json',
  'prune\t|0',
  'prune\tbackup_100.json|0',
  'prune\tbackup_100.json,backup_200.json,backup_300.json|2',
  'prune\tbackup_100.json,backup_200.json,backup_300.json|10',
  // the one the sort has to get right: a timeless name must not be deleted
  // ahead of a real backup
  'prune\tbackup_draft.json,backup_100.json,backup_300.json|2',
  'prune\tbackup_draft.json,backup_other.json,backup_100.json|1',
]) {
  lines.add(l);
}

const TARGET = 2200;
for (let tries = 0; tries < TARGET * 40 && lines.size < TARGET; tries++) {
  const kind = rnd();
  if (kind < 0.15) {
    lines.add(`name\t${pick(STAMPS)}|${rnd() < 0.5 ? 1 : 0}`);
  } else if (kind < 0.45) {
    lines.add(`parse\t${aName()}`);
  } else if (kind < 0.72) {
    const n = 1 + upto(5);
    lines.add(`list\t${Array.from({ length: n }, aName).join(',')}`);
  } else {
    const n = 1 + upto(6);
    lines.add(`prune\t${Array.from({ length: n }, aName).join(',')}|${upto(4)}`);
  }
}

const out = [...lines].join('\n') + '\n';
const dest = path.join(__dirname, '..', 'rust', 'parity', 'backup-corpus.tsv');
fs.writeFileSync(dest, out);
console.log(`${lines.size} cases → ${path.relative(path.join(__dirname, '..'), dest)}`);
