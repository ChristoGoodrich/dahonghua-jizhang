// What the app does with a real number of entries.
//
// Five a day for three years is about 5,000 rows, which is an ordinary ledger
// rather than a stress test. At that size the app used to stall for a fifth of
// a second on every record, every delete and **every keystroke in the search
// box**, and the reason was one line repeated twelve times:
//
//     ids.iter().filter_map(|id| s.ledger.get(id))
//
// `Ledger::get` is a linear scan. Called once per id in a list that is itself
// the whole ledger, that is O(n²) — twelve and a half million string
// comparisons at 5,000 rows — and 统计, 预算, 报销, 报表, 结算单, 导出 and 搜索
// all had the same shape as 明细. `api::store::by_id` builds the map once
// instead.
//
// ## Why there is a clock in here at all
//
// Timing assertions are usually a bad idea: they fail on a loaded machine and
// teach people to rerun until green. This one earns its place because the
// defect it guards is **invisible to every other kind of test**. A quadratic
// list and a linear one return byte-identical answers; the only thing that
// differs is how long they take, so a correctness test cannot tell them apart
// and this is the only thing standing between the app and a silent return to
// a fifth-of-a-second hitch.
//
// What it bounds is growth, not milliseconds. Each operation is timed at a
// quarter of the ledger and again at all of it: linear work takes about four
// times as long for four times the rows, a little more where there is a sort,
// and the quadratic shape takes sixteen — less in practice, because the
// linear part still counts at a quarter. Measured on the emulator: 2.6× to
// 5.6× for the code as it is, 13.5× with `list_items` put back to a scan per
// id. The bound is eight, between them.
//
// It used to be 300ms flat, set between about 110ms linear and about 550ms
// quadratic on the emulator it was measured on. Milliseconds belong to the
// machine: CI's emulator renders in software, and there the LINEAR list took
// 361ms and failed. A ratio taken on one machine, in one run, cancels the
// machine out. Each size is the fastest of three runs, so the first call's
// warm-up or a collection mid-run is not what gets measured.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/src/rust/api/search.dart' as search;
import 'package:flutter_app/src/rust/api/stats.dart' as stats;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

const day = 86400000;
int get now => DateTime.now().millisecondsSinceEpoch;

/// Three years of a ledger somebody actually keeps.
const big = 8000;

/// The smaller ledger each timing is compared against.
const quarter = big ~/ 4;

/// Add [n] entries, numbered from [from] — so a second fill carries on where
/// the first stopped, with new ids and older days.
void fill(int n, {String prefix = 'e', int from = 0}) {
  final t = now;
  for (var i = from; i < from + n; i++) {
    store.addEntry(
      entry: store.NewEntry(
        io: i % 5 == 0 ? 'inc' : 'exp',
        cat: i % 3 == 0 ? 'food' : 'trans',
        amt: 12.5 + i % 90,
        note: '条目 $i',
        // Six a day, so the day grouping has real work to do.
        ts: t - (i ~/ 6) * day,
      ),
      id: '$prefix$i',
      now: t,
    );
  }
}

List<String> idsOf(List<store.EntryView> live) => [for (final e in live) e.id];

/// The fastest of three runs of [timed], which returns microseconds.
int fastest(int Function() timed) =>
    [for (var i = 0; i < 3; i++) timed()].reduce(math.min);

typedef Growth = ({double ratio, int small, int large});

/// How many times longer [timed] takes over [big] rows than over [quarter].
///
/// Starts from an empty ledger, so a test can call it more than once.
Growth growth(int Function() timed) {
  store.reset();
  fill(quarter);
  final small = fastest(timed);
  fill(big - quarter, from: quarter);
  final large = fastest(timed);
  return (ratio: large / math.max(small, 1), small: small, large: large);
}

/// Four times the rows may cost about four times the time, not sixteen.
void expectLinear(Growth g, String what, {String? why}) {
  final said =
      '$what: ${g.small}µs over $quarter rows, ${g.large}µs over $big — '
      '${g.ratio.toStringAsFixed(1)}× for 4× the rows';
  // Printed on a pass too: the margin is worth seeing in a CI log before it
  // is gone, rather than after.
  debugPrint(said);
  expect(
    g.ratio,
    lessThan(8),
    reason:
        '$said. Linear is about 4×, quadratic 16×.'
        '${why == null ? '' : ' $why'}',
  );
}

List<String> daysOf(List<store.EntryView> live) => [
  for (final e in live) localDay(DateTime.fromMillisecondsSinceEpoch(e.ts)),
];

