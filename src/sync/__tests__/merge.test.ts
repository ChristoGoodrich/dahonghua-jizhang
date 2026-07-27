import { mergeById, liveRows, type SyncRow } from '../merge';

interface Row extends SyncRow {
  amt: number;
}
const row = (id: string, updatedAt: number, amt: number, deletedAt?: number): Row => ({ id, updatedAt, amt, deletedAt });

describe('mergeById', () => {
  it('keeps the newer version of a conflicting id', () => {
    const local = [row('a', 100, 10), row('b', 100, 5)];
    const remote = [row('a', 200, 99)]; // remote a is newer
    const { merged } = mergeById(local, remote);
    expect(merged.find((r) => r.id === 'a')!.amt).toBe(99);
    expect(merged.find((r) => r.id === 'b')!.amt).toBe(5);
  });

  it('unions rows that exist on only one side', () => {
    const local = [row('a', 100, 1)];
    const remote = [row('b', 100, 2)];
    const { merged } = mergeById(local, remote);
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('reports local rows the server is missing or behind on as toPush', () => {
    const local = [row('a', 300, 1), row('b', 100, 2), row('c', 100, 3)];
    const remote = [row('a', 200, 1), row('b', 100, 2)]; // a: local newer; b: equal; c: missing
    const { toPush } = mergeById(local, remote);
    expect(toPush.map((r) => r.id).sort()).toEqual(['a', 'c']); // b is in sync, not pushed
  });

  it('treats a soft-deleted tombstone as a normal row for conflict purposes', () => {
    const local = [row('a', 100, 10)];
    const remote = [row('a', 200, 10, 200)]; // deleted on another device, newer
    const { merged } = mergeById(local, remote);
    expect(merged[0].deletedAt).toBe(200);
    expect(liveRows(merged)).toHaveLength(0);
  });

  it('converges on equal-timestamp conflicts regardless of device order', () => {
    const a = row('x', 100, 10); // same updatedAt, different content
    const b = row('x', 100, 20);
    // device A sees (local=a, remote=b); device B sees (local=b, remote=a)
    const winnerA = mergeById([a], [b]).merged[0];
    const winnerB = mergeById([b], [a]).merged[0];
    expect(winnerA).toEqual(winnerB); // both devices pick the SAME row → no permanent divergence
  });

  it('pushes the tiebreak winner so the server converges too', () => {
    const a = row('x', 100, 10);
    const b = row('x', 100, 20);
    // whichever side is the deterministic winner must be flagged toPush when it is local
    const winner = mergeById([a], [b]).merged[0];
    const localIsWinner = mergeById([a], [b]).toPush.length === 1;
    expect(localIsWinner).toBe(winner === a);
    // the losing local side is not pushed
    expect(mergeById([b], [a]).toPush.length).toBe(winner === b ? 1 : 0);
  });

  it('does not push identical rows (equal timestamp and content)', () => {
    const local = [row('a', 100, 5)];
    const remote = [row('a', 100, 5)];
    expect(mergeById(local, remote).toPush).toHaveLength(0);
  });
});

describe('field-level merge', () => {
  interface FRow extends SyncRow { note: string; amt: number }
  const f = (over: Partial<FRow>): FRow => ({ id: 'e', note: 'old', amt: 10, ...over });

  it('preserves concurrent edits to different fields of the same entry', () => {
    const a = f({ note: 'A-note', amt: 10, updatedAt: 200, fieldTs: { note: 200 } }); // A edited note
    const b = f({ note: 'old', amt: 99, updatedAt: 300, fieldTs: { amt: 300 } }); // B edited amt
    const m = mergeById([a], [b]).merged[0];
    expect(m.note).toBe('A-note'); // A's edit kept
    expect(m.amt).toBe(99); // B's edit kept
    expect(m.updatedAt).toBe(300);
    expect(m.fieldTs).toEqual({ note: 200, amt: 300 });
  });

  it('is order-independent (same merge on both devices)', () => {
    const a = f({ note: 'A-note', amt: 10, updatedAt: 200, fieldTs: { note: 200 } });
    const b = f({ note: 'old', amt: 99, updatedAt: 300, fieldTs: { amt: 300 } });
    expect(mergeById([a], [b]).merged[0]).toEqual(mergeById([b], [a]).merged[0]);
  });

  it('uploads the field-merged row so the server converges', () => {
    const a = f({ note: 'A-note', updatedAt: 200, fieldTs: { note: 200 } });
    const b = f({ amt: 99, updatedAt: 300, fieldTs: { amt: 300 } });
    expect(mergeById([a], [b]).toPush).toHaveLength(1);
  });

  it('falls back to whole-row LWW when either side lacks fieldTs', () => {
    const a = f({ note: 'A', amt: 1, updatedAt: 100 }); // legacy row, no fieldTs
    const b = f({ note: 'B', amt: 2, updatedAt: 200, fieldTs: { note: 200 } });
    expect(mergeById([a], [b]).merged[0].note).toBe('B'); // newer updatedAt wins wholesale
  });

  it('keeps a row deleted even while merging the other side’s field edits', () => {
    const a = f({ note: 'A', updatedAt: 300, fieldTs: { note: 300 }, deletedAt: null });
    const b = f({ amt: 5, updatedAt: 200, fieldTs: { amt: 200 }, deletedAt: 200 });
    const m = mergeById([a], [b]).merged[0];
    expect(m.deletedAt).toBe(200); // tombstone precedence (no stamped clear anywhere)
    expect(m.note).toBe('A'); // fields still merged into the tombstone
    expect(liveRows([m])).toHaveLength(0);
  });

  it('a NEWER stamped clear resurrects the row (delete-undo survives sync)', () => {
    // device A deleted at t=200 (stamped); device B undid the delete at t=300
    // with a stamped clear — the undo must win, or every undo would be
    // silently re-deleted by the next pull
    const a = f({ amt: 5, updatedAt: 300, fieldTs: { amt: 100, deletedAt: 300 } }); // cleared
    const b = f({ amt: 5, updatedAt: 200, fieldTs: { amt: 100, deletedAt: 200 }, deletedAt: 200 });
    const m = mergeById([a], [b]).merged[0];
    expect(m.deletedAt).toBeUndefined();
    expect(liveRows([m])).toHaveLength(1);
  });

  it('an OLDER stamped clear still loses to a newer tombstone', () => {
    // undo at t=200, then deleted again at t=300 elsewhere → stays deleted
    const a = f({ amt: 5, updatedAt: 200, fieldTs: { deletedAt: 200 } });
    const b = f({ amt: 5, updatedAt: 300, fieldTs: { deletedAt: 300 }, deletedAt: 300 });
    const m = mergeById([a], [b]).merged[0];
    expect(m.deletedAt).toBe(300);
  });

  it('two stamped tombstones keep the latest delete time', () => {
    const a = f({ amt: 5, updatedAt: 300, fieldTs: { deletedAt: 250 }, deletedAt: 250 });
    const b = f({ amt: 5, updatedAt: 300, fieldTs: { deletedAt: 250 }, deletedAt: 400 });
    // equal stamps, both present → deterministic max so devices converge
    expect(mergeById([a], [b]).merged[0].deletedAt).toBe(400);
  });
});

describe('liveRows', () => {
  it('filters out soft-deleted rows', () => {
    const rows = [row('a', 1, 1), row('b', 1, 1, 5)];
    expect(liveRows(rows).map((r) => r.id)).toEqual(['a']);
  });
});
