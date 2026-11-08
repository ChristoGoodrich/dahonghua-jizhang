// Correcting the ledger, on a device.
//
// A ledger you cannot fix is worse than one you cannot chart, and these are the
// two ways to fix one: swipe a row away, or tap it and change it. Both go
// through the same Rust the record sheet does — `remove_entry` returns the
// token that reverses it, and `save_form` with an `editId` patches in place
// rather than writing a second row.

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/main.dart' show App;
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
      await tester.tap(find.byKey(const Key('row-delete-e1')));
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
      await tester.tap(find.byKey(const Key('row-delete-e1')));
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
    /// to scrolling used to take the row with it; then it asked, about a row
    /// already gone. Now it opens the row on 删除 and takes nothing: the
    /// press is the decision, and no dialog asks about a delete 撤销 can
    /// take back.
    testWidgets('a swipe opens the row on 删除 and deletes nothing', (
      tester,
    ) async {
      add('e1', 35.5, note: '午饭');
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();
      final delete = find.byKey(const Key('row-delete-e1'));
      expect(delete, findsNothing, reason: 'closed, the row has no button');

      await tester.drag(find.byKey(const Key('row-e1')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      expect(delete.hitTestable(), findsOneWidget);
      expect(
        find.descendant(of: delete, matching: find.text('删除')),
        findsOneWidget,
      );
      expect(find.byType(AlertDialog), findsNothing, reason: 'nothing asks');
      expect(store.liveEntries(), hasLength(1), reason: 'nothing gone yet');
      expect(find.byType(ToastCapsule), findsNothing);
    });

    testWidgets('a short swipe springs back shut', (tester) async {
      add('e1', 35.5, note: '午饭');
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();

      // Slowly, so it is the distance that decides and not a flick.
      await tester.timedDrag(
        find.byKey(const Key('row-e1')),
        const Offset(-24, 0),
        const Duration(milliseconds: 600),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('row-delete-e1')), findsNothing);
    });

    testWidgets('a tap on the open row shuts it, and opens nothing', (
      tester,
    ) async {
      add('e1', 35.5, note: '午饭');
      final opened = <String>[];
      await tester.pumpWidget(
        MaterialApp(home: EntryListScreen(onEdit: opened.add)),
      );
      await tester.pumpAndSettle();
      await tester.drag(find.byKey(const Key('row-e1')), const Offset(-500, 0));
      await tester.pumpAndSettle();

      await tester.tap(find.text('午饭'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('row-delete-e1')), findsNothing);
      expect(opened, isEmpty, reason: 'the tap answered the open row');
      expect(store.liveEntries(), hasLength(1));

      await tester.tap(find.text('午饭'));
      await tester.pumpAndSettle();
      expect(opened, ['e1'], reason: 'shut, the row opens its entry again');
    });

    testWidgets('a finger on another row shuts the open one', (tester) async {
      add('a', 1, note: 'first');
      add('b', 2, note: 'second');
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();

      await tester.drag(find.byKey(const Key('row-a')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('row-delete-a')), findsOneWidget);

      // A swipe too short to open b still shuts a.
      await tester.timedDrag(
        find.byKey(const Key('row-b')),
        const Offset(-24, 0),
        const Duration(milliseconds: 600),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('row-delete-a')), findsNothing);
      expect(find.byKey(const Key('row-delete-b')), findsNothing);

      await tester.drag(find.byKey(const Key('row-a')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      await tester.drag(find.byKey(const Key('row-b')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('row-delete-b')), findsOneWidget);
      expect(find.byKey(const Key('row-delete-a')), findsNothing);
    });

    testWidgets('scrolling the list shuts the open row', (tester) async {
      // Enough rows that the list scrolls, on whichever phone this runs.
      for (var i = 0; i < 40; i++) {
        add('r$i', i + 1.0, note: 'row $i', ts: now - i * 3600000);
      }
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();
      final row = find.byKey(const Key('row-r0'));
      await tester.drag(row, const Offset(-500, 0));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('row-delete-r0')), findsOneWidget);

      await tester.drag(find.text('row 3'), const Offset(0, -120));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('row-delete-r0')), findsNothing);
      expect(store.liveEntries(), hasLength(40));
    });

    testWidgets('a screen reader deletes without the swipe', (tester) async {
      final semantics = tester.ensureSemantics();
      add('e1', 35.5, note: '午饭');
      await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
      await tester.pumpAndSettle();

      final node = find.semantics.byPredicate(
        (n) =>
            n.label.contains('午饭') &&
            n.getSemanticsData().hasAction(SemanticsAction.customAction),
      );
      expect(node, findsOne, reason: 'the row offers 删除 on its own node');
      tester.semantics.customAction(
        node,
        const CustomSemanticsAction(label: '删除'),
      );
      await tester.pumpAndSettle();
      expect(store.liveEntries(), isEmpty);
      expect(find.byKey(const Key('deleted-undo')), findsOneWidget);
      semantics.dispose();
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
      await tester.tap(find.byKey(const Key('row-delete-e1')));
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
      await tester.tap(find.byKey(const Key('row-delete-b')));
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

    testWidgets('an edit is finished by its save, the sheet goes', (
      tester,
    ) async {
      add('e1', 35.5);
      await tester.pumpWidget(
        const MaterialApp(home: RecordSheet(editId: 'e1')),
      );
      await tester.pumpAndSettle();
      await press(tester, 'save');

      // there is no "next one of the same kind" when the thing being typed
      // already exists — the edit is done, and so is the sheet
      expect(find.byType(RecordSheet), findsNothing);
      expect(store.getEntry(id: 'e1')!.amt, 35.5);
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
  group('删除 and 再记一笔 in an edit', () {
    // The shipping app opened a row on a detail sheet with both; the port
    // opened it straight into this one, which had neither.
    String amountShown(WidgetTester tester) =>
        tester.widget<Text>(find.byKey(const Key('amount-expr'))).data!;

    testWidgets("are an edit's, and not a new entry's", (tester) async {
      add('e1', 35.5);
      await tester.pumpWidget(
        MaterialApp(
          home: RecordSheet(editId: 'e1', onDelete: () {}, onDuplicate: () {}),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('record-delete')), findsOneWidget);
      expect(find.byKey(const Key('record-dupe')), findsOneWidget);

      await tester.pumpWidget(
        MaterialApp(
          key: const ValueKey('new'),
          home: RecordSheet(onDelete: () {}, onDuplicate: () {}),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('record-delete')), findsNothing);
      expect(find.byKey(const Key('record-dupe')), findsNothing);
    });

    /// 删除 in the edit is a press on a labelled button, and 撤销 follows
    /// it, so it does not ask (see the swipe's tests above).
    testWidgets('删除 goes without a question', (tester) async {
      add('e1', 35.5, note: '午饭');
      var deleted = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: RecordSheet(editId: 'e1', onDelete: () => deleted++),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('record-delete')));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(deleted, 1);
    });

    testWidgets('a duplicate is a new entry on the same fields, today', (
      tester,
    ) async {
      final lastWeek = now - 7 * 86400000;
      add('e1', 35.5, note: '午饭', cat: 'trans', ts: lastWeek);
      await tester.pumpWidget(
        const MaterialApp(home: RecordSheet(dupeId: 'e1')),
      );
      await tester.pumpAndSettle();

      expect(find.text('记一笔'), findsOneWidget); // not 编辑
      expect(amountShown(tester), '35.5');
      expect(find.text('午饭'), findsOneWidget);
      await press(tester, 'save');

      final live = store.liveEntries();
      expect(live, hasLength(2), reason: 'a new row, the source untouched');
      final made = live.firstWhere((e) => e.id != 'e1');
      expect((made.cat, made.amt, made.note), ('trans', 35.5, '午饭'));
      expect(made.ts, greaterThan(lastWeek + 6 * 86400000));
      expect(store.getEntry(id: 'e1')!.ts, lastWeek);
    });

    testWidgets('through the shell: 删除 goes, with 撤销', (tester) async {
      add('e1', 35.5, note: '午饭');
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();

      await tester.tap(find.text('午饭'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('record-delete')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('key-save')), findsNothing, reason: 'closed');
      expect(store.liveEntries(), isEmpty);
      expect(find.byKey(const Key('deleted-toast')), findsOneWidget);

      await tester.tap(find.byKey(const Key('deleted-undo')));
      await tester.pumpAndSettle();
      expect(store.liveEntries().single.id, 'e1');
      expect(find.text('午饭'), findsOneWidget);
    });

    testWidgets('through the shell: 再记一笔 opens a new one on its fields', (
      tester,
    ) async {
      add('e1', 35.5, note: '午饭');
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();

      await tester.tap(find.text('午饭'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('record-dupe')));
      await tester.pumpAndSettle();

      expect(find.text('记一笔'), findsOneWidget);
      expect(amountShown(tester), '35.5');
      await press(tester, 'save');

      expect(store.liveEntries(), hasLength(2));
    });
  });
}