/// Pump the list, guaranteeing a fresh `State`.
///
/// `_EntryListScreenState` reads the ledger in `initState`, so a reused
/// element would render an earlier test's rows. `testWidgets` tears the tree
/// down between tests, so this is a precaution rather than a fix — and it is
/// worth saying so, because it was first added as the fix for a failure it
/// did not cause. That failure is described on the duplicate-id test below.
Future<void> showList(WidgetTester tester, String tag) async {
  await tester.pumpWidget(
    MaterialApp(key: ValueKey(tag), home: const EntryListScreen()),
  );
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('a ledger of $big', () {
    testWidgets('the day grouping stays linear', (tester) async {
      var rows = 0;
      final g = growth(() {
        final live = store.liveEntries();
        final ids = idsOf(live);
        final days = daysOf(live);
        final clock = Stopwatch()..start();
        final items = store.listItems(
          ids: ids,
          days: days,
          today: localDay(DateTime.now()),
          columns: 1,
        );
        final us = clock.elapsedMicroseconds;
        rows = items.length;
        return us;
      });

      expect(rows, greaterThan(big));
      expectLinear(
        g,
        'listItems',
        why:
            'A per-id `ledger.get` is a linear scan and this is where it '
            'turns quadratic.',
      );
    });

    testWidgets('and so does searching', (tester) async {
      var found = 0;
      final g = growth(() {
        final ids = idsOf(store.liveEntries());
        final clock = Stopwatch()..start();
        final hits = search.searchIds(ids: ids, text: '条目 7', zh: true);
        final us = clock.elapsedMicroseconds;
        found = hits.length;
        return us;
      });

      expect(found, greaterThan(0));
      expectLinear(g, 'searchIds');
    });

    testWidgets('and the statistics', (tester) async {
      var sliced = 0;
      final g = growth(() {
        final ids = idsOf(store.liveEntries());
        final clock = Stopwatch()..start();
        final slices = stats.categorySlices(ids: ids, io: 'exp', zh: true);
        final us = clock.elapsedMicroseconds;
        sliced = slices.length;
        return us;
      });

      expect(sliced, greaterThan(0));
      expectLinear(g, 'categorySlices');
    });

    /// `rows_of` in the stats bridge was a `find` per id over the ledger —
    /// the same quadratic shape, missed when the other twelve were fixed.
    testWidgets('and the trend', (tester) async {
      final today = localDay(DateTime.now());
      var points = 0;
      final g = growth(() {
        final live = store.liveEntries();
        final ids = idsOf(live);
        final days = daysOf(live);
        final clock = Stopwatch()..start();
        final pts = stats.dailyTrend(
          ids: ids,
          daysOf: days,
          days: 30,
          today: today,
        );
        final us = clock.elapsedMicroseconds;
        points = pts.length;
        return us;
      });

      expect(points, 30);
      expectLinear(g, 'dailyTrend');
    });

    /// The whole stats screen is one call now, over every live row: the
    /// window, the trend, six windows, the comparison, the top five and the
    /// habits. A year is its most expensive window.
    testWidgets('and the whole stats page', (tester) async {
      final today = localDay(DateTime.now());

      for (final period in ['month', 'year']) {
        var counted = 0;
        final g = growth(() {
          final live = store.liveEntries();
          final at = [
            for (final e in live) DateTime.fromMillisecondsSinceEpoch(e.ts),
          ];
          final ids = idsOf(live);
          final days = daysOf(live);
          final dows = [for (final d in at) d.weekday % 7];
          final hours = [for (final d in at) d.hour];
          final clock = Stopwatch()..start();
          final page = stats.statsPage(
            ids: ids,
            daysOf: days,
            dows: dows,
            hours: hours,
            anchor: today,
            period: period,
            io: 'exp',
            today: today,
            zh: true,
          );
          final us = clock.elapsedMicroseconds;
          counted = page.overview.count;
          return us;
        });
        expect(counted, greaterThan(0));
        expectLinear(g, 'statsPage($period)');
      }
    });

    /// The screen still renders a ledger that went through the map. This is a
    /// smoke test of the seam, not of the duplicate rule — the rows' text is
    /// drawn from the Dart side's own id map over `liveEntries()`, and only
    /// the order and grouping came back through `listItems` and `by_id`.
    testWidgets('the list still says what it said', (tester) async {
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 35.5,
          note: '午饭',
          ts: now,
        ),
        id: 'lunch',
        now: now,
      );
      fill(200);
      await showList(tester, 'lunch');

      expect(find.text('午饭'), findsOneWidget);
      expect(find.text('-35.50'), findsOneWidget);
      expect(store.liveEntries().length, 201);
    });

    /// A map built by `collect` keeps the LAST row with a given id; the scan
    /// it replaced returned the FIRST. Ids are unique in practice and a
    /// duplicate is a bug somewhere else — but a performance change that
    /// quietly answers differently in the one case nobody tests is not a
    /// performance change, so `by_id` uses `or_insert` and this holds it to
    /// that.
    ///
    /// ## Why this goes through the statistics and not the screen
    ///
    /// An earlier version rendered the list and counted the notes. It failed
    /// two runs in three, and it was not flaky so much as wrong: the list
    /// draws its rows from Dart's own `{for (e in live) e.id: e}`, where the
    /// LAST duplicate wins, so `by_id` never decided what text appeared at
    /// all. It passed only when a millisecond ticked between the two
    /// `addEntry` calls, because `now` is a getter — a later timestamp sorted
    /// the second row first, and Dart's last-wins then happened to land on
    /// the first. The test was tracking the emulator's clock.
    ///
    /// `categorySlices` reads through `by_id` and its answer differs between
    /// the two rules: resolve both ids to 餐饮 10 and the slice is 餐饮 20;
    /// resolve both to 交通 99 and it is 交通 198. One fixed timestamp for both
    /// rows, so nothing here depends on how fast the machine is.
    testWidgets('a duplicated id resolves the way the scan did — first wins', (
      tester,
    ) async {
      final t = now;
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 10,
          note: '第一个',
          ts: t,
        ),
        id: 'same',
        now: t,
      );
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'trans',
          amt: 99,
          note: '第二个',
          ts: t,
        ),
        id: 'same',
        now: t,
      );
      expect(store.entryCount(), 2, reason: 'the ledger holds both rows');

      // The scan's answer, which is the rule being matched.
      expect(store.getEntry(id: 'same')!.note, '第一个');

      final slices = stats.categorySlices(
        ids: ['same', 'same'],
        io: 'exp',
        zh: true,
      );
      expect(slices, hasLength(1), reason: 'both ids resolve to one row');
      expect(slices.single.cat, 'food', reason: 'the first row, not the last');
      expect(slices.single.amt, 20);
    });
  });
}
