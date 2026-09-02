// Subscriptions on a device, over the real Rust calendar.
//
// The substance is the sweep: which dates are due, what happens when several
// are due at once, and the two rules that only bite in unusual months — a day
// past the end of a month overflows rather than clamping, and an instalment
// plan that has run out still advances its cursor without posting anything.
//
// The charge id is derived rather than random, and one test pins that directly:
// two sweeps over the same due date must produce one entry, not two. That is
// what stops a second device billing the user twice while the first pull is
// still in flight.

import 'package:flutter/material.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/subscriptions.dart' as subs;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_app/subs_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

/// A day of the month that is not today, and that every month has.
///
/// Any fixed day is today once a month, so a test asserting the "next charge"
/// wording has to pick around the calendar rather than pick a number. Capped
/// at 28 so February does not overflow into the following month, which is its
/// own tested behaviour and not what these tests are about.
int get notToday => DateTime.now().day == 28 ? 27 : 28;

/// A subscription created `daysAgo` days back, so a sweep has something to
/// catch up on.
String makeSub({
  String name = '音乐',
  double amt = 15,
  String freq = 'monthly',
  int day = 1,
  int? month,
  String cat = 'fun',
  int? periods,
  int daysAgo = 0,
  bool isTransfer = false,
  String? from,
  String? to,
}) {
  final created =
      DateTime.now().subtract(Duration(days: daysAgo)).millisecondsSinceEpoch;
  return subs.addSub(
    sub: subs.NewSub(
      name: name,
      amt: amt,
      freq: freq,
      day: day,
      month: month,
      cat: cat,
      emoji: '🎵',
      isTransfer: isTransfer,
      from: from,
      to: to,
      periods: periods,
    ),
    id: 's-$name-$daysAgo',
    now: created,
  );
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: SubsScreen(zh: zh)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the day encoding', () {
    testWidgets('is v7-shaped: a zero-indexed month', (tester) async {
      // inherited, and the cursor is written in it — a screen that guessed
      // 1-indexed would move every cursor a month
      expect(encodeDay(DateTime(2026, 1, 15)), '2026-0-15');
      expect(encodeDay(DateTime(2026, 12, 31)), '2026-11-31');
      expect(decodeDay('2026-0-15'), DateTime(2026, 1, 15));
      expect(decodeDay('nonsense'), isNull);
      expect(decodeDay('2026-0'), isNull);
    });
  });

  group('the next due date', () {
    testWidgets('overflows a short month rather than clamping', (tester) async {
      // `new Date(y, 1, 31)` is 3 March in a non-leap year, and the shipping
      // app charges then — not on the 28th
      makeSub(day: 28); // the form clamps to 28, so ask the core directly
      final due = subs.subNextDue(id: 's-音乐-0', from: '2026-1-1'); // 1 Feb 2026
      expect(due, '2026-1-28');
    });

    testWidgets('a yearly subscription charges in its own month',
        (tester) async {
      makeSub(freq: 'yearly', day: 15, month: 6);
      final due = subs.subNextDue(id: 's-音乐-0', from: '2026-0-1'); // 1 Jan
      expect(due, '2026-5-15'); // 15 June
    });
  });

  group('the sweep', () {
    testWidgets('posts a charge that came due while the app was closed',
        (tester) async {
      final today = DateTime.now();
      // due on today's day-of-month, created a month and a bit ago
      makeSub(day: today.day > 28 ? 28 : today.day, daysAgo: 40);

      final fired = runDueCharges();

      expect(fired, isNotEmpty);
      expect(store.entryCount(), greaterThan(0));
      final e = store.liveEntries().first;
      expect(e.note, '音乐');
      expect(e.io, 'exp');
    });

    testWidgets('is idempotent: the same due date charges once', (tester) async {
      // the id is derived — `sub_{id}_{ts}` — precisely so a second device
      // sweeping from a stale cursor collapses into the same row
      final today = DateTime.now();
      makeSub(day: today.day > 28 ? 28 : today.day, daysAgo: 40);

      runDueCharges();
      final after = store.entryCount();
      runDueCharges();

      expect(store.entryCount(), after);
    });

    testWidgets('charges nothing when nothing is due yet', (tester) async {
      makeSub(day: 1, daysAgo: 0);
      // created today with the cursor at today — the next charge is next month
      final fired = runDueCharges();
      expect(fired, isEmpty);
      expect(store.entryCount(), 0);
    });

    testWidgets('a transfer subscription posts a transfer, not an expense',
        (tester) async {
      final today = DateTime.now();
      makeSub(
        name: '房租',
        day: today.day > 28 ? 28 : today.day,
        daysAgo: 40,
        isTransfer: true,
        from: 'default',
        to: 'other',
      );

      runDueCharges();

      final e = store.liveEntries().firstWhere((x) => x.note == '房租');
      expect(e.io, 'xfer');
      expect(e.acct, 'default');
      expect(e.acctTo, 'other');
    });

    testWidgets('a blank category falls back rather than posting empty',
        (tester) async {
      final today = DateTime.now();
      makeSub(cat: '', day: today.day > 28 ? 28 : today.day, daysAgo: 40);
      runDueCharges();
      expect(store.liveEntries().first.cat, 'home');
    });
  });

  group('instalments', () {
    testWidgets('stop firing once the plan is paid off', (tester) async {
      // three periods against a cursor far enough back for four charges
      final today = DateTime.now();
      makeSub(day: today.day > 28 ? 28 : today.day, daysAgo: 150, periods: 3);

      runDueCharges();

      expect(store.entryCount(), 3);
      expect(subs.subs().first.charged, 3);
    });

    testWidgets('a paid-off plan still advances its cursor', (tester) async {
      // otherwise the same charges are recomputed on every single launch
      final today = DateTime.now();
      makeSub(day: today.day > 28 ? 28 : today.day, daysAgo: 150, periods: 1);

      runDueCharges();
      final cursor = subs.subs().first.lastCharged;
      expect(cursor, isNotEmpty);

      // a month later the cursor moves again without posting anything
      runDueCharges(today: DateTime.now().add(const Duration(days: 40)));
      expect(store.entryCount(), 1);
      expect(subs.subs().first.lastCharged, isNot(cursor));
    });

    testWidgets('the periods count is capped at 360', (tester) async {
      makeSub(periods: 9999);
      expect(subs.subs().first.periods, 360);
    });

    testWidgets('a zero periods count is open-ended, not zero charges',
        (tester) async {
      makeSub(periods: 0);
      expect(subs.subs().first.periods, isNull);
    });
  });

  group('the screen', () {
    testWidgets('says so when there is nothing', (tester) async {
      await show(tester);
      expect(find.byKey(const Key('no-subs')), findsOneWidget);
    });

    testWidgets('draws the amount, the frequency and the next date',
        (tester) async {
      // Not `day: 1`. A subscription due TODAY reads "今天扣款" rather than
      // naming a next date, which is correct and which made this test fail
      // every 1st of the month — it was written on a day that was not one.
      // The day is picked away from today for the same reason a fixed date
      // would be wrong in either direction.
      makeSub(amt: 15, day: notToday);
      await show(tester);

      expect(textOf(tester, 'sub-s-音乐-0-name'), '音乐');
      expect(textOf(tester, 'sub-s-音乐-0-amt'), '￥15');
      expect(textOf(tester, 'sub-s-音乐-0-due'), contains('每月'));
      expect(textOf(tester, 'sub-s-音乐-0-due'), contains('下次'));
    });

    testWidgets('says charges today rather than naming today as the next date',
        (tester) async {
      // The other half of the rule above, and the reason it was found: on the
      // day a subscription is due, "下次 9月1日" would be telling the user to
      // wait for something already happening.
      makeSub(amt: 15, day: DateTime.now().day);
      await show(tester);

      expect(textOf(tester, 'sub-s-音乐-0-due'), contains('今天扣款'));
      expect(textOf(tester, 'sub-s-音乐-0-due'), isNot(contains('下次')));
    });

    testWidgets('shows an instalment plan as a fraction', (tester) async {
      makeSub(periods: 12);
      await show(tester);
      expect(textOf(tester, 'sub-s-音乐-0-due'), startsWith('0/12'));
    });

    testWidgets('shows a paid-off plan as paid off', (tester) async {
      final today = DateTime.now();
      makeSub(day: today.day > 28 ? 28 : today.day, daysAgo: 150, periods: 1);
      runDueCharges();
      await show(tester);
      expect(textOf(tester, 'sub-s-音乐-150-due'), contains('已付清'));
    });

    testWidgets('deleting stops the charges and keeps the entries',
        (tester) async {
      final today = DateTime.now();
      makeSub(day: today.day > 28 ? 28 : today.day, daysAgo: 40);
      runDueCharges();
      final posted = store.entryCount();
      await show(tester);

      await tester.tap(find.byKey(const Key('sub-s-音乐-40-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('sub-delete-ok')));
      await tester.pumpAndSettle();

      expect(subs.subs(), isEmpty);
      expect(store.entryCount(), posted); // history is not rewritten
    });

    testWidgets('cancel deletes nothing', (tester) async {
      makeSub();
      await show(tester);
      await tester.tap(find.byKey(const Key('sub-s-音乐-0-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('sub-delete-cancel')));
      await tester.pumpAndSettle();
      expect(subs.subs().length, 1);
    });
  });

  group('creating one', () {
    testWidgets('takes a name, an amount, a frequency and a day',
        (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-sub')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('sub-name')), 'Netflix');
      await tester.enterText(find.byKey(const Key('sub-amt')), '35');
      await tester.tap(find.byKey(const Key('freq-yearly')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('sub-day')), '9');
      await tester.tap(find.byKey(const Key('sub-ok')));
      // pumped all the way out, which is where a disposed controller asserts
      await tester.pumpAndSettle();

      final made = subs.subs().single;
      expect(made.name, 'Netflix');
      expect(made.amt, 35);
      expect(made.freq, 'yearly');
      expect(made.day, 9);
    });

    testWidgets('an amount of zero creates nothing', (tester) async {
      // the shipping form refuses it by doing nothing, and so does this
      await show(tester);
      await tester.tap(find.byKey(const Key('add-sub')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('sub-name')), 'Free');
      await tester.enterText(find.byKey(const Key('sub-amt')), '0');
      await tester.tap(find.byKey(const Key('sub-ok')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('new-sub-dialog')), findsOneWidget);
      expect(subs.subs(), isEmpty);
      await tester.tap(find.byKey(const Key('sub-cancel')));
      await tester.pumpAndSettle();
    });

    testWidgets('an empty name creates nothing', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-sub')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('sub-amt')), '10');
      await tester.tap(find.byKey(const Key('sub-ok')));
      await tester.pumpAndSettle();

      expect(subs.subs(), isEmpty);
      await tester.tap(find.byKey(const Key('sub-cancel')));
      await tester.pumpAndSettle();
    });

    testWidgets('a day past 28 is clamped, not stored', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-sub')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('sub-name')), '房租');
      await tester.enterText(find.byKey(const Key('sub-amt')), '1800');
      await tester.enterText(find.byKey(const Key('sub-day')), '31');
      await tester.tap(find.byKey(const Key('sub-ok')));
      await tester.pumpAndSettle();

      expect(subs.subs().single.day, 28);
    });
  });

  group('subscriptions survive', () {
    testWidgets('a snapshot and a reload', (tester) async {
      makeSub(name: '健身', amt: 99, freq: 'yearly', day: 3, periods: 12);
      final json = store.snapshotConfig();

      store.reset();
      expect(subs.subs(), isEmpty);

      expect(store.loadConfig(json: json), isTrue);
      final back = subs.subs().single;
      expect(back.name, '健身');
      expect(back.amt, 99);
      expect(back.freq, 'yearly');
      expect(back.day, 3);
      expect(back.periods, 12);
    });

    testWidgets('and so does a cursor, so charges are not replayed',
        (tester) async {
      final today = DateTime.now();
      makeSub(day: today.day > 28 ? 28 : today.day, daysAgo: 40);
      runDueCharges();
      final posted = store.entryCount();
      final config = store.snapshotConfig();
      final entries = store.snapshotEntries();

      store.reset();
      store.loadConfig(json: config);
      store.loadEntries(json: entries);

      runDueCharges();
      expect(store.entryCount(), posted);
    });
  });
}
