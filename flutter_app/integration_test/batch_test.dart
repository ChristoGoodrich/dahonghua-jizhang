// 批量处理 — selecting rows and doing one thing to all of them.
//
// The screen owns which rows are ticked and nothing else. Every judgement
// below — what the selection adds up to, whether 改分类 is offered, which of
// the ticked rows a claim change actually writes — belongs to
// `dahonghua_core::batch`, which has its own unit tests. What these check is
// the seam: that the answer arrives on screen, and that the button wired to it
// writes the rows it said it would.
//
// The one thing worth stating plainly, because it is the bug this feature
// could most easily ship with: **a batch reports what it WROTE, not what was
// selected.** Marking four rows 待报销 where one is income and one is already
// pending writes two, and a screen that said "4" would be hiding exactly the
// thing the user needs to know.

import 'package:flutter/material.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/tap.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void spend(String id, double amt, {String? note, String cat = 'food'}) =>
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, note: note, ts: now),
      id: id,
      now: now,
    );

void earn(String id, double amt, {String? note}) => store.addEntry(
  entry: store.NewEntry(
    io: 'inc',
    cat: 'salary',
    amt: amt,
    note: note,
    ts: now,
  ),
  id: id,
  now: now,
);

Future<void> show(WidgetTester tester) async {
  await tester.pumpWidget(MaterialApp(home: EntryListScreen(onChanged: () {})));
  await tester.pumpAndSettle();
}

/// Long-press a row to start selecting, the way a finger does.
Future<void> pickByLongPress(WidgetTester tester, String text) async {
  await tester.longPress(find.text(text));
  await tester.pumpAndSettle();
}

Future<void> alsoPick(WidgetTester tester, String text) async {
  await tester.tap(find.text(text));
  await tester.pumpAndSettle();
}

Future<void> tapBatch(WidgetTester tester, String id) async {
  await tester.tap(find.byKey(Key('batch-$id')));
  await tester.pumpAndSettle();
}

