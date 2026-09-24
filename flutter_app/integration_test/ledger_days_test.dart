// `LedgerDays`: every live entry and its day, read once per change.
//
// A copy of the ledger on the Dart side is the thing `store.rs` was written to
// make unnecessary, so this one is held to the only rule that makes it safe:
// the moment anything could have been written, it is read again.

import 'package:flutter_app/ledger_days.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void add(String id, {int? ts, double amt = 10}) => store.addEntry(
  entry: store.NewEntry(io: 'exp', cat: 'food', amt: amt, ts: ts ?? now),
  id: id,
  now: now,
);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  testWidgets('nothing written, nothing read again', (tester) async {
    add('a');
    final first = LedgerDays.current();
    expect(identical(LedgerDays.current(), first), isTrue);
  });

  testWidgets('every kind of write reads again', (tester) async {
    add('a');
    final first = LedgerDays.current();
    expect(first.ids, ['a']);

    add('b');
    final added = LedgerDays.current();
    expect(identical(added, first), isFalse);
    expect(added.ids.toSet(), {'a', 'b'});

    store.removeEntry(id: 'a', now: now);
    expect(LedgerDays.current().ids, ['b'], reason: 'a delete');

    store.updateEntry(
      id: 'b',
      patch: const store.EntryPatch(amt: 99),
      now: now,
    );
    expect(LedgerDays.current().entries.single.amt, 99, reason: 'an edit');

    store.reset();
    expect(LedgerDays.current().ids, isEmpty, reason: 'a reset');
  });

  testWidgets('each day is the day its instant fell on here', (tester) async {
    final t = DateTime(2026, 3, 9, 23, 30).millisecondsSinceEpoch;
    add('late', ts: t);
    add('now');
    final l = LedgerDays.current();
    for (var i = 0; i < l.ids.length; i++) {
      final d = DateTime.fromMillisecondsSinceEpoch(l.entries[i].ts);
      expect(l.days[i], dayKey(d));
    }
    expect(l.days[l.ids.indexOf('late')], '2026-3-9');
  });
}
