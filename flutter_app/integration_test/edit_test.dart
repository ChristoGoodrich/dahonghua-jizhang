// Correcting the ledger, on a device.
//
// A ledger you cannot fix is worse than one you cannot chart, and these are the
// two ways to fix one: swipe a row away, or tap it and change it. Both go
// through the same Rust the record sheet does — `remove_entry` returns the
// token that reverses it, and `save_form` with an `editId` patches in place
// rather than writing a second row.

import 'package:flutter/material.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/toast.dart';
import 'package:flutter_app/record_sheet.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void add(String id, double amt, {String? note, String cat = 'food', int? ts}) {
  final t = ts ?? now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, note: note, ts: t),
    id: id,
    now: t,
  );
}

Future<void> press(WidgetTester tester, String k) async {
  await tester.tap(find.byKey(Key('key-$k')));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('swipe to delete', () {
    testWidgets('tombstones the row and takes it off the list', (tester) async {
      add('e1', 35.5, note: '午饭');
      var changed = 0;
      await tester.pumpWidget(
        MaterialApp(home: EntryListScreen(onChanged: () => changed++)),
      );
      await tester.pumpAndSettle();

      await tester.drag(find.byKey(const Key('row-e1')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('entry-delete-ok')));
      await tester.pumpAndSettle();

      expect(find.text('午饭'), findsNothing);
      expect(store.liveEntries(), isEmpty);
      // a tombstone, not a removal — the row still syncs
      expect(store.entryCount(), 1);
      // and the caller is told, so the file gets written
      expect(changed, 1);
    });

    testWidgets('undo restores it as a fresh write, not a replay', (
      tester,
    ) async {
      add('e1', 35.5, note: '午饭', ts: 1000);
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();

      await tester.drag(find.byKey(const Key('row-e1')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('entry-delete-ok')));
      await tester.pumpAndSettle();
      expect(find.text('撤销'), findsOneWidget);

      await tester.tap(find.text('撤销'));
      await tester.pumpAndSettle();

      expect(store.liveEntries(), hasLength(1));
      expect(find.text('午饭'), findsOneWidget);
      // stamped now rather than restored to its old time: an old stamp sits
      // below the push watermark and the undo would never reach the cloud
      expect(store.getEntry(id: 'e1')!.updatedAt, greaterThan(1000));
      expect(store.getEntry(id: 'e1')!.deletedAt, isNull);
    });

    /// A swipe is the cheapest gesture in the list, and one made on the way
    /// to scrolling used to take the row with it. It asks now, says which row,
    /// and a no puts the row back where it was.
    testWidgets('a swipe asks first, and a no keeps the row', (tester) async {
      add('e1', 35.5, note: '午饭');
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();

      await tester.drag(find.byKey(const Key('row-e1')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('entry-delete-confirm')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('entry-delete-confirm')),
          matching: find.textContaining('午饭'),
        ),
        findsOneWidget,
        reason: 'it says which row',
      );
      expect(store.liveEntries(), hasLength(1), reason: 'nothing gone yet');

      await tester.tap(find.byKey(const Key('entry-delete-cancel')));
      await tester.pumpAndSettle();
      expect(store.liveEntries(), hasLength(1));
      expect(find.text('午饭'), findsOneWidget, reason: 'the row is back');
      expect(find.byType(ToastCapsule), findsNothing);
    });

    /// The notice is the phone's shape — a capsule with the flower, the words
    /// and 撤销 — not a slab across the screen.
    testWidgets('the notice after a delete is a capsule with 撤销', (
      tester,
    ) async {
      add('e1', 35.5, note: '午饭');
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();
      await tester.drag(find.byKey(const Key('row-e1')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('entry-delete-ok')));
      await tester.pumpAndSettle();

      final capsule = find.byType(ToastCapsule);
      expect(capsule, findsOneWidget);
      expect(
        find.descendant(of: capsule, matching: find.text('已删除')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: capsule, matching: find.text('撤销')),
        findsOneWidget,
      );
      final screen = tester.getSize(find.byType(EntryListScreen)).width;
      expect(
        tester.getSize(capsule).width,
        lessThan(screen * 0.7),
        reason: 'sized to its words, not the width of the screen',
      );

      await tester.tap(find.byKey(const Key('deleted-undo')));
      await tester.pumpAndSettle();
      expect(store.liveEntries(), hasLength(1));
      expect(capsule, findsNothing, reason: 'an undo takes the notice away');
    });

    testWidgets('the row that is swiped is the row that goes', (tester) async {
      add('a', 1, note: 'first');
      add('b', 2, note: 'second');
      add('c', 3, note: 'third');
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();

      await tester.drag(find.byKey(const Key('row-b')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('entry-delete-ok')));
      await tester.pumpAndSettle();

      expect(store.liveEntries().map((e) => e.id), unorderedEquals(['a', 'c']));
      expect(find.text('second'), findsNothing);
      expect(find.text('first'), findsOneWidget);
      expect(find.text('third'), findsOneWidget);
    });
  });

  group('tap to edit', () {
    testWidgets('asks the shell to open the row', (tester) async {
      add('e1', 35.5, note: '午饭');
      String? asked;
      await tester.pumpWidget(
        MaterialApp(home: EntryListScreen(onEdit: (id) => asked = id)),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('午饭'));
      await tester.pumpAndSettle();
      expect(asked, 'e1');
    });

    testWidgets('the sheet opens on the row it was given', (tester) async {
      add('e1', 35.5, note: '午饭', cat: 'trans');
      await tester.pumpWidget(
        const MaterialApp(home: RecordSheet(editId: 'e1')),
      );
      await tester.pumpAndSettle();

      expect(find.text('编辑'), findsOneWidget); // not 记一笔
      expect(find.byKey(const Key('amount-expr')), findsOneWidget);
      final amt = tester
          .widget<Text>(find.byKey(const Key('amount-expr')))
          .data;
      expect(amt, '35.5');
      // the note comes back in the field, not just in the form
      expect(find.text('午饭'), findsOneWidget);
    });

    testWidgets('saving patches the row in place rather than adding one', (
      tester,
    ) async {
      add('e1', 35.5, note: '午饭');
      await tester.pumpWidget(
        const MaterialApp(home: RecordSheet(editId: 'e1')),
      );
      await tester.pumpAndSettle();

      await press(tester, 'clear');
      await press(tester, '9');
      await press(tester, '9');
      await press(tester, 'save');

      expect(store.entryCount(), 1); // one row, not two
      final e = store.getEntry(id: 'e1')!;
      expect(e.amt, 99);
      expect(e.note, '午饭'); // untouched fields stay
    });

    testWidgets('an untouched date is not restamped', (tester) async {
      // patching a date nobody edited would stamp fieldTs.ts, and that stamp
      // is what the sync merge uses to decide whose version of the date wins
      add('e1', 10, ts: 1700000000000);
      await tester.pumpWidget(
        const MaterialApp(home: RecordSheet(editId: 'e1')),
      );
      await tester.pumpAndSettle();

      await press(tester, 'clear');
      await press(tester, '5');
      await press(tester, 'save');

      expect(store.getEntry(id: 'e1')!.ts, 1700000000000);
    });

    testWidgets('an edit does not clear the form the way 再记 does', (
      tester,
    ) async {
      add('e1', 35.5);
      await tester.pumpWidget(
        const MaterialApp(home: RecordSheet(editId: 'e1')),
      );
      await tester.pumpAndSettle();
      await press(tester, 'save');

      // still showing what was saved, rather than a blank sheet — there is no
      // "next one of the same kind" when the thing being typed already exists
      final amt = tester
          .widget<Text>(find.byKey(const Key('amount-expr')))
          .data;
      expect(amt, '35.5');
    });

    testWidgets('switching target reloads the fields', (tester) async {
      add('a', 11);
      add('b', 22);
      await tester.pumpWidget(
        const MaterialApp(home: RecordSheet(editId: 'a')),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('amount-expr'))).data,
        '11',
      );

      await tester.pumpWidget(
        const MaterialApp(home: RecordSheet(editId: 'b')),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('amount-expr'))).data,
        '22',
      );
    });
  });
}
