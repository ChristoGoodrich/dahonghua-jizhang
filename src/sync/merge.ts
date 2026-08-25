// Pure sync-merge logic — last-write-wins by updatedAt, soft-delete aware.
//
// This is the heart of multi-device sync and is intentionally free of any
// Supabase/network code so it can be unit-tested deterministically. The sync
// engine feeds it local rows + rows pulled from the server and applies the
// `merged` result to the store and pushes `toPush` back up.
//
// Two-tier conflict resolution:
//   1. Field-level LWW when *both* versions carry per-field timestamps (`fieldTs`,
//      written by updateEntry): concurrent edits to different fields of the same
//      entry are both preserved.
//   2. Whole-row LWW otherwise (legacy rows without fieldTs) — newest `updatedAt`
//      wins, with a deterministic content tiebreaker on equal timestamps so all
//      devices converge instead of diverging forever.
// Deletion is a field like any other: a tombstone wins against a side that
// never stamped `deletedAt`, but a NEWER stamped clear (the delete-undo writes
// one) resurrects the row. Under the old always-wins rule an undo could never
// survive a sync round-trip — the pushed tombstone re-deleted the entry on the
// next pull, silently and unreproducibly.

export interface SyncRow {
  id: string;
  updatedAt?: number; // epoch ms; the conflict tiebreaker (missing → 0)
  deletedAt?: number | null; // soft delete — a tombstone still syncs
  fieldTs?: Record<string, number>; // per-field last-write ms (enables field-level merge)
}

export interface MergeResult<T> {
  merged: T[]; // authoritative set to store locally (newest wins per id)
  toPush: T[]; // local rows the server hasn't seen the latest of
}

/** Stable serialization for the equal-timestamp tiebreak (key order independent).
 *
 *  This used to be `JSON.stringify(r, Object.keys(r).sort())`, which looks like
 *  "serialize with sorted keys" and is not. The second argument to
 *  `JSON.stringify` is a *replacer*, and an array replacer is a key allowlist
 *  applied at **every** level — so `fieldTs` came out filtered by the row's own
 *  top-level key names, and any per-field stamp whose field was absent from the
 *  row vanished from the comparison.
 *
 *  An entry that once carried a note and no longer does is exactly that shape,
 *  and two devices holding different stamps for it would each keep their own
 *  copy and neither would push: the tiebreak that exists so "all devices
 *  converge instead of diverging forever" could not see the difference to break.
 *
 *  Sorting at every level instead. Note the string this produces is only ever
 *  compared locally and never transmitted, so a device running the old code and
 *  one running this can still sync — they can disagree about which row wins an
 *  exact `updatedAt` tie, which is a case the old code did not converge on
 *  anyway. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  // `JSON.stringify` omits undefined-valued keys; so does this
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/**
 * Order two versions of the same id: positive if `a` should win over `b`.
 * Newer `updatedAt` wins; on a tie, the lexicographically larger serialization
 * wins so every device converges on the same row.
 */
