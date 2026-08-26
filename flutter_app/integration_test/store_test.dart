// Does the Rust core hold the ledger, on a device, across the FFI boundary?
//
// The bridge tests next door ask whether a *function* answers. These ask
// whether *state* survives: write through one call, read back through another,
// with nothing on the Dart side holding a copy. That is the architecture the
// migration committed to, so it is the thing worth proving on real hardware
// rather than on the host.
//
// Identity and the clock are supplied on every call, because the core has
// neither — which is also what makes these tests deterministic.

import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

/// A fixed clock, so nothing here depends on when it ran.
const t0 = 1787000000000; // 2026-08-26, mid-afternoon in Sydney

store.NewEntry expense(double amt, {String cat = 'food', String? note, int? ts}) =>
    store.NewEntry(io: 'exp', cat: cat, amt: amt, note: note, ts: ts);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() => store.reset());

  group('the ledger lives in Rust', () {
    test('an entry written through the bridge is there to read back', () {
      final id = store.addEntry(entry: expense(35.5, note: '午饭'), id: 'e1', now: t0);

      expect(id, 'e1');
      expect(store.entryCount(), 1);
      final got = store.getEntry(id: 'e1')!;
      expect(got.amt, 35.5);
      expect(got.note, '午饭');
      expect(got.io, 'exp');
      // the store stamps it, because the sync merge needs a write time
      expect(got.updatedAt, t0);
    });

    test('nothing is held on this side — a fresh read sees the same rows', () {
      store.addEntry(entry: expense(1), id: 'a', now: t0);
      store.addEntry(entry: expense(2), id: 'b', now: t0 + 1);
      expect(store.liveEntries().map((e) => e.id), ['b', 'a']); // newest first
    });

    test('an unknown id answers nothing rather than throwing', () {
      expect(store.getEntry(id: 'nope'), isNull);
      expect(store.updateEntry(id: 'nope', patch: store.EntryPatch(amt: 1), now: t0), isFalse);
    });
  });

  group('editing', () {
    test('a patch changes only the fields it names', () {
      store.addEntry(entry: expense(10, note: 'keep'), id: 'e1', now: t0);
      final ok = store.updateEntry(
        id: 'e1',
        patch: store.EntryPatch(amt: 99),
        now: t0 + 5000,
      );

      expect(ok, isTrue);
      final got = store.getEntry(id: 'e1')!;
      expect(got.amt, 99);
      expect(got.note, 'keep');
      expect(got.updatedAt, t0 + 5000);
    });
  });

  group('deleting', () {
    test('a removed entry is a tombstone, not a gap', () {
      store.addEntry(entry: expense(10), id: 'e1', now: t0);
      final undo = store.removeEntry(id: 'e1', now: t0 + 1);

      expect(undo, isNotNull);
      expect(store.liveEntries(), isEmpty); // gone from every display path
      expect(store.entryCount(), 1); // still here, so other devices learn of it
      expect(store.getEntry(id: 'e1')!.deletedAt, t0 + 1);
    });

    test('undo brings it back as a fresh write, not a replayed one', () {
      store.addEntry(entry: expense(10), id: 'e1', now: t0);
      final undo = store.removeEntry(id: 'e1', now: t0 + 1)!;
      store.unremoveEntry(undo: undo, now: t0 + 2);

      final got = store.getEntry(id: 'e1')!;
      expect(got.deletedAt, isNull);
      // stamped now, not restored to its old time — an old stamp sits below the
      // push watermark and the undo would never reach the cloud
      expect(got.updatedAt, t0 + 2);
      expect(store.liveEntries(), hasLength(1));
    });
  });

  group('accounts', () {
    test('there is one account that cannot be deleted', () {
      final a = store.accounts();
      expect(a, hasLength(1));
      expect(a.first.id, 'default');
      expect(store.currentAccount(), 'default');
    });

    test('recording against an account makes it the next default', () {
      // the side effect the parity harness found rather than the code announced
      store.setCurrentAccount(id: 'default');
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'food', amt: 1, acct: 'card-a'),
        id: 'e1',
        now: t0,
      );
      expect(store.currentAccount(), 'card-a');
    });

    test('an entry naming no account leaves the selection alone', () {
      store.setCurrentAccount(id: 'card-a');
      store.addEntry(entry: expense(1), id: 'e1', now: t0);
      expect(store.currentAccount(), 'card-a');
    });
  });

  group('transfers', () {
    test('one xfer row carries both accounts', () {
      store.addTransfer(
        transfer: store.NewTransfer(from: 'card-a', to: 'cash', amt: 500),
        id: 'x1',
        now: t0,
      );
      final got = store.getEntry(id: 'x1')!;
      expect(got.io, 'xfer');
      expect(got.cat, 'transfer');
      expect(got.acct, 'card-a');
      expect(got.acctTo, 'cash');
      expect(store.currentAccount(), 'card-a'); // moves unconditionally
    });

    test('a zero fee is no fee, not a fee of zero', () {
      // `p.fee || undefined` — the falsy-means-absent idiom, reproduced
      store.addTransfer(
        transfer: store.NewTransfer(from: 'a', to: 'b', amt: 100, fee: 0),
        id: 'x1',
        now: t0,
      );
      expect(store.getEntry(id: 'x1')!.fee, isNull);
    });
  });

  group('the entry list', () {
    test('groups into days, newest first, with each day totalled', () {
      store.addEntry(entry: expense(30), id: 'a', now: t0);
      store.addEntry(entry: store.NewEntry(io: 'inc', cat: 'salary', amt: 100), id: 'b', now: t0);
      store.addEntry(entry: expense(7), id: 'c', now: t0);

      final items = store.listItems(
        ids: ['a', 'b', 'c'],
        days: ['2026-8-26', '2026-8-26', '2026-8-25'],
        today: '2026-8-26',
        columns: 1,
      );

      expect(items.map((i) => i.kind), ['header', 'entry', 'entry', 'header', 'entry']);
      expect(items[0].label, 'today');
      expect(items[0].exp, 30);
      expect(items[0].inc, 100);
      expect(items[3].label, 'yesterday');
      expect(items[3].exp, 7);
    });

    test('packs into rows above one column', () {
      for (var i = 0; i < 3; i++) {
        store.addEntry(entry: expense(1), id: 'e$i', now: t0 + i);
      }
      final items = store.listItems(
        ids: ['e0', 'e1', 'e2'],
        days: List.filled(3, '2026-8-26'),
        today: '2026-8-26',
        columns: 2,
      );
      expect(items.map((i) => i.kind), ['header', 'row', 'row']);
      expect(items[1].ids, hasLength(2));
      expect(items[2].ids, hasLength(1)); // the short last row survives
    });

    test('an id the store does not have is simply not listed', () {
      store.addEntry(entry: expense(1), id: 'real', now: t0);
      final items = store.listItems(
        ids: ['real', 'ghost'],
        days: ['2026-8-26', '2026-8-26'],
        today: '2026-8-26',
        columns: 1,
      );
      expect(items.where((i) => i.kind == 'entry').map((i) => i.ids.first), ['real']);
    });
  });

  group('persistence', () {
    test('a snapshot restores the ledger it was taken from', () {
      store.addEntry(entry: expense(35.5, note: 'a"b'), id: 'e1', now: t0);
      store.addEntry(entry: store.NewEntry(io: 'xfer', cat: 'transfer', amt: 1), id: 'e2', now: t0);
      final json = store.snapshotEntries();

      store.reset();
      expect(store.entryCount(), 0);

      expect(store.loadEntries(json: json), 2);
      expect(store.entryCount(), 2);
      final got = store.getEntry(id: 'e1')!;
      expect(got.amt, 35.5);
      expect(got.note, 'a"b'); // the escape survives the round trip
    });

    test('a snapshot keeps tombstones, or a restore would resurrect them', () {
      store.addEntry(entry: expense(10), id: 'e1', now: t0);
      store.removeEntry(id: 'e1', now: t0 + 1);

      store.loadEntries(json: store.snapshotEntries());

      expect(store.entryCount(), 1);
      expect(store.liveEntries(), isEmpty);
    });

    test('junk is refused rather than read as an empty ledger', () {
      store.addEntry(entry: expense(10), id: 'keep', now: t0);
      // -1, not 0: a document that could not be read is not the same answer as
      // one that says there are no entries, and the caller needs to tell them
      // apart before it writes anything back over the file
      expect(store.loadEntries(json: 'not json at all'), -1);
      expect(store.loadEntries(json: '[{"id":"e1"'), -1); // truncated
      expect(store.loadEntries(json: ''), -1);
      expect(store.entryCount(), 1); // the ledger is left alone

      // and a genuinely empty one still is one
      expect(store.loadEntries(json: '[]'), 0);
      expect(store.entryCount(), 0);
    });
  });
}
