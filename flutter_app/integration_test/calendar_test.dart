// 明细's calendar: the cycle as a grid, the picked day's rows, and 补记这天.
//
// The shipping list turned into a month from a toggle in its header and the
// port dropped it. The grid is `api::calendar`'s; what these check is that it
// reaches the screen — the right days, what each spent, which can be picked —
// and that a day picked leads somewhere: its rows, and a new entry on it.

import 'package:flutter/material.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/src/rust/api/calendar.dart' as calendar;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';

const day = 86400000;
int get now => DateTime.now().millisecondsSinceEpoch;

String ymd(DateTime d) => '${d.year}-${d.month}-${d.day}';

void add(String id, double amt, {int? ts, String io = 'exp', String? note}) {
  final t = ts ?? now;
  store.addEntry(
    entry: store.NewEntry(io: io, cat: 'food', amt: amt, ts: t, note: note),
    id: id,
    now: t,
  );
}

Future<void> openCalendar(
  WidgetTester tester, {
  ValueChanged<int>? onRecordAt,
  Key? key,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: EntryListScreen(key: key, onRecordAt: onRecordAt),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('calendar-toggle')));
  await tester.pumpAndSettle();
}

Finder calList() => find.descendant(
  of: find.byKey(const Key('cal-list')),
  matching: find.byType(Scrollable),
);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  testWidgets('the toggle turns the list into this month', (tester) async {
    add('a', 30);
    await openCalendar(tester);
    expect(find.byKey(const Key('cal-grid')), findsOneWidget);
    final today = DateTime.now();
    expect(find.byKey(Key('cal-${ymd(today)}')), findsOneWidget);
    final first = DateTime(today.year, today.month, 1);
    expect(find.byKey(Key('cal-${ymd(first)}')), findsOneWidget);

    // and back
    await tester.tap(find.byKey(const Key('calendar-toggle')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cal-grid')), findsNothing);
  });

  testWidgets('a day shows what it spent', (tester) async {
    add('a', 128);
    await openCalendar(tester);
    final today = find.byKey(Key('cal-${ymd(DateTime.now())}'));
    expect(
      find.descendant(of: today, matching: find.text('128')),
      findsOneWidget,
    );
  });

  /// The grid's shading, through the bridge: a bigger day is deeper, and a day
  /// of nothing has no shade.
  testWidgets('a bigger day is shaded deeper', (tester) async {
    final t = DateTime.now();
    final other = t.day > 1
        ? DateTime(t.year, t.month, t.day - 1, 12)
        : DateTime(t.year, t.month, t.day, 9);
    add('big', 400);
    add('small', 25, ts: other.millisecondsSinceEpoch);
    final live = store.liveEntries();
    final m = calendar.calendarMonth(
      ids: [for (final e in live) e.id],
      daysOf: [
        for (final e in live) ymd(DateTime.fromMillisecondsSinceEpoch(e.ts)),
      ],
      anchor: ymd(t),
      today: ymd(t),
    );
    final big = m.cells.firstWhere((c) => c.day == ymd(t));
    expect(big.heat, 1.0);
    if (other.day != t.day) {
      final small = m.cells.firstWhere((c) => c.day == ymd(other));
      expect(small.heat, closeTo(0.25, 1e-9), reason: 'the root of 25/400');
    }
    expect(m.cells.where((c) => c.exp == 0).every((c) => c.heat == 0), isTrue);
  });

  testWidgets('picking a day lists its rows, and picking it again closes it', (
    tester,
  ) async {
    add('a', 30, note: '牛肉面');
    await openCalendar(tester);
    final today = Key('cal-${ymd(DateTime.now())}');
    await tester.tap(find.byKey(today));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('牛肉面'), scrollable: calList());
    expect(find.text('牛肉面'), findsOneWidget);

    await scrollTo(tester, find.byKey(today), scrollable: calList());
    await tester.tap(find.byKey(today));
    await tester.pumpAndSettle();
    expect(find.text('牛肉面'), findsNothing);
  });

  /// Backfilling matters most on the days with nothing recorded, so an empty
  /// day is pickable too, and 补记这天 opens a new entry at noon on it.
  testWidgets('补记这天 records on the day picked, at noon', (tester) async {
    add('a', 30);
    final t = DateTime.now();
    if (t.day == 1) return; // no earlier day in this cycle to pick
    final yesterday = DateTime(t.year, t.month, t.day - 1);
    int? at;
    await openCalendar(tester, onRecordAt: (ts) => at = ts);
    await tester.tap(find.byKey(Key('cal-${ymd(yesterday)}')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cal-day-empty')), findsOneWidget);

    await scrollAndTap(
      tester,
      find.byKey(const Key('cal-add')),
      scrollable: calList(),
    );
    final d = DateTime.fromMillisecondsSinceEpoch(at!);
    expect(ymd(d), ymd(yesterday));
    expect(d.hour, 12);
  });

  testWidgets('a day ahead of today cannot be picked', (tester) async {
    add('a', 30);
    final t = DateTime.now();
    final tomorrow = DateTime(t.year, t.month, t.day + 1);
    if (tomorrow.month != t.month) return; // it is in the next cycle
    await openCalendar(tester);
    await tester.tap(
      find.byKey(Key('cal-${ymd(tomorrow)}')),
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cal-day-head')), findsNothing);
  });

  testWidgets('the next month is shut until it has begun', (tester) async {
    add('a', 30);
    await openCalendar(tester);
    IconButton next() =>
        tester.widget<IconButton>(find.byKey(const Key('cal-next')));
    expect(next().onPressed, isNull);

    await tester.tap(find.byKey(const Key('cal-prev')));
    await tester.pumpAndSettle();
    expect(next().onPressed, isNotNull);
    final month = tester.widget<Text>(find.byKey(const Key('cal-month'))).data!;
    final last = DateTime(DateTime.now().year, DateTime.now().month - 1);
    expect(month, '${last.year}年${last.month}月');
  });

  /// The shell rebuilds 明细 after every save, and 补记这天 is a save made
  /// from the calendar: coming back must not land in the list.
  testWidgets('the calendar survives the rebuild after a save', (tester) async {
    add('a', 30);
    await openCalendar(tester, key: const ValueKey(1));
    await tester.pumpWidget(
      const MaterialApp(home: EntryListScreen(key: ValueKey(2))),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cal-grid')), findsOneWidget);
  });

  testWidgets('a search opens on the list', (tester) async {
    add('a', 30);
    await openCalendar(tester);
    await tester.tap(find.byKey(const Key('search-toggle')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cal-grid')), findsNothing);
  });
}
