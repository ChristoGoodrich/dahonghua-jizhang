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
});

describe('liveRows', () => {
  it('filters out soft-deleted rows', () => {
    const rows = [row('a', 1, 1), row('b', 1, 1, 5)];
    expect(liveRows(rows).map((r) => r.id)).toEqual(['a']);
  });
});
