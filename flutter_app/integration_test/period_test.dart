// The stats window: day / week / month / half-year / year.
//
// The windows themselves are Rust's, under a 12,108-case corpus. What only a
// device can show is the consequence: that every number on the screen is about
// the SAME window. Before this the totals and the donut read the whole ledger
// while the chart read a fixed 7/30/90 days, so the three disagreed and nothing
// said so.
//
// `month` is not the calendar month — it is the accounting cycle. A test that
// assumed otherwise would pass only for a ledger that turns over on the 1st.

import 'package:flutter/material.dart';
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/period.dart' as period;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/stats_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

String day(DateTime d) => '${d.year}-${d.month}-${d.day}';

DateTime parse(String ymd) {
  final p = ymd.split('-').map(int.parse).toList();
  return DateTime(p[0], p[1], p[2]);
}

void add(String id, {double amt = 30, String cat = 'food', DateTime? at}) {
  final t = (at ?? DateTime.now()).millisecondsSinceEpoch;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, ts: t),
    id: id,
    now: t,
  );
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: StatsScreen(zh: zh)));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the windows', () {
    testWidgets('a day is one day', (tester) async {
      final w = period.periodWindow(anchor: '2026-8-15', period: 'day');

      expect(w.start, '2026-8-15');
      expect(w.last, '2026-8-15');
      expect(w.days, 1);
    });

    testWidgets('a week runs Monday to Sunday', (tester) async {
      // 2026-08-15 is a Saturday.
      final w = period.periodWindow(anchor: '2026-8-15', period: 'week');

      expect(parse(w.start).weekday, DateTime.monday);
      expect(parse(w.last).weekday, DateTime.sunday);
      expect(w.days, 7);
    });

    testWidgets('a year is the calendar year', (tester) async {
      final w = period.periodWindow(anchor: '2026-8-15', period: 'year');

      expect(w.start, '2026-1-1');
      expect(w.last, '2026-12-31');
      expect(w.days, 365);
    });

    testWidgets('a leap year is a day longer', (tester) async {
      expect(period.periodWindow(anchor: '2024-3-1', period: 'year').days, 366);
    });

    testWidgets('the halves split at July', (tester) async {
      expect(period.periodWindow(anchor: '2026-6-30', period: 'halfyear').start,
          '2026-1-1');
      expect(period.periodWindow(anchor: '2026-7-1', period: 'halfyear').start,
          '2026-7-1');
    });

    testWidgets('a month is the accounting cycle, not the calendar month',
        (tester) async {
      final s = budget.settings();
      budget.setSettings(
        view: budget.SettingsView(
          budget: s.budget,
          dailyBudget: s.dailyBudget,
          cycleStart: 15,
          capCats: s.capCats,
          capAmounts: s.capAmounts,
        ),
      );
      addTearDown(() => budget.setSettings(view: s));

      final w = period.periodWindow(anchor: '2026-8-20', period: 'month');

      expect(w.start, '2026-8-15');
      expect(w.last, '2026-9-14',
          reason: 'a ledger that turns over on the 15th runs 15th to 14th');
    });

    testWidgets('the end is exclusive and the last day is not', (tester) async {
      final w = period.periodWindow(anchor: '2026-8-15', period: 'day');

      expect(w.end, '2026-8-16');
      expect(w.last, '2026-8-15');
    });
  });

  group('stepping', () {
    testWidgets('a day back is the day before', (tester) async {
      expect(period.stepPeriod(anchor: '2026-8-15', period: 'day', dir: -1),
          '2026-8-14');
    });

    testWidgets('stepping crosses a month boundary', (tester) async {
      expect(period.stepPeriod(anchor: '2026-9-1', period: 'day', dir: -1),
          '2026-8-31');
    });

    testWidgets('a week back lands on the previous Monday', (tester) async {
      final back =
          period.stepPeriod(anchor: '2026-8-15', period: 'week', dir: -1);
      expect(parse(back).weekday, DateTime.monday);
      expect(parse(back).month, 8);
      expect(parse(back).day, 3);
    });

    testWidgets('a year forward is the next January', (tester) async {
      expect(period.stepPeriod(anchor: '2026-8-15', period: 'year', dir: 1),
          '2027-1-1');
    });

    testWidgets('stepping there and back returns to the same window',
        (tester) async {
      for (final p in ['day', 'week', 'month', 'halfyear', 'year']) {
        final start = period.periodWindow(anchor: '2026-8-15', period: p).start;
        final away = period.stepPeriod(anchor: '2026-8-15', period: p, dir: 1);
        final back = period.stepPeriod(anchor: away, period: p, dir: -1);
        expect(period.periodWindow(anchor: back, period: p).start, start,
            reason: '$p did not come back');
      }
    });
  });

  group('what falls inside', () {
    testWidgets('an entry outside the window is left out', (tester) async {
      add('in', at: DateTime(2026, 8, 15));
      add('out', at: DateTime(2026, 7, 15));

      final hits = period.idsInPeriod(
        ids: const ['in', 'out'],
        daysOf: const ['2026-8-15', '2026-7-15'],
        anchor: '2026-8-15',
        period: 'day',
      );

      expect(hits, ['in']);
    });

    testWidgets('the last day is in and the end day is out', (tester) async {
      add('last', at: DateTime(2026, 8, 15));
      add('after', at: DateTime(2026, 8, 16));

      final hits = period.idsInPeriod(
        ids: const ['last', 'after'],
        daysOf: const ['2026-8-15', '2026-8-16'],
        anchor: '2026-8-15',
        period: 'day',
      );

      expect(hits, ['last'], reason: 'the range is half-open');
    });

    testWidgets('the order given is the order returned', (tester) async {
      add('a', at: DateTime(2026, 8, 15));
      add('b', at: DateTime(2026, 8, 15));

      expect(
        period.idsInPeriod(
          ids: const ['b', 'a'],
          daysOf: const ['2026-8-15', '2026-8-15'],
          anchor: '2026-8-15',
          period: 'day',
        ),
        ['b', 'a'],
      );
    });

    testWidgets('an id the ledger does not hold is dropped', (tester) async {
      expect(
        period.idsInPeriod(
          ids: const ['gone'],
          daysOf: const ['2026-8-15'],
          anchor: '2026-8-15',
          period: 'day',
        ),
        isEmpty,
      );
    });
  });

  group('the screen', () {
    testWidgets('opens on the month and says which one', (tester) async {
      await show(tester);

      expect(find.byKey(const Key('period-label')), findsOneWidget);
      expect(find.byKey(const Key('period-month')), findsOneWidget);
    });

    testWidgets('the totals are about the window, not the whole ledger',
        (tester) async {
      // The failure this guards: the totals and the donut used to read every
      // entry ever recorded while the chart above them read 30 days.
      add('now', amt: 30);
      add('old', amt: 500, at: DateTime.now().subtract(const Duration(days: 400)));
      await show(tester);

      final total = tester.widget<Text>(find.byKey(const Key('total-exp')));
      expect(total.data, contains('30'));
      expect(total.data, isNot(contains('530')));
    });

    testWidgets('stepping back changes what is counted', (tester) async {
      add('now', amt: 30);
      await show(tester);
      expect(
          tester.widget<Text>(find.byKey(const Key('total-exp'))).data,
          contains('30'));

      await tester.tap(find.byKey(const Key('period-prev')));
      await tester.pumpAndSettle();

      final total = tester.widget<Text>(find.byKey(const Key('total-exp')));
      expect(total.data, isNot(contains('30')),
          reason: 'last cycle has nothing in it');
    });

    testWidgets('stepping forward and back returns to the same label',
        (tester) async {
      await show(tester);
      final before =
          tester.widget<Text>(find.byKey(const Key('period-label'))).data;

      await tester.tap(find.byKey(const Key('period-prev')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('period-next')));
      await tester.pumpAndSettle();

      expect(tester.widget<Text>(find.byKey(const Key('period-label'))).data,
          before);
    });

    testWidgets('changing the window comes back to now', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('period-prev')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('period-day')));
      await tester.pumpAndSettle();

      // The anchor was chosen inside a window that no longer exists; landing
      // on an arbitrary past day is harder to explain than landing on today.
      final now = DateTime.now();
      expect(find.text('${now.month}月${now.day}日'), findsOneWidget);
    });

    testWidgets('the chart does not run past today', (tester) async {
      add('a');
      await show(tester);

      // The window is the whole cycle, but a chart ending in days that have
      // not happened reads as spending having stopped.
      final last = tester.widget<Text>(find.byKey(const Key('axis-last')));
      final now = DateTime.now();
      expect(last.data, '${now.month}/${now.day}');
    });

    testWidgets('a past window does draw its whole self', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('period-prev')));
      await tester.pumpAndSettle();

      final last = tester.widget<Text>(find.byKey(const Key('axis-last')));
      final now = DateTime.now();
      expect(last.data, isNot('${now.month}/${now.day}'),
          reason: 'nothing to clamp to in a window already over');
    });

    testWidgets('English names for the windows', (tester) async {
      await show(tester, zh: false);

      expect(find.text('Month'), findsOneWidget);
      expect(find.text('Half'), findsOneWidget);
    });
  });
}
