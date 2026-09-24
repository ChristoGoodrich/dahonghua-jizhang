// What says "too much", in a flower whose own colour is the leaf's.
//
// Every warning used to be painted in the flower: an overspent budget, a
// balance below zero, "比上月同期多", a delete. In 大红花 that is red and right.
// In 森林 the flower is green — the colour this app says "in" and "on track"
// with — so the screenshot tour showed a card ¥3,120 in debt and a budget ¥24
// over, both in the same green as the salary. `core::theme::warn` now decides,
// and is tested there for every flower; what is checked here is that the
// screens ask it.

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_app/accounts_screen.dart';
import 'package:flutter_app/assets_screen.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/theme.dart' as theme;
import 'package:flutter_app/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void flower(String key, {bool dark = false}) {
  theme.setTheme(key: key, dark: dark);
  refreshPalette();
}

Color colorOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).style!.color!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() {
    store.reset();
    flower('forest', dark: true);
  });
  tearDown(() => flower('default'));

  testWidgets('a warm flower warns in itself, a cool one in the hibiscus', (
    tester,
  ) async {
    flower('sunset');
    expect(palette.warn, palette.hibiscus);
    flower('forest');
    expect(palette.warn, isNot(palette.hibiscus));
    final forest = palette.warn;
    flower('default');
    expect(forest, palette.hibiscus, reason: '大红花 lends its red');
  });

  testWidgets('an overspent budget on 明细 is not the leaf', (tester) async {
    budget.setSettings(
      view: budget.SettingsView(
        budget: 100,
        dailyBudget: 0,
        cycleStart: 1,
        capCats: const [],
        capAmounts: Float64List(0),
      ),
    );
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 150, ts: now),
      id: 'a',
      now: now,
    );
    await tester.pumpWidget(const MaterialApp(home: EntryListScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('超了'), findsOneWidget);
    expect(colorOf(tester, 'pot-month-line'), palette.warnDeep);
  });

  group('a balance below zero', () {
    setUp(
      () => accounts.addAccount(
        id: 'card',
        name: '信用卡',
        balance: -3120,
        kind: 'credit',
      ),
    );

    testWidgets('on 账户', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: AccountsScreen()));
      await tester.pumpAndSettle();
      expect(colorOf(tester, 'acct-card-bal'), palette.warn);
    });

    testWidgets('on 资产', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: AssetsScreen()));
      await tester.pumpAndSettle();
      expect(colorOf(tester, 'nw-acct-card-val'), palette.warn);
    });
  });
}
