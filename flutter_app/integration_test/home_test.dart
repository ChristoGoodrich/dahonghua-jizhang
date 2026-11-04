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
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/privacy.dart' as privacy;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/theme.dart' as theme;
import 'package:flutter_app/theme.dart';
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
  ValueChanged<String>? onOpenAccount,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: EntryListScreen(
        onOpenBudget: onOpenBudget,
        onOpenStats: onOpenStats,
        onOpenAccount: onOpenAccount,
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

  group("a card's bill coming due", () {
    // The shipping banner was `dueInsight ?? insight`, and tapping a card's
    // reminder opened the card. The port had `credit_due_insight` in the core
    // and called it nowhere, so a statement came due without a word on 明细.

    /// A card whose cycle closed ten days back with ¥100 on it, due in three.
    void dueCard() {
      final closed = DateTime.now().subtract(const Duration(days: 10));
      final due = DateTime.now().add(const Duration(days: 3));
      accounts.addAccount(
        id: 'card',
        name: '信用卡',
        balance: 0,
        kind: 'credit',
        statementDay: closed.day <= 28 ? closed.day : 28,
        dueDay: due.day <= 28 ? due.day : 28,
        fxCode: null,
      );
      final t = now - 15 * day;
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 100,
          acct: 'card',
          ts: t,
        ),
        id: 'charge',
        now: t,
      );
    }

    /// Three expenses this cycle: enough for a sentence about spending.
    void spending() {
      add('a', 'exp', 30);
      add('b', 'exp', 20);
      add('c', 'exp', 10, cat: 'shop');
    }

    testWidgets(
      'comes before the sentence about spending, and opens the card',
      (tester) async {
        dueCard();
        spending();
        String? opened;
        await show(tester, onOpenAccount: (id) => opened = id);

        final banner = text(tester, 'home-insight-text');
        expect(banner, contains('信用卡'));
        expect(banner, contains('要还'));

        await tester.tap(find.byKey(const Key('home-insight-open')));
        await tester.pumpAndSettle();
        expect(opened, 'card');
      },
    );

    testWidgets('is read from the whole ledger, whatever the bar is on', (
      tester,
    ) async {
      // The card's charge is in no ledger; the list is on 旅行, where one
      // lunch is. A statement is every charge on the card, whichever ledger
      // each was filed in.
      dueCard();
      catalog.addTag(kind: 'ledger', name: '旅行');
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 30,
          ledger: '旅行',
          ts: now,
        ),
        id: 'trip',
        now: now,
      );
      catalog.setCurrentLedger(name: '旅行');
      await show(tester, onOpenAccount: (_) {});

      expect(text(tester, 'home-insight-text'), contains('信用卡'));
    });

    testWidgets('nothing due leaves the sentence about spending, unlinked', (
      tester,
    ) async {
      spending();
      await show(tester, onOpenAccount: (_) {});

      expect(find.byKey(const Key('home-insight')), findsOneWidget);
      expect(text(tester, 'home-insight-text'), isNot(contains('要还')));
      expect(find.byKey(const Key('home-insight-open')), findsNothing);
    });
  });

  group('another cycle', () {
    // The shipping summary card had ‹ and ›, and moved the totals, the pots,
    // the insight and the rows to the cycle chosen. The port's head showed
    // this cycle and only this one.
    int lastCycle(int day) {
      final n = DateTime.now();
      return DateTime(n.year, n.month - 1, day, 12).millisecondsSinceEpoch;
    }

    testWidgets('‹ shows the last one, its totals and its rows', (
      tester,
    ) async {
      add('now', 'exp', 30);
      add('then', 'exp', 50, ts: lastCycle(10));
      await show(tester);
      final here = text(tester, 'home-cycle');
      expect(find.byKey(const Key('row-now')), findsOneWidget);

      await tester.tap(find.byKey(const Key('home-prev')));
      await tester.pumpAndSettle();

      expect(text(tester, 'home-cycle'), isNot(here));
      expect(text(tester, 'home-net'), contains('50'));
      expect(find.byKey(const Key('row-then')), findsOneWidget);
      expect(find.byKey(const Key('row-now')), findsNothing);

      await tester.tap(find.byKey(const Key('home-next')));
      await tester.pumpAndSettle();
      expect(text(tester, 'home-cycle'), here);
      // this cycle's list is the whole ledger, as it always was
      expect(find.byKey(const Key('row-now')), findsOneWidget);
      expect(find.byKey(const Key('row-then')), findsOneWidget);
    });

    testWidgets('› goes no further than this one', (tester) async {
      add('now', 'exp', 30);
      await show(tester);
      final next = tester.widget<IconButton>(
        find.byKey(const Key('home-next')),
      );
      expect(next.onPressed, isNull);
    });

    testWidgets('a cycle with nothing in it keeps its arrows', (tester) async {
      // Without them an empty month would be a dead end.
      add('now', 'exp', 30);
      await show(tester);

      await tester.tap(find.byKey(const Key('home-prev')));
      await tester.pumpAndSettle();
      expect(find.text('这个周期没有记账'), findsOneWidget);

      await tester.tap(find.byKey(const Key('home-next')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('row-now')), findsOneWidget);
    });

    testWidgets("today's pot is this cycle's only", (tester) async {
      setBudget(monthly: 1000, daily: 100);
      add('now', 'exp', 30);
      add('then', 'exp', 50, ts: lastCycle(10));
      await show(tester);
      expect(find.byKey(const Key('pot-day-line')), findsOneWidget);

      await tester.tap(find.byKey(const Key('home-prev')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pot-day-line')), findsNothing);
      expect(find.byKey(const Key('pot-month-line')), findsOneWidget);
    });
  });

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

  group('the card in every flower, in both rooms', () {
    /// WCAG contrast between two colours, 1 to 21.
    double contrast(Color a, Color b) {
      final la = a.computeLuminance(), lb = b.computeLuminance();
      final hi = la > lb ? la : lb, lo = la > lb ? lb : la;
      return (hi + 0.05) / (lo + 0.05);
    }

    /// The slab is dark in both rooms — ink when lit, the warmed card at
    /// night — and the night version painted 花掉 and 进账 in the *deep*
    /// tones, which on a dark slab is about 2:1. In 森林 both were deep green
    /// besides, so the two numbers were the same faint colour. Found on the
    /// release build's screenshot.
    ///
    /// Asserted as contrast, and the pair as told apart by lightness alone:
    /// a flower whose accent is green (森林, 茉莉) has no hue left to say
    /// "spent" that "in" is not already using, and nor does a reader who
    /// cannot see red from green.
    const flowers = [
      'default',
      'sakura',
      'daisy',
      'jasmine',
      'ocean',
      'forest',
      'sunset',
    ];
    for (final dark in [false, true]) {
      testWidgets('can be read (${dark ? 'dark' : 'light'})', (tester) async {
        addTearDown(() {
          theme.setTheme(key: 'default', dark: false);
          refreshPalette();
        });
        add('a', 'exp', 30);
        add('b', 'inc', 100);
        for (final flower in flowers) {
          theme.setTheme(key: flower, dark: dark);
          refreshPalette();
          // a new tree per flower, so nothing is carried from the last
          await tester.pumpWidget(const SizedBox());
          await show(tester);

          Color slabOf(Finder text) => tester
              .widgetList<Container>(
                find.ancestor(of: text, matching: find.byType(Container)),
              )
              .map((c) => (c.decoration as BoxDecoration?)?.color)
              .firstWhere((c) => c != null)!;
          Color ink(String key) {
            final text = find.byKey(Key(key));
            final fg = tester.widget<Text>(text).style!.color!;
            return Color.alphaBlend(fg, slabOf(text));
          }

          final slab = slabOf(find.byKey(const Key('home-net')));
          for (final key in ['home-net', 'home-exp', 'home-inc']) {
            final ratio = contrast(ink(key), slab);
            expect(
              ratio,
              greaterThanOrEqualTo(4.5),
              reason: '$flower: $key is ${ratio.toStringAsFixed(2)}:1',
            );
          }
          final apart = contrast(ink('home-exp'), ink('home-inc'));
          expect(
            apart,
            greaterThanOrEqualTo(1.4),
            reason:
                '$flower: 花掉 and 进账 are ${apart.toStringAsFixed(2)}:1 '
                'apart',
          );
        }
      });
    }
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
      expect(text(tester, 'pot-month-line'), '已花 ￥30，还剩 ￥70');

      store.reset();
      setBudget(monthly: 100);
      add('b', 'exp', 130);
      await tester.pumpWidget(
        const MaterialApp(key: ValueKey('over'), home: EntryListScreen()),
      );
      await tester.pumpAndSettle();
      // The whole line, Chinese comma and all: it said "超了 ￥30,下月…"
      // with the ASCII one until zh:check went through the strings.
      expect(text(tester, 'pot-month-line'), '超了 ￥30，下月再争取小红花');
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
