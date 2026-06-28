// Pure sync-merge logic — last-write-wins by updatedAt, soft-delete aware.
//
// This is the heart of multi-device sync and is intentionally free of any
// Supabase/network code so it can be unit-tested deterministically. The sync
// engine feeds it local rows + rows pulled from the server and applies the
// `merged` result to the store and pushes `toPush` back up.

export interface SyncRow {
  id: string;
  updatedAt?: number; // epoch ms; the conflict tiebreaker (missing → 0)
  deletedAt?: number | null; // soft delete — a tombstone still syncs
}

export interface MergeResult<T> {
  merged: T[]; // authoritative set to store locally (newest wins per id)
  toPush: T[]; // local rows the server hasn't seen the latest of
}

/** Merge local and remote rows by id, newest `updatedAt` winning. */
export function mergeById<T extends SyncRow>(local: T[], remote: T[]): MergeResult<T> {
  const at = (r: SyncRow) => r.updatedAt ?? 0;
  const winner = new Map<string, T>();
  for (const r of local) winner.set(r.id, r);
  for (const r of remote) {
    const cur = winner.get(r.id);
    if (!cur || at(r) > at(cur)) winner.set(r.id, r);
  }

  const remoteById = new Map(remote.map((r) => [r.id, r] as const));
  const toPush: T[] = [];
  for (const r of local) {
    const rem = remoteById.get(r.id);
    if (!rem || at(r) > at(rem)) toPush.push(r);
  }

  return { merged: [...winner.values()], toPush };
}

/** Visible (non-deleted) rows — the UI should render these. */
export function liveRows<T extends SyncRow>(rows: T[]): T[] {
  return rows.filter((r) => !r.deletedAt);
}
