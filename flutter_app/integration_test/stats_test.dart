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

    testWidgets('count includes transfers even though no total does',
        (tester) async {
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
        ids: ['a'], daysOf: [ymd(now)], days: 7, today: ymd(now),
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
        ids: [], daysOf: [], days: 5, today: ymd(now),
      );
      final c = stats.chartPoints(points: pts, series: 'both');
      expect(c.max, 1); // the guard, rather than a zero divisor
      expect(c.exp.every((p) => p.y == 89), isTrue);
    });

    testWidgets('a series nobody draws does not set the scale', (tester) async {
      add('a', 'exp', 1000, ts: now);
      add('b', 'inc', 10, ts: now);
      final pts = stats.dailyTrend(
        ids: ['a', 'b'], daysOf: [ymd(now), ymd(now)], days: 2, today: ymd(now),
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

    testWidgets('switching the window changes how many points there are',
        (tester) async {
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

    testWidgets('carries the name, emoji and colour a row needs', (tester) async {
      add('a', 'exp', 30, cat: 'food');
      final sl = stats.categorySlices(ids: ['a'], io: 'exp', zh: true);
      expect(sl.first.name, '餐饮');
      expect(sl.first.emoji, '🍜');
      expect(sl.first.color, startsWith('#'));
      // and in the other language
      expect(stats.categorySlices(ids: ['a'], io: 'exp', zh: false).first.name,
          'Food');
    });

    testWidgets('an empty direction says so rather than drawing nothing',
        (tester) async {
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
    testWidgets('the chart box is the core\'s, not the canvas\'s', (tester) async {
      final pts = stats.dailyTrend(
        ids: [], daysOf: [], days: 3, today: ymd(now),
      );
      final c = stats.chartPoints(points: pts, series: 'both');
      // 300×96 — the painter scales this to whatever it is given, and that
      // scale is the only arithmetic left on the Dart side
      expect(c.width, 300);
      expect(c.height, 96);
    });
  });
}
