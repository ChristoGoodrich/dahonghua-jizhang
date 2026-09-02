// Two devices, one file.
//
// There is no second device in a test, so one process plays both: build a
// document from one ledger, reset, build another, and merge the first into the
// second. That is exactly what the file does between two phones, minus the
// phones.
//
// The merge itself is `core::merge` and has 7,043 parity cases behind it.
// What is tested here is the envelope and the wiring — that the document
// carries what it must, that a merge is not an import, and that the screen
// cannot be used in the order that loses data.

import 'package:flutter/material.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/sync.dart' as sync;
import 'package:flutter_app/sync_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

const t0 = 1787000000000;

void add(String id, double amt, {int? ts, String note = ''}) {
  store.addEntry(
    entry: store.NewEntry(
      io: 'exp',
      cat: 'food',
      amt: amt,
      ts: ts ?? t0,
      note: note.isEmpty ? null : note,
    ),
    id: id,
    now: ts ?? t0,
  );
}

/// The document this device would write right now.
String doc({int? now}) => sync.syncDocument(now: now ?? t0);

Future<void> show(
  WidgetTester tester, {
  bool zh = true,
  Future<String?> Function()? pick,
  Future<void> Function(String)? share,
  void Function()? onChanged,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: SyncScreen(zh: zh, pick: pick, share: share, onChanged: onChanged),
  ));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the document', () {
    testWidgets('carries the entries', (tester) async {
      add('a', 12.5);
      add('b', 30);

      final d = doc();
      expect(d, contains('"a"'));
      expect(d, contains('"b"'));
      expect(sync.inspectDocument(json: d).incoming, 2);
    });

    testWidgets('carries tombstones, or a merge resurrects deletions',
        (tester) async {
      add('a', 12.5);
      store.removeEntry(id: 'a', now: t0 + 1);

      // The other device still has the live row. If the document dropped the
      // tombstone, merging would bring the entry back from the dead.
      expect(sync.inspectDocument(json: doc()).incoming, 1);
    });

    testWidgets('carries the accounts', (tester) async {
      accounts.addAccount(id: 'wallet', name: '钱包', balance: 0, kind: 'cash');
      expect(doc(), contains('wallet'));
    });

    testWidgets('says which format it is', (tester) async {
      expect(doc(), contains('"v":1'));
    });
  });

  group('a merge is not an import', () {
    testWidgets('keeps rows this device has and the file does not',
        (tester) async {
      add('mine', 10);
      final theirs = () {
        store.reset();
        add('theirs', 20);
        return doc();
      }();
      store.reset();
      add('mine', 10);

      final r = sync.mergeDocument(json: theirs);
      expect(r.error, isEmpty);
      expect(r.added, 1);
      expect(store.entryCount(), 2, reason: 'both sides survive a merge');
      expect(store.getEntry(id: 'mine'), isNotNull);
      expect(store.getEntry(id: 'theirs'), isNotNull);
    });

    testWidgets('a deletion here is not undone by a file that still has it',
        (tester) async {
      // The other device's document, written before the delete.
      add('a', 10);
      final theirs = doc();

      // This device deletes it afterwards, so the tombstone is newer.
      store.removeEntry(id: 'a', now: t0 + 5000);

      sync.mergeDocument(json: theirs);
      expect(store.liveEntries(), isEmpty,
          reason: 'a tombstone newer than the row wins');
    });

    testWidgets('a deletion made on the OTHER device arrives here',
        (tester) async {
      // The direction the tombstone actually has to travel, and the one an
      // injection found missing: the other device deleted the entry, this one
      // still has it live. Without the tombstone in the document, this device
      // never learns the row is gone, and the next write-back hands it
      // straight back to them.
      add('a', 10);
      store.removeEntry(id: 'a', now: t0 + 5000);
      final theirs = doc();

      store.reset();
      add('a', 10);
      expect(store.liveEntries().length, 1);

      sync.mergeDocument(json: theirs);
      expect(store.liveEntries(), isEmpty,
          reason: 'their tombstone is newer than our row');
    });

    testWidgets('the later edit wins when both sides changed one entry',
        (tester) async {
      add('a', 10);
      store.updateEntry(
          id: 'a', patch: store.EntryPatch(amt: 111), now: t0 + 1000);
      final theirs = doc();

      store.reset();
      add('a', 10);
      store.updateEntry(
          id: 'a', patch: store.EntryPatch(amt: 222), now: t0 + 9000);

      final r = sync.mergeDocument(json: theirs);
      expect(store.getEntry(id: 'a')!.amt, 222,
          reason: 'the local edit is later');
      expect(r.conflicts, greaterThanOrEqualTo(0));
    });

    testWidgets('merging the same file twice changes nothing the second time',
        (tester) async {
      final theirs = () {
        add('theirs', 20);
        return doc();
      }();
      store.reset();
      add('mine', 10);

      final first = sync.mergeDocument(json: theirs);
      final second = sync.mergeDocument(json: theirs);

      expect(first.added, 1);
      expect(second.added, 0, reason: 'a merge has to be idempotent');
      expect(second.updated, 0);
      expect(store.entryCount(), 2);
    });

    testWidgets('an account arrives with the entries that name it',
        (tester) async {
      accounts.addAccount(id: 'wallet', name: '钱包', balance: 0, kind: 'cash');
      final theirs = doc();

      store.reset();
      final r = sync.mergeDocument(json: theirs);

      expect(r.accountsAdded, 1);
      expect(accounts.pickable(selected: '').map((a) => a.id), contains('wallet'),
          reason: 'an entry pointing at an account it does not have is worse '
              'than a spare account');
    });

    testWidgets('an account already here is not duplicated', (tester) async {
      accounts.addAccount(id: 'wallet', name: '钱包', balance: 0, kind: 'cash');
      final theirs = doc();

      final r = sync.mergeDocument(json: theirs);
      expect(r.accountsAdded, 0);
    });
  });

  group('a file it will not take', () {
    testWidgets('something that is not a document', (tester) async {
      expect(sync.mergeDocument(json: 'hello').error, isNotEmpty);
      expect(sync.mergeDocument(json: '{}').error, isNotEmpty);
      expect(sync.mergeDocument(json: '[]').error, isNotEmpty);
    });

    testWidgets('one from a newer build is refused, not partly read',
        (tester) async {
      add('mine', 10);
      final future = '{"v":99,"writtenAt":$t0,"entries":[],"accounts":[]}';

      final r = sync.mergeDocument(json: future);
      expect(r.error, isNotEmpty);
      expect(store.entryCount(), 1,
          reason: 'a refused document must not have touched the ledger');
    });

    testWidgets('a truncated one does not empty the ledger', (tester) async {
      add('mine', 10);
      expect(sync.mergeDocument(json: '{"v":1,"entries":[{"id"').error,
          isNotEmpty);
      expect(store.entryCount(), 1);
    });
  });

  group('the screen', () {
    testWidgets('merges the file it is given and says what changed',
        (tester) async {
      final theirs = () {
        add('theirs', 20);
        return doc();
      }();
      store.reset();

      var changed = false;
      await show(tester,
          pick: () async => theirs, onChanged: () => changed = true);
      await tester.tap(find.byKey(const Key('sync-merge')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('sync-flash')), findsOneWidget);
      expect(changed, isTrue, reason: 'the ledger changed and has to be saved');
      expect(store.entryCount(), 1);
    });

    testWidgets('a cancelled pick says nothing rather than reporting failure',
        (tester) async {
      await show(tester, pick: () async => null);
      await tester.tap(find.byKey(const Key('sync-merge')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('sync-flash')), findsNothing);
    });

    testWidgets('a file it cannot read is said so, not swallowed',
        (tester) async {
      await show(tester, pick: () async => 'not a document');
      await tester.tap(find.byKey(const Key('sync-merge')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('sync-flash')), findsOneWidget);
    });

    testWidgets('an identical file says so rather than claiming a change',
        (tester) async {
      add('a', 10);
      final same = doc();

      await show(tester, pick: () async => same);
      await tester.tap(find.byKey(const Key('sync-merge')));
      await tester.pumpAndSettle();

      expect(find.textContaining('没有变化'), findsOneWidget);
    });

    testWidgets('writes a document out', (tester) async {
      add('a', 10);
      String? written;
      await show(tester, share: (p) async => written = p);

      await tester.tap(find.byKey(const Key('sync-write')));
      await tester.pumpAndSettle();

      expect(written, isNotNull);
      expect(written, endsWith('.json'));
    });

    testWidgets('reading comes before writing on the screen', (tester) async {
      // Not decoration. Write-then-read is the order that loses the other
      // device's entries, and a screen that puts the write button first is a
      // screen that suggests it.
      await show(tester);
      final merge = tester.getTopLeft(find.byKey(const Key('sync-merge')));
      final write = tester.getTopLeft(find.byKey(const Key('sync-write')));
      expect(merge.dy, lessThan(write.dy));
    });

    testWidgets('says what it does not sync', (tester) async {
      await show(tester);
      final limits = tester
          .widget<Text>(find.byKey(const Key('sync-limits')))
          .data!;
      expect(limits, contains('汇率'));
      expect(limits, contains('账户'),
          reason: 'the account rename limit is real and has to be stated');
    });

    testWidgets('English throughout when the app is in English',
        (tester) async {
      await show(tester, zh: false);
      expect(find.text('Choose a file'), findsOneWidget);
      expect(find.text('Write the file'), findsOneWidget);
    });
  });
}
