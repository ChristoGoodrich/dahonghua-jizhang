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
// What it bounds is growth, not milliseconds. Each operation is timed over
// 1,000 rows and again over 16,000. Sixteen times the rows costs linear work
// about sixteen times the time — more where there is a sort — and quadratic
// work up to 256, less in practice because its linear part still counts at
// 1,000 rows. A ratio taken on one machine, in one run, cancels the
// machine out: the bound used to be 300ms flat, set on one emulator, and on
// CI's emulator, which renders in software, the LINEAR list took 361ms.
//
// The spread is wide on purpose. The first version compared 2,000 rows with
// 8,000 against a bound of 8, and the code as it is measured up to 7.8 there
// — it failed now and then on nothing. Measured on the emulator, six rounds
// each, fastest of five runs per size:
//
//                      the code as it is      list_items scanning per id
//     2,000 → 8,000    2.4× – 7.8×           13.0× – 14.5×
//     1,000 → 16,000   7.8× – 54×            123× – 163×
//
// The wider spread takes the gap between the worst of one and the best of the
// other from 1.7× to 2.3×. The bound is 90: 1.65
// times the worst the real code did (the list, which sorts) and 1.37 times
// under the best the regression did — leaning toward the side that has
// actually failed. Each size is the fastest of five runs, so the first call's
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

/// Seven years at six a day. Bigger than most ledgers on purpose: the gap
/// between linear and quadratic widens with the spread. See the header.
const big = 16000;

/// The smaller ledger each timing is compared against.
const little = big ~/ 16;

/// How many times longer [big] rows may take than [little]. See the header.
const bound = 90;

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

/// The fastest of five runs of [timed], which returns microseconds.
int fastest(int Function() timed) =>
    [for (var i = 0; i < 5; i++) timed()].reduce(math.min);

typedef Growth = ({double ratio, int small, int large});

/// How many times longer [timed] takes over [big] rows than over [little].
///
/// Starts from an empty ledger, so a test can call it more than once.
Growth growth(int Function() timed) {
  store.reset();
  fill(little);
  final small = fastest(timed);
  fill(big - little, from: little);
  final large = fastest(timed);
  return (ratio: large / math.max(small, 1), small: small, large: large);
}

/// Sixteen times the rows may cost a few dozen times the time, not hundreds.
void expectLinear(Growth g, String what, {String? why}) {
  final said =
      '$what: ${g.small}µs over $little rows, ${g.large}µs over $big — '
      '${g.ratio.toStringAsFixed(1)}× for 16× the rows';
  // Printed on a pass too: the margin is worth seeing in a CI log before it
  // is gone, rather than after.
  debugPrint(said);
  expect(
    g.ratio,
    lessThan(bound),
    reason:
        '$said. The code as it is measured up to 54×, a quadratic list '
        '123× and more.${why == null ? '' : ' $why'}',
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

    /// Two entries recorded under one id are two rows under two ids.
    ///
    /// This used to hold `by_id` to the scan's first-wins answer for a ledger
    /// that held one id twice: a `collect` keeps the last row, the scan found
    /// the first. It went through the statistics rather than the screen
    /// because the screen could not answer at all — the list draws from Dart's
    /// `{for (e in live) e.id: e}`, where the last repeat wins, so one of the
    /// two entries was never shown. SQLite, keyed on the id, kept only the
    /// last of them past a restart.
    ///
    /// The ledger cannot hold a repeat any more (`core::ledger`): the second
    /// entry lands on `same-2`, and every reader — `get`, `by_id`, the list's
    /// map, the database — sees the same two rows. One fixed timestamp for
    /// both, so nothing here depends on the machine's clock.
    testWidgets('a second entry under a taken id lands on a free one', (
      tester,
    ) async {
      final t = now;
      final first = store.addEntry(
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
      final second = store.addEntry(
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
      expect(first, 'same');
      expect(second, 'same-2', reason: 'moved off the id the first holds');
      expect(store.entryCount(), 2, reason: 'the ledger holds both rows');
      expect(
        store.getEntry(id: 'same')!.note,
        '第一个',
        reason: 'and the first is untouched',
      );
      expect(store.getEntry(id: 'same-2')!.note, '第二个');

      // the list's own map, which a repeat used to collapse to one row
      final shown = {for (final e in store.liveEntries()) e.id: e.note};
      expect(shown, {'same': '第一个', 'same-2': '第二个'});

      final slices = stats.categorySlices(
        ids: [first, second],
        io: 'exp',
        zh: true,
      );
      expect({for (final s in slices) s.cat: s.amt}, {'food': 10, 'trans': 99});
    });
  });
}
