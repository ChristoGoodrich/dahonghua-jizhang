// Budgets on a device, over the real Rust comparisons.
//
// The substance of this screen is three edges, and each gets a test: a cap of
// zero is *unset* rather than "nothing allowed", a percentage over 100 is not
// clamped, and a cap that cannot be parsed reads as unset rather than poisoning
// the tier.

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_app/budget_screen.dart';
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const day = 86400000;
int get now => DateTime.now().millisecondsSinceEpoch;

void spend(String id, double amt, {String cat = 'food', int? ts}) {
  final t = ts ?? now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, ts: t),
    id: id,
    now: t,
  );
}

void caps({
  double budget_ = 0,
  double daily = 0,
  int cycleStart = 1,
  Map<String, double> cats = const {},
}) {
  budget.setSettings(
    view: budget.SettingsView(
      budget: budget_,
      dailyBudget: daily,
      cycleStart: cycleStart,
      capCats: cats.keys.toList(),
      capAmounts: Float64List.fromList(cats.values.toList()),
    ),
  );
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: BudgetScreen(zh: zh)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() => store.reset());

  group('a cap of zero is unset', () {
    testWidgets('and is not drawn as a full bar', (tester) async {
      spend('a', 30);
      caps(); // nothing set
      await show(tester);

      // "no cap · spent ￥30.00", not "￥30.00 / ￥0.00 · 100%"
      expect(textOf(tester, 'tier-monthly-text'), contains('未设上限'));
      expect(find.byKey(const Key('tier-monthly-pct')), findsNothing);
    });

    testWidgets('which is a different answer from a cap with nothing spent',
        (tester) async {
      caps(budget_: 500);
      await show(tester);

      expect(textOf(tester, 'tier-monthly-pct'), '0%');
      expect(textOf(tester, 'tier-monthly-used'), '￥0.00');
      expect(textOf(tester, 'tier-monthly-text'), contains('还剩 ￥500.00'));
    });
  });

  group('over a cap', () {
    testWidgets('the percentage is not clamped', (tester) async {
      spend('a', 700);
      caps(budget_: 500);
      await show(tester);

      // 140%, because being 140% of the way through is the thing worth saying
      expect(textOf(tester, 'tier-monthly-pct'), '140%');
      expect(textOf(tester, 'tier-monthly-text'), contains('超出 ￥200.00'));
    });

    testWidgets('the bar is clamped even though the number is not',
        (tester) async {
      spend('a', 700);
      caps(budget_: 500);
      await show(tester);
      final bar = tester.widgetList<LinearProgressIndicator>(
          find.byType(LinearProgressIndicator));
      expect(bar.first.value, 1.0); // the drawing clamps; the arithmetic does not
    });

    testWidgets('the tone changes, and only once over', (tester) async {
      spend('a', 500);
      caps(budget_: 500);
      await show(tester);
      // exactly at the cap is not over — `used > limit`, not `>=`
      expect(
        tester.widget<Text>(find.byKey(const Key('tier-monthly-pct'))).style!.color,
        const Color(0xFF4E8A5F), // leafDeep
      );
      expect(textOf(tester, 'tier-monthly-text'), contains('还剩 ￥0.00'));
    });
  });

  group('the daily tier', () {
    testWidgets('counts only today', (tester) async {
      spend('today', 30, ts: now);
      spend('yesterday', 900, ts: now - day);
      caps(daily: 100);
      await show(tester);

      expect(textOf(tester, 'tier-daily-used'), '￥30.00');
      expect(textOf(tester, 'tier-daily-pct'), '30%');
    });
  });

  group('the cycle', () {
    testWidgets('is not the calendar month', (tester) async {
      // a cycle starting on the 15th runs the 15th to the 14th, so an entry
      // from three weeks ago may or may not be inside it depending on today
      final ids = <String>[];
      for (var i = 0; i < 40; i++) {
        spend('e$i', 1, ts: now - i * day);
        ids.add('e$i');
      }
      caps(budget_: 1000, cycleStart: 15);
      await show(tester);

      final used = double.parse(
          textOf(tester, 'tier-monthly-used').replaceAll(RegExp(r'[￥,]'), ''));
      // a cycle is at most 31 days, so it cannot contain all forty
      expect(used, lessThan(40));
      expect(used, greaterThan(0));
    });

    testWidgets('a cycle start outside 1..28 is clamped', (tester) async {
      // the settings screen never offers one; a restored config file can
      caps(budget_: 100, cycleStart: 31);
      expect(budget.settings().cycleStart, 28);
      caps(budget_: 100, cycleStart: 0);
      expect(budget.settings().cycleStart, 1);
    });
  });

  group('category caps', () {
    testWidgets('one row per capped category, closest to its cap first',
        (tester) async {
      spend('a', 90, cat: 'food'); // 90% of 100
      spend('b', 10, cat: 'trans'); // 20% of 50
      caps(budget_: 0, cats: {'food': 100, 'trans': 50});
      await show(tester);

      expect(textOf(tester, 'cap-food-pct'), '90%');
      expect(textOf(tester, 'cap-trans-pct'), '20%');
      // food is nearer its cap, so it is first
      final rows = tester.widgetList<Text>(find.byType(Text)).toList();
      final iFood = rows.indexWhere((t) => t.data == '90%');
      final iTrans = rows.indexWhere((t) => t.data == '20%');
      expect(iFood, lessThan(iTrans));
    });

    testWidgets('a cap of zero is dropped rather than shown at zero percent',
        (tester) async {
      spend('a', 10, cat: 'food');
      caps(cats: {'food': 0});
      await show(tester);
      expect(find.byKey(const Key('no-caps')), findsOneWidget);
    });

    testWidgets('a category with a cap and no spending still shows',
        (tester) async {
      caps(cats: {'food': 100});
      await show(tester);
      expect(textOf(tester, 'cap-food-pct'), '0%');
    });

    testWidgets('an uncapped category is not listed', (tester) async {
      spend('a', 10, cat: 'food');
      spend('b', 999, cat: 'shop'); // no cap
      caps(cats: {'food': 100});
      await show(tester);
      expect(find.byKey(const Key('cap-food-pct')), findsOneWidget);
      expect(find.byKey(const Key('cap-shop-pct')), findsNothing);
    });
  });

  group('setting a cap through the dialog', () {
    // None of the tests above opened it, and the first tap on a device crashed:
    // the controller was disposed at the showDialog call site, while the route
    // was still animating out and the TextField still depended on it.
    testWidgets('opens, takes a number, and closes without asserting',
        (tester) async {
      spend('a', 700);
      caps();
      await show(tester);

      await tester.tap(find.byKey(const Key('tier-monthly')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('cap-dialog')), findsOneWidget);

      await tester.enterText(find.byKey(const Key('cap-field')), '500');
      await tester.tap(find.byKey(const Key('cap-ok')));
      // pumped all the way out, which is where the disposal assert fired
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('cap-dialog')), findsNothing);
      expect(budget.settings().budget, 500);
      expect(textOf(tester, 'tier-monthly-pct'), '140%');
    });

    testWidgets('opens on the current cap, and empty when there is none',
        (tester) async {
      caps(budget_: 250);
      await show(tester);
      await tester.tap(find.byKey(const Key('tier-monthly')));
      await tester.pumpAndSettle();
      expect(find.text('250.00'), findsOneWidget);

      await tester.tap(find.byKey(const Key('cap-cancel')));
      await tester.pumpAndSettle();

      // the daily one has no cap, so its field is empty rather than "0"
      await tester.tap(find.byKey(const Key('tier-daily')));
      await tester.pumpAndSettle();
      final field = tester.widget<TextField>(find.byKey(const Key('cap-field')));
      expect(field.controller!.text, '');
      await tester.tap(find.byKey(const Key('cap-cancel')));
      await tester.pumpAndSettle();
    });

    testWidgets('cancel changes nothing', (tester) async {
      caps(budget_: 250);
      await show(tester);
      await tester.tap(find.byKey(const Key('tier-monthly')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('cap-field')), '999');
      await tester.tap(find.byKey(const Key('cap-cancel')));
      await tester.pumpAndSettle();
      expect(budget.settings().budget, 250);
    });

    testWidgets('an empty field clears the cap rather than setting it to zero',
        (tester) async {
      // the same number, and the core already agrees about what it means
      spend('a', 30);
      caps(budget_: 250);
      await show(tester);
      await tester.tap(find.byKey(const Key('tier-monthly')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('cap-field')), '');
      await tester.tap(find.byKey(const Key('cap-ok')));
      await tester.pumpAndSettle();

      expect(budget.settings().budget, 0);
      expect(textOf(tester, 'tier-monthly-text'), contains('未设上限'));
    });
  });

  group('the settings survive', () {
    testWidgets('a snapshot and a reload', (tester) async {
      caps(budget_: 500, daily: 50, cycleStart: 15, cats: {'food': 100});
      final json = store.snapshotConfig();

      store.reset();
      expect(budget.settings().budget, 0);

      expect(store.loadConfig(json: json), isTrue);
      final s = budget.settings();
      expect(s.budget, 500);
      expect(s.dailyBudget, 50);
      expect(s.cycleStart, 15);
      expect(s.capCats, ['food']);
      expect(s.capAmounts, [100]);
    });
  });
}
