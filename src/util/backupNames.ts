// What a backup snapshot is called, and which ones to keep — extracted from
// backup.ts so it can be tested and compared without a filesystem.
//
// Two of the four rules here are the kind a second implementation gets subtly
// wrong, which is why they are worth having in one place:
//
//   * `.enc.json` also ends with `.json`. The filter accepts either and the
//     parse must strip the LONGER suffix first; checking the shorter one first
//     turns `backup_123.enc.json` into a plain backup named `backup_123.enc`,
//     whose time then parses as NaN.
//   * Pruning keeps the newest, which only works because the list was sorted
//     descending first. `slice(keep)` on an unsorted listing deletes whichever
//     name the directory happened to return last.

export interface BackupInfo {
  name: string;
  /** Epoch ms from the name, or NaN when the name carries no usable number. */
  time: number;
  encrypted: boolean;
}

export function backupName(ts: number, encrypted = false): string {
  return `backup_${ts}${encrypted ? '.enc.json' : '.json'}`;
}

/** Read a filename. `null` for anything that is not a backup. */
export function parseBackupName(name: string): BackupInfo | null {
  if (!name.startsWith('backup_')) return null;
  const encrypted = name.endsWith('.enc.json');
  let stripped: string;
  if (encrypted) stripped = name.slice(0, -'.enc.json'.length);
  else if (name.endsWith('.json')) stripped = name.slice(0, -'.json'.length);
  else return null;
  return { name, time: Number(stripped.slice('backup_'.length)), encrypted };
}

/** Newest first, with unnamed times last.
 *
 *  `(a, b) => b.time - a.time` is NOT a total order once a time is NaN: the
 *  comparator returns NaN and ECMA-262 leaves the result implementation-defined
 *  from there, so a stray `backup_draft.json` in the directory left the sort —
 *  and therefore the prune — arbitrary. Same failure `domain/order.ts` fixed
 *  for amounts, same fix: rank the unorderable value explicitly, at the end,
 *  where pruning reaches it only after every real backup is safe. */
export function sortBackups(list: BackupInfo[]): BackupInfo[] {
  return [...list].sort((a, b) => {
    const an = Number.isNaN(a.time);
    const bn = Number.isNaN(b.time);
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    return b.time - a.time;
  });
}

/** Every backup in a directory listing, newest first. */
export function listBackupNames(names: string[]): BackupInfo[] {
  const parsed: BackupInfo[] = [];
  for (const n of names) {
    const b = parseBackupName(n);
    if (b) parsed.push(b);
  }
  return sortBackups(parsed);
}

/** Which backups to delete so that `keep` remain. Newest-first input. */
export function pruneBackups(list: BackupInfo[], keep: number): BackupInfo[] {
  return list.length <= keep ? [] : list.slice(keep);
}
