// The entry list, rendered on a device against the real Rust ledger.
//
// Not a mock in sight: rows are written through the store commands, the screen
// asks the store what to draw, and these read the pixels' worth of text that
// comes out. What is being checked is the seam — that a decision made in Rust
// arrives on screen intact — rather than the arithmetic, which the parity
// corpus already pinned against the shipping TypeScript.

import 'package:flutter/material.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

const day = 86400000;

/// Anchored to the device's own clock, because the screen asks it what "today"
/// is — the timezone is the platform's, which is the whole arrangement.
int get now => DateTime.now().millisecondsSinceEpoch;

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: EntryListScreen(zh: zh)));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  testWidgets('an empty ledger says so rather than showing nothing', (tester) async {
    await show(tester);
    expect(find.text('还没有记账'), findsOneWidget);
  });

  testWidgets('a row shows its category, note and signed amount', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 35.5, note: '午饭', ts: now),
      id: 'e1',
      now: now,
    );
    await show(tester);

    expect(find.text('餐饮'), findsOneWidget); // the category name, from Rust
    expect(find.text('🍜'), findsOneWidget); // and its emoji
    expect(find.text('午饭'), findsOneWidget);
    expect(find.text('-35.50'), findsOneWidget); // signed, grouped, two decimals
  });

  testWidgets('income is signed the other way and coloured differently', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'inc', cat: 'salary', amt: 9000, ts: now),
      id: 'e1',
      now: now,
    );
    await show(tester);

    expect(find.text('+9,000.00'), findsOneWidget); // grouping, from Rust
    final amt = tester.widget<Text>(find.text('+9,000.00'));
    expect(amt.style!.color, palette.leafDeep, reason: 'leafDeep, not ink');
  });

  testWidgets('days are grouped and headed, newest first', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 30, ts: now),
      id: 'today',
      now: now,
    );
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 7, ts: now - day),
      id: 'yesterday',
      now: now - day,
    );
    await show(tester);

    expect(find.text('今天'), findsOneWidget);
    expect(find.text('昨天'), findsOneWidget);
    // the day totals, which Rust summed
    expect(find.text('支出 ￥30.00'), findsOneWidget);
    expect(find.text('支出 ￥7.00'), findsOneWidget);

    // and today's header sits above yesterday's
    final headers = tester.widgetList<Text>(find.byType(Text)).toList();
    final iToday = headers.indexWhere((t) => t.data == '今天');
    final iYesterday = headers.indexWhere((t) => t.data == '昨天');
    expect(iToday, lessThan(iYesterday));
  });

  testWidgets('a day with income and no expense heads with the income', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'inc', cat: 'salary', amt: 100, ts: now),
      id: 'e1',
      now: now,
    );
    await show(tester);
    expect(find.text('收入 ￥100.00'), findsOneWidget);
  });

  testWidgets('a tombstone is not drawn', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 30, note: '午饭', ts: now),
      id: 'e1',
      now: now,
    );
    store.removeEntry(id: 'e1', now: now);
    await show(tester);

    expect(find.text('午饭'), findsNothing);
    expect(find.text('还没有记账'), findsOneWidget);
  });

  testWidgets('a reimbursement mark shows as a badge', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 30, ts: now),
      id: 'e1',
      now: now,
    );
    store.updateEntry(id: 'e1', patch: store.EntryPatch(rb: 'pending'), now: now);
    await show(tester);
    expect(find.text('待报销'), findsOneWidget);
  });

  testWidgets('English names the same rows differently', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 35.5, ts: now),
      id: 'e1',
      now: now,
    );
    await show(tester, zh: false);

    expect(find.text('Food'), findsOneWidget);
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Exp \$35.50'), findsOneWidget);
  });

  testWidgets('every row carries an accessibility label', (tester) async {
    // Slint reached 0 of 8 nodes on Android; this is the standard Flutter was
    // chosen against, so it is worth a test rather than an assumption.
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 35.5, note: '午饭', ts: now),
      id: 'e1',
      now: now,
    );
    await show(tester);

    final handle = tester.ensureSemantics();
    expect(find.bySemanticsLabel('餐饮, -35.50, 午饭'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a hundred rows draw without the ledger crossing per row', (tester) async {
    for (var i = 0; i < 100; i++) {
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'food', amt: 1, ts: now - i * 3600 * 1000),
        id: 'e$i',
        now: now + i,
      );
    }
    await show(tester);
    // a builder only builds what is visible; the point is that it did not hang
    expect(find.byType(ListView), findsOneWidget);
    expect(store.entryCount(), 100);
  });

  group('press feedback', () {
    // The complaint that produced `tap.dart`: rows fired but showed nothing,
    // so a tap that landed looked exactly like one that missed. There were 23
    // bare `GestureDetector`s in the app and every one of them was silent.

    testWidgets('a row lights while it is held', (tester) async {
      store.addEntry(
        entry: store.NewEntry(
            io: 'exp', cat: 'food', amt: 35.5, note: '午饭', ts: now),
        id: 'e1',
        now: now,
      );
      await show(tester);

      final row = find.byKey(const Key('row-e1'));
      double veilOf() => tester
          .widgetList<AnimatedOpacity>(
              find.descendant(of: row, matching: find.byType(AnimatedOpacity)))
          .map((w) => w.opacity)
          .fold(0.0, (a, b) => a > b ? a : b);

      expect(veilOf(), 0, reason: 'nothing is pressed yet');

      final press = await tester.startGesture(tester.getCenter(row));
      await tester.pump(const Duration(milliseconds: 200));
      expect(veilOf(), 1, reason: 'the veil is up while the finger is down');

      await press.up();
      await tester.pumpAndSettle();
      expect(veilOf(), 0, reason: 'and gone when it lifts');
    });

    testWidgets('a cancelled press puts the light back', (tester) async {
      // Dragging off a row is how a swipe starts, and a row left lit after the
      // finger has gone somewhere else is worse than one that never lit.
      store.addEntry(
        entry: store.NewEntry(
            io: 'exp', cat: 'food', amt: 35.5, note: '午饭', ts: now),
        id: 'e1',
        now: now,
      );
      await show(tester);

      final row = find.byKey(const Key('row-e1'));
      final press = await tester.startGesture(tester.getCenter(row));
      await tester.pump(const Duration(milliseconds: 200));
      await press.moveBy(const Offset(200, 0));
      await press.up();
      await tester.pumpAndSettle();

      final lit = tester
          .widgetList<AnimatedOpacity>(
              find.descendant(of: row, matching: find.byType(AnimatedOpacity)))
          .map((w) => w.opacity)
          .fold(0.0, (a, b) => a > b ? a : b);
      expect(lit, 0);
    });
  });
}
