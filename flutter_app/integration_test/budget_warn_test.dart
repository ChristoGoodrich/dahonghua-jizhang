// 预算提醒 — the notice after a new entry.
//
// The shipping app checked two seconds after a save and said the budget was
// spent, or four-fifths gone, or a category's was. The port rewarded the
// entry with flowers and said nothing about the budget it had just pushed
// over. The words here, and through the shell, that a save brings them and
// an edit does not.

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_app/budget_warn.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/privacy.dart' as privacy;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void spend(String id, double amt, {String cat = 'food'}) {
  final t = now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, ts: t),
    id: id,
    now: t,
  );
}

void cap(double monthly) => budget.setSettings(
  view: budget.SettingsView(
    budget: monthly,
    dailyBudget: 0,
    cycleStart: 1,
    capCats: const [],
    capAmounts: Float64List(0),
  ),
);

Future<void> record(WidgetTester tester, List<String> keys) async {
  await tester.tap(find.byKey(const Key('record-button')));
  await tester.pumpAndSettle();
  for (final k in keys) {
    await tester.tap(find.byKey(Key('key-$k')));
    await tester.pumpAndSettle();
  }
  await tester.tap(find.byKey(const Key('key-save')));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() {
    store.reset();
    privacy.setHideAmounts(hidden: false);
  });
  tearDown(() => privacy.setHideAmounts(hidden: false));

  group('the words', () {
    testWidgets('the cycle over its cap says by how much', (tester) async {
      cap(100);
      spend('a', 130);
      final t = budgetWarningText(zh: true)!;
      expect(t, contains('已超'));
      expect(t, contains('30'));
    });

    testWidgets('four fifths of it says what is left', (tester) async {
      cap(100);
      spend('a', 85);
      final t = budgetWarningText(zh: true)!;
      expect(t, contains('85%'));
      expect(t, contains('15'));
    });

    testWidgets('a category only when the cycle has nothing to say', (
      tester,
    ) async {
      budget.setCatCap(cat: 'food', amount: 50);
      spend('a', 45);
      expect(budgetWarningText(zh: true), '餐饮预算已花 90%');
      expect(budgetWarningText(zh: false), 'Food is at 90% of its cap');
    });

    testWidgets('nothing near a cap says nothing', (tester) async {
      cap(1000);
      spend('a', 10);
      expect(budgetWarningText(zh: true), isNull);
    });

    testWidgets('隐藏金额 hides the amount here too', (tester) async {
      cap(100);
      spend('a', 130);
      privacy.setHideAmounts(hidden: true);
      final t = budgetWarningText(zh: true)!;
      expect(t, contains('****'));
      expect(t, isNot(contains('30')));
    });
  });

  group('after a save', () {
    testWidgets('a new entry over the cap brings the notice', (tester) async {
      cap(100);
      spend('a', 90);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();

      await record(tester, ['2', '0']);
      expect(find.byKey(const Key('budget-warn')), findsNothing);
      await tester.pump(budgetWarnDelay);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('budget-warn')), findsOneWidget);
      expect(find.textContaining('已超'), findsOneWidget);
    });

    testWidgets('and one well inside it brings none', (tester) async {
      cap(1000);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();

      await record(tester, ['2', '0']);
      await tester.pump(budgetWarnDelay);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('budget-warn')), findsNothing);
    });

    testWidgets('an edit brings none', (tester) async {
      // The notice is about what was just added; an edit added nothing, and
      // the shipping app said nothing after one either.
      cap(100);
      spend('a', 130);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();

      await tester.tap(find.text('-130.00'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();
      await tester.pump(budgetWarnDelay);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('budget-warn')), findsNothing);
    });
  });
}