String countText(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('select-count'))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('entering and leaving', () {
    testWidgets('a long press starts a selection with that row in it', (
      tester,
    ) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      expect(countText(tester), '已选中 1 项');
      // The bar took the nav bar's slot.
      expect(find.byKey(const Key('selection-bar')), findsOneWidget);
      expect(find.byKey(const Key('batch-delete')), findsOneWidget);
    });

    testWidgets('tapping a row toggles it instead of opening it', (
      tester,
    ) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      var opened = 0;
      await tester.pumpWidget(
        MaterialApp(home: EntryListScreen(onEdit: (_) => opened++)),
      );
      await tester.pumpAndSettle();

      await pickByLongPress(tester, '午饭');
      await alsoPick(tester, '咖啡');
      expect(countText(tester), '已选中 2 项');

      // and off again
      await alsoPick(tester, '咖啡');
      expect(countText(tester), '已选中 1 项');
      expect(opened, 0, reason: 'a tap while selecting must not open the row');
    });

    /// Unticking the last row leaves the bar up. The alternative — falling out
    /// of selection — means the next tick starts with another long press,
    /// which is a trap when the user was correcting a mis-tap.
    testWidgets('unticking everything stays in the selection', (tester) async {
      spend('e1', 30, note: '午饭');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await alsoPick(tester, '午饭');
      expect(countText(tester), '已选中 0 项');
      expect(find.byKey(const Key('selection-bar')), findsOneWidget);
    });

    testWidgets('close leaves, and the ordinary header comes back', (
      tester,
    ) async {
      spend('e1', 30, note: '午饭');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await tester.tap(find.byKey(const Key('select-close')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('select-count')), findsNothing);
      expect(find.byKey(const Key('selection-bar')), findsNothing);
      expect(find.text('大红花记账'), findsOneWidget);
    });

    testWidgets('the shell is told, so its nav bar can stand down', (
      tester,
    ) async {
      spend('e1', 30, note: '午饭');
      final said = <bool>[];
      await tester.pumpWidget(
        MaterialApp(home: EntryListScreen(onSelecting: said.add)),
      );
      await tester.pumpAndSettle();

      await pickByLongPress(tester, '午饭');
      await tester.tap(find.byKey(const Key('select-close')));
      await tester.pumpAndSettle();
      expect(said, [true, false]);
    });

    testWidgets('the header button starts one too, for a finger that has not '
        'learned the gesture', (tester) async {
      spend('e1', 30, note: '午饭');
      await show(tester);

      await tester.tap(find.byKey(const Key('select-toggle')));
      await tester.pumpAndSettle();
      expect(countText(tester), '已选中 0 项');
    });
  });

  group('what the header says', () {
    /// The sums are the core's. Two implementations of one sum is how the
    /// selection header and the day header come to disagree.
    testWidgets('counts the rows and sums each side', (tester) async {
      spend('e1', 30.5, note: '午饭');
      earn('e2', 9000, note: '发薪');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await alsoPick(tester, '发薪');

      expect(countText(tester), '已选中 2 项');
      expect(find.text('支出 ￥30.50 · 收入 ￥9,000.00'), findsOneWidget);
    });

    testWidgets('全选 takes what the list is showing', (tester) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      spend('e3', 5, note: '汽水');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await tester.tap(find.byKey(const Key('select-all')));
      await tester.pumpAndSettle();
      expect(countText(tester), '已选中 3 项');

      // and the same button lets it all go again
      await tester.tap(find.byKey(const Key('select-all')));
      await tester.pumpAndSettle();
      expect(countText(tester), '已选中 0 项');
    });

    /// Not what is in the ledger. A search for 上周 that turned up four rows
    /// and then selected nine hundred would be the worst kind of surprise.
    testWidgets('全选 respects the search, not the whole ledger', (tester) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      await show(tester);

      await tester.tap(find.byKey(const Key('search-toggle')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('search-field')), '咖啡');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('select-toggle')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('select-all')));
      await tester.pumpAndSettle();
      expect(countText(tester), '已选中 1 项');
    });
  });

  group('which buttons are live', () {
    /// A category belongs to one side of the ledger, so recategorising a
    /// mixed selection has no answer. The button dims rather than doing
    /// something arbitrary.
    testWidgets('改分类 needs one side of the ledger', (tester) async {
      spend('e1', 30, note: '午饭');
      earn('e2', 9000, note: '发薪');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      expect(enabled(tester, 'cat'), isTrue);

      await alsoPick(tester, '发薪');
      expect(enabled(tester, 'cat'), isFalse, reason: 'mixed has no category');
    });

    testWidgets('报销 needs an expense in the selection', (tester) async {
      earn('e1', 9000, note: '发薪');
      await show(tester);

      await pickByLongPress(tester, '发薪');
      expect(
        enabled(tester, 'claim'),
        isFalse,
        reason: 'there is no claiming income back',
      );
    });

    testWidgets('更多 is the single-row sheet, so it needs a single row', (
      tester,
    ) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      expect(enabled(tester, 'more'), isTrue);
      await alsoPick(tester, '咖啡');
      expect(enabled(tester, 'more'), isFalse);
    });

    testWidgets('nothing ticked, nothing to do', (tester) async {
      spend('e1', 30, note: '午饭');
      await show(tester);

      await tester.tap(find.byKey(const Key('select-toggle')));
      await tester.pumpAndSettle();
      expect(enabled(tester, 'delete'), isFalse);
      expect(enabled(tester, 'cat'), isFalse);
    });
  });

  group('doing it', () {
    testWidgets('deleting the lot, undoably', (tester) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      spend('e3', 5, note: '汽水');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await alsoPick(tester, '咖啡');
      await tapBatch(tester, 'delete');
      // it asks, and names what it is about to take
      expect(find.text('删除选中的 2 笔？'), findsOneWidget);
      expect(store.liveEntries().length, 3, reason: 'nothing gone yet');
      await tester.tap(find.byKey(const Key('entry-delete-ok')));
      await tester.pumpAndSettle();

      expect(store.liveEntries().length, 1);
      expect(find.text('汽水'), findsOneWidget);
      // and it left the selection behind it
      expect(find.byKey(const Key('select-count')), findsNothing);

      await tester.tap(find.text('撤销'));
      await tester.pumpAndSettle();
      expect(store.liveEntries().length, 3);
    });

    testWidgets('moving several rows into one category', (tester) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await alsoPick(tester, '咖啡');
      await tapBatch(tester, 'cat');
      await tester.tap(find.byKey(const Key('batch-cat-trans')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'e1')!.cat, 'trans');
      expect(store.getEntry(id: 'e2')!.cat, 'trans');
    });

    testWidgets('claiming several expenses at once', (tester) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await alsoPick(tester, '咖啡');
      await tapBatch(tester, 'claim');
      await tester.tap(find.byKey(const Key('batch-claim-pending')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'e1')!.rb, 'pending');
      expect(store.getEntry(id: 'e2')!.rb, 'pending');
    });

    testWidgets('and settling them, and dropping the claim again', (
      tester,
    ) async {
      spend('e1', 30, note: '午饭');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await tapBatch(tester, 'claim');
      await tester.tap(find.byKey(const Key('batch-claim-done')));
      await tester.pumpAndSettle();
      expect(store.getEntry(id: 'e1')!.rb, 'done');

      await pickByLongPress(tester, '午饭');
      await tapBatch(tester, 'claim');
      await tester.tap(find.byKey(const Key('batch-claim-clear')));
      await tester.pumpAndSettle();
      expect(store.getEntry(id: 'e1')!.rb, isNull);
    });

    /// The whole reason `core::batch` exists. Four rows selected, two written:
    /// income cannot be claimed and a row already pending is left alone so its
    /// stamp does not jump ahead of another device's real edit. The screen
    /// says two, because two is what happened.
    testWidgets('a batch reports what it wrote, not what was selected', (
      tester,
    ) async {
      spend('e1', 30, note: '午饭');
      spend('e2', 12, note: '咖啡');
      spend('e3', 5, note: '汽水');
      earn('e4', 9000, note: '发薪');
      store.updateEntry(
        id: 'e3',
        patch: store.EntryPatch(rb: 'pending'),
        now: now,
      );
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await tester.tap(find.byKey(const Key('select-all')));
      await tester.pumpAndSettle();
      expect(countText(tester), '已选中 4 项');

      await tapBatch(tester, 'claim');
      await tester.tap(find.byKey(const Key('batch-claim-pending')));
      await tester.pumpAndSettle();

      expect(find.text('已修改 2 项'), findsOneWidget);
      expect(
        store.getEntry(id: 'e4')!.rb,
        isNull,
        reason: 'income is not a claim',
      );
    });

    testWidgets('a batch that would change nothing says so', (tester) async {
      spend('e1', 30, note: '午饭', cat: 'food');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await tapBatch(tester, 'cat');
      await tester.tap(find.byKey(const Key('batch-cat-food')));
      await tester.pumpAndSettle();

      expect(find.text('没有需要修改的'), findsOneWidget);
    });

    /// A drag across a row is how a finger scrolls a list it is also
    /// selecting from. A swipe that deleted one mid-selection would be the
    /// most expensive gesture in the app.
    testWidgets('the swipe-to-delete is off while selecting', (tester) async {
      spend('e1', 30, note: '午饭');
      await show(tester);

      await pickByLongPress(tester, '午饭');
      await tester.drag(find.text('午饭'), const Offset(-500, 0));
      await tester.pumpAndSettle();

      expect(store.liveEntries().length, 1);
    });
  });
}

/// Whether a selection-bar button is live.
///
/// Read off the `Tap` rather than off a colour: a dimmed button and a live one
/// differ by an alpha, and a test that compared alphas would pass on a button
/// that was drawn dim and still fired.
bool enabled(WidgetTester tester, String id) {
  final tap = tester.widget<Tap>(find.byKey(Key('batch-$id')));
  return tap.onTap != null;
}
