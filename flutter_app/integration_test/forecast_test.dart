// 下月预测 — the shipping 洞察 screen, which the port dropped while the README
// went on listing it. The arithmetic is `core::forecast` and its own tests;
// these are the screen over it: what it says with no history, with a rising
// one, per category, and that 我的 reaches it.

import 'package:flutter/material.dart';
import 'package:flutter_app/forecast_screen.dart';
import 'package:flutter_app/main.dart' show App;
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/privacy.dart' as privacy;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';

/// An expense `back` cycles ago, mid-month (cycles start on the 1st).
void spentBack(String id, int back, double amt, {String cat = 'food'}) {
  final n = DateTime.now();
  final t = DateTime(n.year, n.month - back, 10, 12).millisecondsSinceEpoch;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, ts: t),
    id: id,
    now: t,
  );
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: ForecastScreen(zh: zh)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() {
    store.reset();
    privacy.setHideAmounts(hidden: false);
  });
  tearDown(() => privacy.setHideAmounts(hidden: false));

  testWidgets('with nothing behind it, says so', (tester) async {
    await show(tester);
    expect(find.byKey(const Key('forecast-empty')), findsOneWidget);
    expect(find.byKey(const Key('forecast-amount')), findsNothing);
  });

  testWidgets('three rising cycles: rising, and on past the last', (
    tester,
  ) async {
    spentBack('a', 3, 200);
    spentBack('b', 2, 400);
    spentBack('c', 1, 600);
    await show(tester);

    expect(textOf(tester, 'forecast-amount'), contains('800'));
    expect(textOf(tester, 'forecast-trend'), contains('上升'));
    expect(textOf(tester, 'forecast-confidence'), '100%');
    expect(find.textContaining('设上限'), findsOneWidget);
  });

  testWidgets('a history the line explains nothing of is still a forecast', (
    tester,
  ) async {
    // The shipping screen took a confidence of zero for "no history".
    spentBack('a', 3, 100);
    spentBack('b', 2, 300);
    spentBack('c', 1, 100);
    await show(tester);

    expect(find.byKey(const Key('forecast-empty')), findsNothing);
    expect(textOf(tester, 'forecast-confidence'), '0%');
  });

  testWidgets('each category, the user\'s own named as itself', (tester) async {
    catalog.addCustomCat(io: 'exp', key: 'c1', name: '猫粮', emoji: '🐈');
    for (var back = 1; back <= 3; back++) {
      spentBack('f$back', back, 300);
      spentBack('p$back', back, 100, cat: 'c1');
    }
    await show(tester);

    expect(find.byKey(const Key('forecast-cat-food')), findsOneWidget);
    expect(find.byKey(const Key('forecast-cat-c1')), findsOneWidget);
    expect(find.textContaining('猫粮'), findsOneWidget);
  });

  testWidgets('隐藏金额 hides the amount', (tester) async {
    spentBack('a', 1, 600);
    privacy.setHideAmounts(hidden: true);
    await show(tester);
    expect(textOf(tester, 'forecast-amount'), '****');
  });

  testWidgets('我的 reaches it', (tester) async {
    await tester.pumpWidget(const App());
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('tab-我的')));
    await tester.pumpAndSettle();

    await scrollAndTap(tester, find.byKey(const Key('me-forecast')));

    expect(find.byType(ForecastScreen), findsOneWidget);
  });
}