function compareRows(a: SyncRow, b: SyncRow): number {
  const d = (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
  if (d !== 0) return d;
  const sa = stable(a);
  const sb = stable(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function hasFieldTs(r: SyncRow): boolean {
  return !!r.fieldTs && Object.keys(r.fieldTs).length > 0;
}

/** Pick a single field's value between two rows by its per-field timestamp. */
function pickField(a: SyncRow, b: SyncRow, key: string): unknown {
  const ta = a.fieldTs?.[key] ?? 0;
  const tb = b.fieldTs?.[key] ?? 0;
  const va = (a as unknown as Record<string, unknown>)[key];
  const vb = (b as unknown as Record<string, unknown>)[key];
  if (ta !== tb) return ta > tb ? va : vb;
  if (va === undefined) return vb; // a field present on only one side survives
  if (vb === undefined) return va;
  return JSON.stringify(va) >= JSON.stringify(vb) ? va : vb; // deterministic tie
}

/** Field-level merge: each field taken from whichever side edited it more recently. */
function mergeRow<T extends SyncRow>(a: T, b: T): T {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  ['id', 'updatedAt', 'deletedAt', 'fieldTs'].forEach((k) => keys.delete(k));
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = pickField(a, b, k);

  // deletedAt: LWW by its field stamp so a newer stamped CLEAR (undo) can
  // resurrect the row. With no stamps (legacy rows) the old precedence holds:
  // a tombstone beats absence, and two tombstones keep the latest. `null`
  // counts as absent — rowToEntry never emits it, but legacy local rows can.
  const ta = a.fieldTs?.deletedAt ?? 0;
  const tb = b.fieldTs?.deletedAt ?? 0;
  const da = a.deletedAt ?? undefined;
  const db = b.deletedAt ?? undefined;
  let del: number | undefined;
  if (ta !== tb) del = ta > tb ? da : db;
  else if (da == null) del = db;
  else if (db == null) del = da;
  else del = Math.max(da, db);
  if (del != null) out.deletedAt = del;

  const ft: Record<string, number> = { ...(a.fieldTs ?? {}) };
  for (const [k, v] of Object.entries(b.fieldTs ?? {})) ft[k] = Math.max(ft[k] ?? 0, v);
  out.fieldTs = ft;

  out.updatedAt = Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0);
  out.id = a.id;
  return out as T;
}

/** Resolve the two versions of one id.
 *
 *  Shared by `mergeById` (the pull) and `mergeOne` (a realtime message) so the
 *  two paths cannot answer differently. They did: the realtime handler compared
 *  `updatedAt` and replaced the local row wholesale, which threw away exactly
 *  the concurrent field edit `fieldTs` exists to preserve — and threw away the
 *  stamp with it, so a later pull could not recover what had been dropped. */
function resolve<T extends SyncRow>(l: T, r: T, onConflict?: (info: ConflictInfo) => void): T {
  const report = (resolution: ConflictInfo['resolution']) => {
    if (onConflict && stable(l) !== stable(r)) {
      onConflict({
        entryId: l.id,
        localUpdatedAt: l.updatedAt ?? 0,
        remoteUpdatedAt: r.updatedAt ?? 0,
        resolution,
      });
    }
  };
  if (hasFieldTs(l) && hasFieldTs(r)) {
    const win = mergeRow(l, r);
    report('merged');
    return win;
  }
  const cmp = compareRows(r, l);
  report(cmp > 0 ? 'remote' : 'local');
  return cmp > 0 ? r : l;
}

export interface ConflictInfo {
  entryId: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  resolution: 'local' | 'remote' | 'merged';
}

/** Merge local and remote rows by id: field-level when both sides carry fieldTs,
 *  else whole-row newest-wins with a deterministic tiebreaker. */
export function mergeById<T extends SyncRow>(
  local: T[],
  remote: T[],
  onConflict?: (info: ConflictInfo) => void,
): MergeResult<T> {
  const localById = new Map(local.map((r) => [r.id, r] as const));
  const remoteById = new Map(remote.map((r) => [r.id, r] as const));
  const ids = new Set<string>([...localById.keys(), ...remoteById.keys()]);

  const merged: T[] = [];
  const toPush: T[] = [];
  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    const win: T = l && r ? resolve(l, r, onConflict) : (l ?? r)!;
    merged.push(win);
    // upload when the server lacks the row or its stored copy differs from the winner
    if (!r || stable(win) !== stable(r)) toPush.push(win);
  }

  return { merged, toPush };
}

export interface MergeOneResult<T> {
  rows: T[]; // the local set with the incoming row resolved into it
  push: T | null; // the resolved row, when the server's copy is not it
}

/** Merge ONE incoming remote row into the local set — the realtime path.
 *
 *  Not `mergeById(local, [remote])`: that treats every row the message did not
 *  mention as missing from the server and would re-upload the whole ledger on
 *  every echo. This resolves the one id and reports whether the result still
 *  needs pushing, which it does whenever the local side contributed anything —
 *  a field the remote had not seen, or a whole row that simply won. */
export function mergeOne<T extends SyncRow>(
  local: T[],
  remote: T,
  onConflict?: (info: ConflictInfo) => void,
): MergeOneResult<T> {
  const idx = local.findIndex((x) => x.id === remote.id);
  if (idx < 0) return { rows: [...local, remote], push: null };
  const win = resolve(local[idx], remote, onConflict);
  const rows = [...local];
  rows[idx] = win;
  return { rows, push: stable(win) !== stable(remote) ? win : null };
}

/** Visible (non-deleted) rows — the UI should render these. */
export function liveRows<T extends SyncRow>(rows: T[]): T[] {
  return rows.filter((r) => !r.deletedAt);
}
