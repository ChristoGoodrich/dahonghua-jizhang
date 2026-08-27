// TypeScript half of the backup-naming parity harness.
//
// Four rules with no I/O in them: what a snapshot is called, how a filename
// reads back, how a listing sorts, and which of it gets pruned. Two are the
// kind a second implementation gets subtly wrong — `.enc.json` also ends with
// `.json`, and pruning only keeps the newest because the list was sorted first.

import {
  backupName,
  parseBackupName,
  listBackupNames,
  pruneBackups,
} from '../src/util/backupNames';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** A time that is not a number renders as `_`, on both sides. */
const showTime = (t: number) => (Number.isNaN(t) ? '_' : String(t));

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const parts = trimmed.slice(tab + 1).split('|');

  let value: string;
  switch (kind) {
    case 'name': {
      value = backupName(Number(parts[0]), parts[1] === '1');
      break;
    }
    case 'parse': {
      const b = parseBackupName(parts[0]);
      value = b === null ? 'none' : `${showTime(b.time)},${b.encrypted ? '1' : '0'}`;
      break;
    }
    case 'list': {
      // an empty cell is an empty listing, not a listing of one empty name
      const names = parts[0] === '' ? [] : parts[0].split(',');
      value = listBackupNames(names)
        .map((b) => `${b.name}@${showTime(b.time)}${b.encrypted ? 'E' : ''}`)
        .join(' ');
      break;
    }
    case 'prune': {
      const names = parts[0] === '' ? [] : parts[0].split(',');
      const keep = Number(parts[1]);
      value = pruneBackups(listBackupNames(names), keep)
        .map((b) => b.name)
        .join(' ');
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(value);
}

process.stdout.write(out.join('\n') + '\n');
