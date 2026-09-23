// 明细's head: the cycle's totals, the budget's flower, the one sentence, and
// the eye that hides them.
//
// The shipping list opened on these three and the port dropped them; the
// numbers are `api::home`'s, so what is checked here is what reaches the
// screen — which cycle, which total, which way the flower leans — not how a
// card is painted.

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_app/accounts_screen.dart';
import 'package:flutter_app/assets_screen.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/privacy.dart' as privacy;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

const day = 86400000;
int get now => DateTime.now().millisecondsSinceEpoch;

void add(String id, String io, double amt, {int? ts, String cat = 'food'}) {
  final t = ts ?? now;
  store.addEntry(
    entry: store.NewEntry(io: io, cat: cat, amt: amt, ts: t),
    id: id,
    now: t,
  );
}

void setBudget({double monthly = 0, double daily = 0}) => budget.setSettings(
  view: budget.SettingsView(
    budget: monthly,
    dailyBudget: daily,
    cycleStart: 1,
    capCats: const [],
    capAmounts: Float64List(0),
  ),
);

Future<void> show(
  WidgetTester tester, {
  VoidCallback? onOpenBudget,
  VoidCallback? onOpenStats,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: EntryListScreen(
        onOpenBudget: onOpenBudget,
        onOpenStats: onOpenStats,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

String text(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the summary', () {
    /// 本月攒下的 is the cycle's, not the ledger's: an expense two months back
    /// is in the list below and not in the card above it.
    testWidgets('is this cycle, not the whole ledger', (tester) async {
      add('a', 'exp', 30);
      add('b', 'inc', 100);
      add('old', 'exp', 1000, ts: now - 70 * day);
      await show(tester);

      expect(text(tester, 'home-exp'), '￥30.00');
      expect(text(tester, 'home-inc'), '￥100.00');
      expect(text(tester, 'home-net'), '￥70.00');
    });

    testWidgets('the bar is spending\'s share of what moved', (tester) async {
      add('a', 'exp', 25);
      add('b', 'inc', 75);
      await show(tester);

      final bar = tester.widget<FractionallySizedBox>(
        find.byKey(const Key('home-share')),
      );
      expect(bar.widthFactor, closeTo(0.25, 1e-9));
    });

    /// A transfer moves nothing in or out, so there is no share to draw — an
    /// empty bar would read as "spent nothing" when it means "nothing".
    testWidgets('with nothing moved there is no bar', (tester) async {
      add('x', 'xfer', 500);
      await show(tester);
      expect(find.byKey(const Key('home-summary')), findsOneWidget);
      expect(find.byKey(const Key('home-share')), findsNothing);
    });

    testWidgets('pressing it opens 统计', (tester) async {
      add('a', 'exp', 30);
      var opened = false;
      await show(tester, onOpenStats: () => opened = true);
      await tester.tap(find.byKey(const Key('home-summary')));
      expect(opened, isTrue);
    });
  });

  group('the eye', () {
    testWidgets('hides every total on the card, and shows them again', (
      tester,
    ) async {
      add('a', 'exp', 30);
      add('b', 'inc', 100);
      await show(tester);

      await tester.tap(find.byKey(const Key('hide-amounts')));
      await tester.pumpAndSettle();
      expect(privacy.hideAmounts(), isTrue);
      for (final k in ['home-net', 'home-exp', 'home-inc']) {
        expect(text(tester, k), '****', reason: k);
      }
      // the rows are not totals, and hiding them would hide the ledger
      expect(find.text('-30.00'), findsOneWidget);

      await tester.tap(find.byKey(const Key('hide-amounts')));
      await tester.pumpAndSettle();
      expect(text(tester, 'home-net'), '￥70.00');
    });

    /// One setting: shut on 明细, it is shut on 资产, and 资产's own eye
    /// opens both.
    testWidgets('资产 reads the same eye, and has one of its own', (
      tester,
    ) async {
      add('a', 'inc', 500);
      privacy.setHideAmounts(hidden: true);
      await tester.pumpWidget(const MaterialApp(home: AssetsScreen()));
      await tester.pumpAndSettle();
      expect(text(tester, 'net-worth'), '****');

      await tester.tap(find.byKey(const Key('assets-hide-amounts')));
      await tester.pumpAndSettle();
      expect(privacy.hideAmounts(), isFalse);
      expect(text(tester, 'net-worth'), isNot('****'));
    });

    testWidgets('and the balances on 账户', (tester) async {
      add('a', 'inc', 500);
      privacy.setHideAmounts(hidden: true);
      await tester.pumpWidget(const MaterialApp(home: AccountsScreen()));
      await tester.pumpAndSettle();
      expect(text(tester, 'acct-total'), '****');
      expect(text(tester, 'acct-default-bal'), '****');
    });

    testWidgets('and the budget flower\'s amounts with them', (tester) async {
      setBudget(monthly: 1000);
      add('a', 'exp', 30);
      await show(tester);
      await tester.tap(find.byKey(const Key('hide-amounts')));
      await tester.pumpAndSettle();
      expect(text(tester, 'pot-month-line'), isNot(contains('30')));
    });
  });

  group('the budget flower', () {
    testWidgets('is not there without a budget', (tester) async {
      add('a', 'exp', 30);
      await show(tester);
      expect(find.byKey(const Key('home-pot')), findsNothing);
    });

    /// The shipping card's three states: its own colours, the stamen's from
    /// four-fifths, dry once it is all spent.
    for (final (spent, mood) in [
      (50.0, 'fresh'),
      (85.0, 'wary'),
      (120.0, 'wilted'),
    ]) {
      testWidgets('at $spent of 100 it is $mood', (tester) async {
        setBudget(monthly: 100);
        add('a', 'exp', spent);
        await show(tester);
        expect(find.byKey(Key('pot-$mood')), findsOneWidget);
      });
    }

    testWidgets('says how much is left, and how much over', (tester) async {
      setBudget(monthly: 100);
      add('a', 'exp', 30);
      await show(tester);
      expect(text(tester, 'pot-month-line'), '已花 ￥30,还剩 ￥70');

      store.reset();
      setBudget(monthly: 100);
      add('b', 'exp', 130);
      await tester.pumpWidget(
        const MaterialApp(key: ValueKey('over'), home: EntryListScreen()),
      );
      await tester.pumpAndSettle();
      expect(text(tester, 'pot-month-line'), startsWith('超了 ￥30'));
    });

    /// With only a daily cap, today leads the flower.
    testWidgets('follows today when today is the only budget', (tester) async {
      setBudget(daily: 50);
      add('a', 'exp', 60);
      await show(tester);
      expect(find.byKey(const Key('pot-wilted')), findsOneWidget);
      expect(text(tester, 'pot-day-line'), '今日预算 · 今天超了 ￥10');
    });

    testWidgets('pressing it opens 预算', (tester) async {
      setBudget(monthly: 100);
      add('a', 'exp', 30);
      var opened = false;
      await show(tester, onOpenBudget: () => opened = true);
      await tester.tap(find.byKey(const Key('home-pot')));
      expect(opened, isTrue);
    });
  });

  group('the sentence', () {
    /// The same sentence 回顾 shows: three expenses are enough to say one.
    testWidgets('appears once there is something to say', (tester) async {
      setBudget(monthly: 100);
      add('a', 'exp', 30);
      add('b', 'exp', 30);
      add('c', 'exp', 30);
      await show(tester);
      expect(find.byKey(const Key('home-insight')), findsOneWidget);
      expect(find.textContaining('90%'), findsOneWidget);
    });

    testWidgets('and not before', (tester) async {
      setBudget(monthly: 100);
      add('a', 'exp', 90);
      await show(tester);
      expect(find.byKey(const Key('home-insight')), findsNothing);
    });
  });

  group('the head stands aside', () {
    testWidgets('for a search, whose results are not about the month', (
      tester,
    ) async {
      add('a', 'exp', 30);
      await show(tester);
      expect(find.byKey(const Key('home-summary')), findsOneWidget);
      await tester.tap(find.byKey(const Key('search-toggle')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('home-summary')), findsNothing);
    });

    testWidgets('and while rows are being ticked', (tester) async {
      add('a', 'exp', 30);
      await show(tester);
      await tester.tap(find.byKey(const Key('select-toggle')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('home-summary')), findsNothing);
    });
  });
}
