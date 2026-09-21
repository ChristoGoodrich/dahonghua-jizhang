// Statistics on a device, over the real Rust totals and the real geometry.
//
// A chart is the easiest place in an app to be confidently wrong — a line is
// drawn either way and a wrong one looks fine — so these check the *numbers*
// that reach the painter rather than the pixels it makes of them. The pixels
// are one scale factor away from the numbers, and the numbers are what the
// parity corpus pins.

import 'package:flutter/material.dart';
import 'package:flutter_app/src/rust/api/stats.dart' as stats;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/stats_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';

const day = 86400000;
int get now => DateTime.now().millisecondsSinceEpoch;
String ymd(int ts) {
  final d = DateTime.fromMillisecondsSinceEpoch(ts);
  return '${d.year}-${d.month}-${d.day}';
}

void add(String id, String io, double amt, {int? ts, String cat = 'food'}) {
  final t = ts ?? now;
  store.addEntry(
    entry: store.NewEntry(io: io, cat: cat, amt: amt, ts: t),
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

  group('the totals', () {
    testWidgets('separate expense, income and balance', (tester) async {
      add('a', 'exp', 30);
      add('b', 'inc', 100);
      add('c', 'xfer', 5000);
      await show(tester);

      String total(String k) =>
          tester.widget<Text>(find.byKey(Key('total-$k'))).data!;
      expect(total('exp'), '￥30.00');
      expect(total('inc'), '￥100.00');
      expect(total('bal'), '￥70.00');
      // the transfer is in neither total, which is the whole reason it exists
      expect(find.text('￥5,000.00'), findsNothing);
    });

    testWidgets('count includes transfers even though no total does', (
      tester,
    ) async {
      add('a', 'exp', 30);
      add('x', 'xfer', 5000);
      final o = stats.overview(ids: ['a', 'x']);
      expect(o.count, 2);
      expect(o.exp, 30);
      expect(o.inc, 0);
    });
  });

  group('the trend', () {
    testWidgets('has one point per day, empty days included', (tester) async {
      add('a', 'exp', 30);
      final pts = stats.dailyTrend(
        ids: ['a'],
        daysOf: [ymd(now)],
        days: 7,
        today: ymd(now),
      );
      expect(pts, hasLength(7));
      expect(pts.last.exp, 30); // today is the last point
      expect(pts.first.exp, 0);
    });

    testWidgets('coordinates come back inside the box', (tester) async {
      add('a', 'exp', 30, ts: now);
      add('b', 'exp', 10, ts: now - day);
      final pts = stats.dailyTrend(
        ids: ['a', 'b'],
        daysOf: [ymd(now), ymd(now - day)],
        days: 3,
        today: ymd(now),
      );
      final c = stats.chartPoints(points: pts, series: 'both');

      expect(c.max, 30);
      expect(c.exp, hasLength(3));
      // the tallest value sits at the top padding, and a zero at the bottom
      expect(c.exp.last.y, 7);
      expect(c.exp.first.y, 89);
      // and the ends span the padded box
      expect(c.exp.first.x, 7);
      expect(c.exp.last.x, 293);
    });

    testWidgets('an all-zero range does not divide by zero', (tester) async {
      final pts = stats.dailyTrend(
        ids: [],
        daysOf: [],
        days: 5,
        today: ymd(now),
      );
      final c = stats.chartPoints(points: pts, series: 'both');
      expect(c.max, 1); // the guard, rather than a zero divisor
      expect(c.exp.every((p) => p.y == 89), isTrue);
    });

    testWidgets('a series nobody draws does not set the scale', (tester) async {
      add('a', 'exp', 1000, ts: now);
      add('b', 'inc', 10, ts: now);
      final pts = stats.dailyTrend(
        ids: ['a', 'b'],
        daysOf: [ymd(now), ymd(now)],
        days: 2,
        today: ymd(now),
      );
      expect(stats.chartPoints(points: pts, series: 'inc').max, 10);
      expect(stats.chartPoints(points: pts, series: 'exp').max, 1000);
    });

    testWidgets('the axis names the ends of the range', (tester) async {
      add('a', 'exp', 30);
      await show(tester);
      expect(find.byKey(const Key('axis-first')), findsOneWidget);
      expect(find.byKey(const Key('axis-last')), findsOneWidget);
      final last = tester.widget<Text>(find.byKey(const Key('axis-last')));
      final d = DateTime.now();
      expect(last.data, '${d.month}/${d.day}');
    });

    testWidgets('switching the window changes how many points there are', (
      tester,
    ) async {
      add('a', 'exp', 30);
      await show(tester);
      await tester.tap(find.byKey(const Key('period-week')));
      await tester.pumpAndSettle();

      // The week runs Monday to Sunday, so the first point is this week's
      // Monday — not seven days back from today, which is what a fixed 7-day
      // window used to give and what made "this week" mean two different
      // things on one screen.
      final first = tester.widget<Text>(find.byKey(const Key('axis-first')));
      final now = DateTime.now();
      final monday = now.subtract(Duration(days: now.weekday - 1));
      expect(first.data, '${monday.month}/${monday.day}');
    });
  });

  group('the donut', () {
    testWidgets('slices sum to the whole circle', (tester) async {
      add('a', 'exp', 30, cat: 'food');
      add('b', 'exp', 10, cat: 'trans');
      final sl = stats.categorySlices(ids: ['a', 'b'], io: 'exp', zh: true);

      expect(sl, hasLength(2));
      expect(sl.first.cat, 'food'); // largest first
      expect(sl.first.frac, closeTo(0.75, 1e-12));
      expect(sl.first.start, 0);
      expect(sl.last.start, closeTo(0.75, 1e-12));
      expect(sl.last.frac, closeTo(0.25, 1e-12));
    });

    testWidgets('carries the name, emoji and colour a row needs', (
      tester,
    ) async {
      add('a', 'exp', 30, cat: 'food');
      final sl = stats.categorySlices(ids: ['a'], io: 'exp', zh: true);
      expect(sl.first.name, '餐饮');
      expect(sl.first.emoji, '🍜');
      expect(sl.first.color, startsWith('#'));
      // and in the other language
      expect(
        stats.categorySlices(ids: ['a'], io: 'exp', zh: false).first.name,
        'Food',
      );
    });

    testWidgets('an empty direction says so rather than drawing nothing', (
      tester,
    ) async {
      add('a', 'exp', 30);
      await show(tester);
      await tester.tap(find.byKey(const Key('io-inc')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('donut-empty')), findsOneWidget);
    });

    testWidgets('renders the arcs it was given', (tester) async {
      add('a', 'exp', 30, cat: 'food');
      add('b', 'exp', 10, cat: 'trans');
      await show(tester);
      expect(find.byKey(const Key('donut')), findsOneWidget);
      expect(find.text('75%'), findsOneWidget);
      expect(find.text('25%'), findsOneWidget);
    });
  });

  group('the painters do no arithmetic', () {
    testWidgets('the chart box is the core\'s, not the canvas\'s', (
      tester,
    ) async {
      final pts = stats.dailyTrend(
        ids: [],
        daysOf: [],
        days: 3,
        today: ymd(now),
      );
      final c = stats.chartPoints(points: pts, series: 'both');
      // 300×96 — the painter scales this to whatever it is given, and that
      // scale is the only arithmetic left on the Dart side
      expect(c.width, 300);
      expect(c.height, 96);
    });
  });

  // ---- the page, through the one call the screen makes ----

  stats.StatsPage page({String period = 'month', String io = 'exp'}) {
    final live = store.liveEntries();
    DateTime at(store.EntryView e) => DateTime.fromMillisecondsSinceEpoch(e.ts);
    return stats.statsPage(
      ids: [for (final e in live) e.id],
      daysOf: [for (final e in live) ymd(e.ts)],
      dows: [for (final e in live) at(e).weekday % 7],
      hours: [for (final e in live) at(e).hour],
      anchor: ymd(now),
      period: period,
      io: io,
      today: ymd(now),
      zh: true,
    );
  }

  Finder statsList() => find.descendant(
    of: find.byKey(const Key('stats-list')),
    matching: find.byType(Scrollable),
  );

  group('what a window is drawn as', () {
    /// One point is not a trend, so a day is charted as its week.
    testWidgets('a day is the seven days up to it', (tester) async {
      add('a', 'exp', 30);
      final t = page(period: 'day').trend;
      expect(t.points, hasLength(7));
      expect(t.weekly, isFalse);
      expect(t.values.last, 30, reason: 'the day itself is the last point');
    });

    /// 365 daily points on a phone are a hairbrush.
    testWidgets('a year is a point a week', (tester) async {
      add('a', 'exp', 30);
      final t = page(period: 'year').trend;
      expect(t.weekly, isTrue);
      expect(t.points.length, inInclusiveRange(1, 53));
    });

    /// The reason the curve is monotone cubic and not the obvious one: a day
    /// of nothing between two big days must not dip below the axis. In the
    /// box y runs downward, so below zero is a y greater than `zero`.
    testWidgets('the curve never draws spending below zero', (tester) async {
      add('a', 'exp', 300, ts: now - 2 * day);
      add('b', 'exp', 300, ts: now);
      // the day window's seven days hold both, and the empty day between
      final t = page(period: 'day').trend;
      expect(t.curve, isNotEmpty);
      for (final c in t.curve) {
        expect(c.c1Y, lessThanOrEqualTo(t.zero + 1e-9));
        expect(c.c2Y, lessThanOrEqualTo(t.zero + 1e-9));
      }
    });

    /// A scale floored at 1 would otherwise label an empty chart ¥0, ¥1, ¥1.
    testWidgets('an empty window has only its baseline', (tester) async {
      final t = page().trend;
      expect(t.ticks, hasLength(1));
      expect(t.ticks.single.value, 0);
      expect(t.peak, isNull, reason: 'no peak to point at');
    });

    testWidgets('the peak is the largest day', (tester) async {
      add('a', 'exp', 10, ts: now - day);
      add('b', 'exp', 90, ts: now);
      final t = page(period: 'week').trend;
      expect(t.values[t.peak!], 90);
    });
  });

  group('the last six windows', () {
    testWidgets('end with this one, as shares of the tallest', (tester) async {
      add('a', 'exp', 30);
      add('b', 'exp', 60, ts: now - 45 * day);
      final p = page().periods;
      expect(p, hasLength(6));
      expect(p.last.total, 30, reason: 'the window on screen is the last');
      expect(p.fold<double>(0, (a, b) => a + b.total), 90);
      expect(p.map((b) => b.frac).reduce((a, b) => a > b ? a : b), 1);
    });
  });

  group('the largest entries', () {
    testWidgets('come largest first, five at most', (tester) async {
      for (var i = 1; i <= 7; i++) {
        add('e$i', 'exp', i * 10.0);
      }
      final top = page().top;
      expect(top, hasLength(5));
      expect(top.first.amt, 70);
      for (var i = 1; i < top.length; i++) {
        expect(top[i].amt, lessThanOrEqualTo(top[i - 1].amt));
      }
    });

    testWidgets('open the entry they name', (tester) async {
      add('small', 'exp', 10);
      add('big', 'exp', 900);
      String? opened;
      await tester.pumpWidget(
        MaterialApp(home: StatsScreen(onEdit: (id) => opened = id)),
      );
      await tester.pumpAndSettle();
      await scrollAndTap(
        tester,
        find.byKey(const Key('top-big')),
        scrollable: statsList(),
      );
      expect(opened, 'big');
    });
  });

  group('this month against the last', () {
    /// Placed on the 1st of last month, which is inside the same elapsed
    /// days of the last cycle whatever today is.
    void lastMonth(String id, double amt) {
      final n = DateTime.now();
      add(
        id,
        'exp',
        amt,
        ts: DateTime(n.year, n.month - 1, 1, 12).millisecondsSinceEpoch,
      );
    }

    testWidgets('is said in the word the core chose', (tester) async {
      lastMonth('old', 100);
      add('new', 'exp', 300);
      final c = page().compare!;
      expect(c.verdict, 'more');
      expect(c.diff, 200);
      expect(c.thisLine, hasLength(c.lastLine.length));

      await show(tester);
      final pill = find.descendant(
        of: find.byKey(const Key('compare-verdict')),
        matching: find.byType(Text),
      );
      expect(tester.widget<Text>(pill).data, '比上月同期多 ￥200');
    });

    testWidgets('within five per cent is the same', (tester) async {
      lastMonth('old', 100);
      add('new', 'exp', 103);
      expect(page().compare!.verdict, 'same');
    });

    /// "¥300 more than a month of nothing" is true and useless.
    testWidgets('nothing last month says nothing', (tester) async {
      add('new', 'exp', 300);
      expect(page().compare!.verdict, 'none');
      await show(tester);
      expect(find.byKey(const Key('compare-verdict')), findsNothing);
    });

    testWidgets('is a month\'s alone', (tester) async {
      add('new', 'exp', 300);
      expect(page(period: 'week').compare, isNull);
      expect(page(period: 'year').compare, isNull);
    });
  });

  group('habits', () {
    testWidgets('seven weekdays from Sunday, seven times of day', (
      tester,
    ) async {
      add('a', 'exp', 30);
      final p = page();
      expect(p.weekday.map((b) => b.key), ['0', '1', '2', '3', '4', '5', '6']);
      expect(p.hours.map((b) => b.key), [
        'dawn',
        'earlyMorning',
        'morning',
        'noon',
        'afternoon',
        'dusk',
        'night',
      ]);
      final today = DateTime.now().weekday % 7;
      expect(p.weekday[today].amt, 30);
      expect(p.weekday[today].frac, 1);
    });
  });

  group('the screen', () {
    testWidgets('a finger on the trend reads the day under it', (tester) async {
      add('a', 'exp', 30);
      await show(tester);
      String readout() =>
          tester.widget<Text>(find.byKey(const Key('trend-readout'))).data!;
      expect(readout(), startsWith('最高'), reason: 'at rest it names the peak');

      // the far left of the chart is the window's first day
      final chart = tester.getRect(find.byKey(const Key('trend')));
      await tester.tapAt(chart.centerLeft + const Offset(2, 0));
      await tester.pumpAndSettle();
      final first = page().trend.points.first.day.split('-');
      expect(readout(), startsWith('${first[1]}月${first[2]}日'));
    });

    testWidgets('picking a category shows it in the ring', (tester) async {
      add('a', 'exp', 30, cat: 'food');
      add('b', 'exp', 10, cat: 'trans');
      await show(tester);
      expect(find.byKey(const Key('donut-picked')), findsNothing);
      await scrollAndTap(
        tester,
        find.byKey(const Key('cat-row-trans')),
        scrollable: statsList(),
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('donut-picked'))).data,
        '25%',
      );
      // and again puts it back
      await tester.tap(find.byKey(const Key('cat-row-trans')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('donut-picked')), findsNothing);
    });

    testWidgets('the direction redraws the page, not just the ring', (
      tester,
    ) async {
      add('a', 'exp', 30, cat: 'food');
      add('b', 'inc', 100, cat: 'salary');
      await show(tester);
      await tester.tap(find.byKey(const Key('io-inc')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('trend-readout'))).data,
        contains('100'),
        reason: 'the trend follows the direction too',
      );
      await scrollTo(tester, find.text('钱从哪儿来'), scrollable: statsList());
      expect(find.text('钱从哪儿来'), findsOneWidget);
    });
  });
}
