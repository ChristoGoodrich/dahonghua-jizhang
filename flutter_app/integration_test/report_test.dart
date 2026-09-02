// 回顾 on a device, over three core modules at once.
//
// The three answers do not share a date range and that is the substance: the
// recap covers the CYCLE (which turns over on `cycleStart` and is not the
// calendar month), the week is SUNDAY to Sunday, and the insight looks at the
// cycle but says nothing at all unless there are at least three expenses in it.
//
// Two shapes reproduced rather than tidied: `count` includes transfers though
// neither total does, and a weekly budget of zero is UNSET rather than "nothing
// allowed".

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_app/report_screen.dart';
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/report.dart' as report;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

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

void earn(String id, double amt, {int? ts}) {
  final t = ts ?? now;
  store.addEntry(
    entry: store.NewEntry(io: 'inc', cat: 'salary', amt: amt, ts: t),
    id: id,
    now: t,
  );
}

void caps({double budget_ = 0, double daily = 0, int cycleStart = 1}) {
  budget.setSettings(
    view: budget.SettingsView(
      budget: budget_,
      dailyBudget: daily,
      cycleStart: cycleStart,
      capCats: const [],
      capAmounts: Float64List.fromList(const []),
    ),
  );
}

/// Every live entry, with the day Dart resolves for it — the shape all three
/// calls take.
({List<String> ids, List<String> days}) allRows() {
  final all = store.liveEntries();
  return (
    ids: all.map((e) => e.id).toList(),
    days: all
        .map((e) => reportDay(DateTime.fromMillisecondsSinceEpoch(e.ts)))
        .toList(),
  );
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: ReportScreen(zh: zh)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the day encoding', () {
    testWidgets('is 1-indexed here, unlike the subscription cursor',
        (tester) async {
      // two encodings live in this app and getting them the wrong way round
      // moves everything a month
      expect(reportDay(DateTime(2026, 1, 15)), '2026-1-15');
      expect(reportDay(DateTime(2026, 12, 31)), '2026-12-31');
    });
  });

  group('the recap', () {
    testWidgets('adds up the cycle in six numbers', (tester) async {
      spend('e1', 100);
      spend('e2', 50);
      earn('e3', 500);
      final r = allRows();
      final v = report.recap(ids: r.ids, daysOf: r.days);

      expect(v.exp, 150);
      expect(v.inc, 500);
      expect(v.net, 350);
      expect(v.count, 3);
      expect(v.activeDays, 1);
    });

    testWidgets('counts transfers, though neither total does', (tester) async {
      // `count` answers "how many rows are in this cycle", not "how many moved
      // money one way"
      spend('e1', 100);
      store.addTransfer(
        transfer: store.NewTransfer(from: 'default', to: 'other', amt: 30),
        id: 't1',
        now: now,
      );
      final r = allRows();
      final v = report.recap(ids: r.ids, daysOf: r.days);

      expect(v.count, 2);
      expect(v.exp, 100); // the transfer is in neither total
      expect(v.inc, 0);
    });

    testWidgets('active days counts distinct calendar days', (tester) async {
      spend('a', 10, ts: now);
      spend('b', 10, ts: now - 1000); // same day
      spend('c', 10, ts: now - day * 2);
      final r = allRows();
      expect(report.recap(ids: r.ids, daysOf: r.days).activeDays, 2);
    });

    testWidgets('names the biggest category and what it came to',
        (tester) async {
      spend('a', 100, cat: 'food');
      spend('b', 300, cat: 'shop');
      spend('c', 50, cat: 'trans');
      final r = allRows();
      final v = report.recap(ids: r.ids, daysOf: r.days);

      expect(v.topCat, 'shop');
      expect(v.topCatAmt, 300);
    });

    testWidgets('an empty ledger recaps to zeros rather than failing',
        (tester) async {
      final v = report.recap(ids: const [], daysOf: const []);
      expect(v.exp, 0);
      expect(v.count, 0);
      expect(v.topCat, isNull);
    });
  });

  group('the week', () {
    testWidgets('counts only the week containing today', (tester) async {
      spend('this', 30, ts: now);
      spend('old', 900, ts: now - day * 10);
      final r = allRows();
      final v = report.weekly(
        ids: r.ids,
        daysOf: r.days,
        weeklyBudget: 700,
        today: reportDay(DateTime.now()),
      );

      expect(v.spent, 30);
      expect(v.remaining, 670);
      expect(v.over, isFalse);
    });

    testWidgets('goes over without clamping', (tester) async {
      spend('a', 900);
      final r = allRows();
      final v = report.weekly(
        ids: r.ids,
        daysOf: r.days,
        weeklyBudget: 700,
        today: reportDay(DateTime.now()),
      );

      expect(v.over, isTrue);
      expect(v.remaining, -200);
    });

    testWidgets('a budget of zero gives a daily of zero, not a division error',
        (tester) async {
      // a plain division, guarded on neither side
      final v = report.weekly(
        ids: const [],
        daysOf: const [],
        weeklyBudget: 0,
        today: reportDay(DateTime.now()),
      );
      expect(v.dailyBudget, 0);
    });

    testWidgets('days left is never negative', (tester) async {
      final v = report.weekly(
        ids: const [],
        daysOf: const [],
        weeklyBudget: 700,
        today: reportDay(DateTime.now()),
      );
      expect(v.daysLeft, greaterThan(0));
      expect(v.daysLeft, lessThanOrEqualTo(7));
    });
  });

  group('the insight', () {
    testWidgets('says nothing at all below three expenses', (tester) async {
      // a sentence about two rows is noise rather than an insight
      caps(budget_: 100);
      spend('a', 90);
      spend('b', 90);
      final r = allRows();
      expect(
        report.insight(
          ids: r.ids,
          daysOf: r.days,
          today: reportDay(DateTime.now()),
          zh: true,
          copy: insightCopy(true),
        ),
        isNull,
      );
    });

    testWidgets('says the budget is spent once it is', (tester) async {
      caps(budget_: 100);
      for (var i = 0; i < 3; i++) {
        spend('e$i', 50);
      }
      final r = allRows();
      final v = report.insight(
        ids: r.ids,
        daysOf: r.days,
        today: reportDay(DateTime.now()),
        zh: true,
        copy: insightCopy(true),
      );

      expect(v, isNotNull);
      expect(v!.text, '预算已经花完了');
    });

    testWidgets('fills a marker with the number it stands for', (tester) async {
      caps(budget_: 1000);
      for (var i = 0; i < 3; i++) {
        spend('e$i', 280); // 84% — near, not over
      }
      final r = allRows();
      final v = report.insight(
        ids: r.ids,
        daysOf: r.days,
        today: reportDay(DateTime.now()),
        zh: true,
        copy: insightCopy(true),
      );

      expect(v!.text, contains('84'));
      expect(v.text, isNot(contains('%d')));
    });

    testWidgets('speaks the language it was given', (tester) async {
      caps(budget_: 100);
      for (var i = 0; i < 3; i++) {
        spend('e$i', 50);
      }
      final r = allRows();
      final v = report.insight(
        ids: r.ids,
        daysOf: r.days,
        today: reportDay(DateTime.now()),
        zh: false,
        copy: insightCopy(false),
      );
      expect(v!.text, 'The budget is spent');
    });
  });

  group('the screen', () {
    testWidgets('draws all three when there is something to draw',
        (tester) async {
      caps(budget_: 100, daily: 100);
      for (var i = 0; i < 3; i++) {
        spend('e$i', 50);
      }
      earn('inc', 500);
      await show(tester);

      expect(textOf(tester, 'recap-exp'), '￥150.00');
      expect(textOf(tester, 'recap-inc'), '￥500.00');
      expect(textOf(tester, 'recap-net'), '￥350.00');
      expect(textOf(tester, 'week-spent'), '￥150.00');
      expect(find.byKey(const Key('insight')), findsOneWidget);
    });

    testWidgets('leaves the banner out when there is no sentence',
        (tester) async {
      spend('e1', 10);
      await show(tester);
      expect(find.byKey(const Key('insight')), findsNothing);
      expect(textOf(tester, 'recap-count'), '1');
    });

    testWidgets('an unset weekly budget says so rather than showing zero left',
        (tester) async {
      spend('e1', 30);
      await show(tester);
      expect(textOf(tester, 'week-text'), '未设每周上限');
    });

    testWidgets('over the weekly budget says by how much', (tester) async {
      caps(daily: 100); // 700 a week
      spend('e1', 900);
      await show(tester);
      expect(textOf(tester, 'week-text'), contains('超出'));
      expect(textOf(tester, 'week-text'), contains('￥200.00'));
    });

    testWidgets('names the biggest category', (tester) async {
      spend('a', 100, cat: 'food');
      spend('b', 300, cat: 'shop');
      await show(tester);
      expect(textOf(tester, 'recap-top'), contains('购物'));
      expect(textOf(tester, 'recap-top'), contains('￥300.00'));
    });

    testWidgets('an empty ledger draws zeros rather than nothing',
        (tester) async {
      await show(tester);
      expect(textOf(tester, 'recap-net'), '￥0.00');
      expect(textOf(tester, 'recap-count'), '0');
    });
  });
}
