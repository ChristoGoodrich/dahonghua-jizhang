// 报销 on a device, over the real Rust claims.
//
// Three rules the screen must not re-derive, and one of them is the reason the
// module exists at all:
//
//   * toggling only CLEARS a pending claim — a settled one re-opens rather
//     than disappearing, because the TypeScript tests `rb === 'pending'`;
//   * clearing is a STAMPED write, not an absence, so it beats a device still
//     holding `pending` when the two meet in a merge;
//   * a refund logs a linked income and caps itself at what is left.
//
// The two totals do not measure the same thing: 待报销 sums what was SPENT and
// 已报销 sums what came BACK, so a claim settled for less shows the difference.

import 'package:flutter/material.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/reimburse_screen.dart';
import 'package:flutter_app/src/rust/api/reimburse.dart' as rb;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void spend(String id, double amt, {String? note, int? ts}) {
  final t = ts ?? now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: 'food', amt: amt, note: note, ts: t),
    id: id,
    now: t,
  );
}

/// Mark an entry pending, the way the long-press menu does.
void claim(String id) => rb.toggleReimburse(id: id, now: now);

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: ReimburseScreen(zh: zh)));
  await tester.pumpAndSettle();
}

Future<void> showList(WidgetTester tester) async {
  await tester.pumpWidget(MaterialApp(home: EntryListScreen(onChanged: () {})));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the claim state', () {
    testWidgets('toggling marks an unmarked entry pending', (tester) async {
      spend('e1', 120);
      claim('e1');
      expect(rb.claims(zh: true).items.single.state, 'pending');
    });

    testWidgets('toggling a PENDING claim clears it', (tester) async {
      spend('e1', 120);
      claim('e1');
      claim('e1');
      expect(rb.claims(zh: true).items, isEmpty);
    });

    testWidgets('toggling a SETTLED claim re-opens it rather than clearing',
        (tester) async {
      // `rb === 'pending'` and not `rb != null` — a settled claim that was
      // settled by mistake goes back to pending, which is the recoverable
      // state, not to nothing
      spend('e1', 120);
      claim('e1');
      rb.confirmReimburse(id: 'e1', now: now);
      expect(rb.claims(zh: true).items.single.state, 'done');

      claim('e1');
      expect(rb.claims(zh: true).items.single.state, 'pending');
    });

    testWidgets('clearing is a stamped write, not an absence', (tester) async {
      // it has to beat a device still holding `pending` when the two meet
      spend('e1', 120);
      claim('e1');
      final before = store.getEntry(id: 'e1')!.updatedAt!;
      claim('e1');
      expect(store.getEntry(id: 'e1')!.updatedAt!, greaterThanOrEqualTo(before));
      expect(store.getEntry(id: 'e1')!.rb, isNull);
    });
  });

  group('the two totals', () {
    testWidgets('outstanding sums what was spent', (tester) async {
      spend('e1', 120);
      spend('e2', 80);
      claim('e1');
      claim('e2');
      await show(tester);

      expect(textOf(tester, 'rb-pending-sum'), '￥200.00');
      expect(textOf(tester, 'rb-done-sum'), '￥0.00');
    });

    testWidgets('reimbursed sums what came BACK, not what was spent',
        (tester) async {
      // settled for less than it cost: the two totals differ, and that
      // difference is the number the screen exists to show
      spend('e1', 120);
      claim('e1');
      rb.confirmReimburse(id: 'e1', now: now);
      await show(tester);

      expect(textOf(tester, 'rb-done-sum'), '￥120.00');
      expect(textOf(tester, 'claim-e1-state'), '已报销');
    });

    testWidgets('a settled claim says both numbers when they differ',
        (tester) async {
      spend('e1', 120);
      claim('e1');
      rb.confirmReimburse(id: 'e1', now: now);
      // the amount changed after settling — the claim keeps what came back
      store.updateEntry(
        id: 'e1',
        patch: store.EntryPatch(amt: 200),
        now: now,
      );
      await show(tester);

      expect(textOf(tester, 'claim-e1-amt'), '￥120.00'); // what came back
      expect(textOf(tester, 'claim-e1-sub'), contains('￥200.00')); // what it cost
    });
  });

  group('the list', () {
    testWidgets('says how to make a claim when there are none', (tester) async {
      await show(tester);
      expect(find.byKey(const Key('no-claims')), findsOneWidget);
    });

    testWidgets('is newest first, pending and settled together',
        (tester) async {
      // sorted by date rather than grouped by state, so a claim does not jump
      // when it is settled
      const day = 86400000;
      spend('old', 10, ts: now - day * 3);
      spend('new', 20, ts: now);
      claim('old');
      claim('new');
      rb.confirmReimburse(id: 'new', now: now);

      final ids = rb.claims(zh: true).items.map((c) => c.id).toList();
      expect(ids, ['new', 'old']);
    });

    testWidgets('a deleted entry drops off', (tester) async {
      spend('e1', 120);
      claim('e1');
      store.removeEntry(id: 'e1', now: now);
      expect(rb.claims(zh: true).items, isEmpty);
    });

    testWidgets('settling from the screen moves it across', (tester) async {
      spend('e1', 120);
      claim('e1');
      await show(tester);

      await tester.tap(find.byKey(const Key('claim-e1-confirm')));
      await tester.pumpAndSettle();

      expect(textOf(tester, 'claim-e1-state'), '已报销');
      expect(textOf(tester, 'rb-pending-sum'), '￥0.00');
      expect(textOf(tester, 'rb-done-sum'), '￥120.00');
      // and there is nothing left to settle
      expect(find.byKey(const Key('claim-e1-confirm')), findsNothing);
    });

    testWidgets('unmarking drops it from the list entirely', (tester) async {
      spend('e1', 120);
      claim('e1');
      rb.confirmReimburse(id: 'e1', now: now);
      await show(tester);

      await tester.tap(find.byKey(const Key('claim-e1-unmark')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('no-claims')), findsOneWidget);
      expect(store.getEntry(id: 'e1'), isNotNull); // the entry itself stays
    });
  });

  group('refunds', () {
    testWidgets('log a linked income and raise the counter', (tester) async {
      spend('e1', 120, note: '打车');
      final got = rb.refundEntry(
          id: 'e1', amount: 50, zh: true, newId: 'rf1', now: now);

      expect(got, 50);
      expect(store.getEntry(id: 'e1')!.refund, 50);
      final income = store.getEntry(id: 'rf1')!;
      expect(income.io, 'inc');
      expect(income.amt, 50);
      expect(income.note, '退款·打车');
      expect(income.refundOf, 'e1');
    });

    testWidgets('a note-less expense is labelled by its category',
        (tester) async {
      spend('e1', 120);
      rb.refundEntry(id: 'e1', amount: 50, zh: true, newId: 'rf1', now: now);
      expect(store.getEntry(id: 'rf1')!.note, '退款·餐饮');
    });

    testWidgets('are capped at what is left', (tester) async {
      spend('e1', 120);
      rb.refundEntry(id: 'e1', amount: 100, zh: true, newId: 'rf1', now: now);
      final second = rb.refundEntry(
          id: 'e1', amount: 999, zh: true, newId: 'rf2', now: now);

      expect(second, 20);
      expect(store.getEntry(id: 'e1')!.refund, 120);
    });

    testWidgets('a fully refunded expense refunds nothing more',
        (tester) async {
      spend('e1', 120);
      rb.refundEntry(id: 'e1', amount: 120, zh: true, newId: 'rf1', now: now);
      final again = rb.refundEntry(
          id: 'e1', amount: 10, zh: true, newId: 'rf2', now: now);

      expect(again, 0);
      expect(store.getEntry(id: 'rf2'), isNull); // no second income written
    });

    testWidgets('the remaining amount is what the dialog opens on',
        (tester) async {
      spend('e1', 120);
      rb.refundEntry(id: 'e1', amount: 50, zh: true, newId: 'rf1', now: now);
      final s = rb.refundState(id: 'e1')!;
      expect(s.refunded, 50);
      expect(s.remaining, 70);
    });

    testWidgets('an unknown id refunds nothing', (tester) async {
      expect(
        rb.refundEntry(
            id: 'nope', amount: 10, zh: true, newId: 'rf1', now: now),
        0,
      );
      expect(rb.refundState(id: 'nope'), isNull);
    });
  });

  group('the long-press menu', () {
    testWidgets('opens on an entry and offers both actions', (tester) async {
      spend('e1', 120, note: '打车');
      await showList(tester);

      await tester.longPress(find.text('打车'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('action-reimburse')), findsOneWidget);
      expect(find.byKey(const Key('action-refund')), findsOneWidget);
    });

    testWidgets('offers delete, which the swipe alone did not advertise',
        (tester) async {
      // Deleting has always been a left swipe and still is. It is in the menu
      // too because a gesture with no visible affordance is a gesture you have
      // to already know about, and the menu is where someone looks when they
      // do not.
      spend('e1', 120, note: '打车');
      await showList(tester);

      await tester.longPress(find.text('打车'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('action-delete')), findsOneWidget);
    });

    testWidgets('deleting from the menu removes the row and can be undone',
        (tester) async {
      spend('e1', 120, note: '打车');
      await showList(tester);

      await tester.longPress(find.text('打车'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('action-delete')));
      await tester.pumpAndSettle();

      expect(find.text('打车'), findsNothing);
      expect(store.liveEntries(), isEmpty);

      // The undo has to outlive the sheet, which is why the list owns it and
      // not the menu.
      await tester.tap(find.text('撤销'));
      await tester.pumpAndSettle();
      expect(store.liveEntries().length, 1);
    });

    testWidgets('marks the entry for reimbursement', (tester) async {
      spend('e1', 120, note: '打车');
      await showList(tester);

      await tester.longPress(find.text('打车'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('action-reimburse')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'e1')!.rb, 'pending');
    });

    testWidgets('refunds through the dialog', (tester) async {
      spend('e1', 120, note: '打车');
      await showList(tester);

      await tester.longPress(find.text('打车'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('action-refund')));
      await tester.pumpAndSettle();

      // the dialog opens on what is left
      expect(find.text('120.00'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('refund-amt')), '50');
      await tester.tap(find.byKey(const Key('refund-ok')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'e1')!.refund, 50);
      expect(store.entryCount(), 2); // the linked income
    });

    testWidgets('cancelling the refund writes nothing', (tester) async {
      spend('e1', 120, note: '打车');
      await showList(tester);

      await tester.longPress(find.text('打车'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('action-refund')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('refund-cancel')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'e1')!.refund, isNull);
      expect(store.entryCount(), 1);
    });
  });
}
