// 汇率 — which source to believe, and what the sheet does with the answer.
//
// The network is injected. Two public APIs cannot be a test dependency: a
// suite that fails because a rate service is down is a suite people learn to
// ignore. What is testable is everything that decides — and all of that is
// Rust's, under a corpus — plus the one thing only a device shows: that a
// failed fetch saves the row anyway, with the cached rate, and says so.

import 'package:flutter/material.dart';
import 'package:flutter_app/record_sheet.dart' as sheet;
import 'package:flutter_app/src/rust/api/currency.dart' as currency;
import 'package:flutter_app/src/rust/api/rates.dart' as rates;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

/// A fetcher that answers whatever a test hands it, and records the ask.
class FakeRates {
  FakeRates({this.answer});

  rates.ResolvedRate? answer;
  int calls = 0;
  String? askedFor;
  String? askedDay;

  Future<rates.ResolvedRate> call({
    required String base,
    required String target,
    required String day,
    required String today,
    required int nowMinutes,
    double? cached,
  }) async {
    calls++;
    askedFor = target;
    askedDay = day;
    return answer ??
        rates.resolveRate(
          sameCurrency: false,
          liveAllowed: false,
          cached: cached,
        );
  }
}

String today() {
  final d = DateTime.now();
  return '${d.year}-${d.month}-${d.day}';
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('what an API answer is worth', () {
    testWidgets('a rate is inverted into the store convention',
        (tester) async {
      // The APIs say "1 base = X target"; the store holds "1 target = N base".
      expect(rates.invertRate(raw: 4.0), 0.25);
    });

    testWidgets('six decimal places, because that is what gets stored',
        (tester) async {
      expect(rates.invertRate(raw: 3.0), 0.333333);
    });

    testWidgets('a zero, a negative and an infinity are all refused',
        (tester) async {
      expect(rates.invertRate(raw: 0), isNull);
      expect(rates.invertRate(raw: -2), isNull);
      expect(rates.invertRate(raw: double.infinity), isNull);
      expect(rates.invertRate(raw: double.nan), isNull);
    });

    testWidgets('no answer is no rate', (tester) async {
      expect(rates.invertRate(), isNull);
    });
  });

  group('which source wins', () {
    testWidgets('the same currency is 1 and nothing is asked', (tester) async {
      final r = rates.resolveRate(sameCurrency: true, liveAllowed: true);

      expect(r.rate, 1.0);
      expect(r.source, 'identity');
    });

    testWidgets('history beats live, and live beats the cache',
        (tester) async {
      final r = rates.resolveRate(
        sameCurrency: false,
        historical: 4.0,
        liveAllowed: true,
        live: 5.0,
        cached: 9.0,
      );

      expect(r.source, 'historical');
      expect(r.rate, 0.25);
    });

    testWidgets('live is skipped entirely when the date is not recent',
        (tester) async {
      final r = rates.resolveRate(
        sameCurrency: false,
        liveAllowed: false,
        live: 5.0,
        cached: 9.0,
      );

      expect(r.source, 'cache',
          reason: 'the live source only has today, so an old date skips it');
      expect(r.rate, 9.0);
    });

    testWidgets('the cache is used as it stands, not inverted', (tester) async {
      final r = rates.resolveRate(
          sameCurrency: false, liveAllowed: false, cached: 0.25);

      expect(r.rate, 0.25, reason: 'it is already in the app convention');
    });

    testWidgets('nothing anywhere is nothing, not a zero', (tester) async {
      final r = rates.resolveRate(sameCurrency: false, liveAllowed: true);

      expect(r.rate, isNull);
      expect(r.source, 'none');
    });

    testWidgets('a corrupt cache is refused rather than used', (tester) async {
      for (final bad in [0.0, -1.0, double.nan, double.infinity]) {
        expect(
            rates.resolveRate(
                sameCurrency: false, liveAllowed: false, cached: bad).rate,
            isNull,
            reason: '$bad is not a rate');
      }
    });
  });

  group('whether the live source is worth asking', () {
    testWidgets('today is recent', (tester) async {
      expect(
          rates.rateDateIsRecent(
              date: '2026-8-15', today: '2026-8-15', nowMinutes: 600),
          isTrue);
    });

    testWidgets('a month ago is not', (tester) async {
      expect(
          rates.rateDateIsRecent(
              date: '2026-7-15', today: '2026-8-15', nowMinutes: 600),
          isFalse);
    });

    testWidgets('the window is 48 hours from now, and it slides',
        (tester) async {
      // Not "today or yesterday", whatever the shipping app's comment says.
      // Read at 14:00, the day before yesterday is 62 hours back and out.
      expect(
          rates.rateDateIsRecent(
              date: '2026-8-13', today: '2026-8-15', nowMinutes: 840),
          isFalse);
      // ...while two days ahead is 46 hours away and in.
      expect(
          rates.rateDateIsRecent(
              date: '2026-8-17', today: '2026-8-15', nowMinutes: 840),
          isTrue);
    });
  });

  group('the record sheet', () {
    testWidgets('a base-currency entry asks the network nothing',
        (tester) async {
      final fake = FakeRates();
      await tester.pumpWidget(
          MaterialApp(home: sheet.RecordSheet(fetchRate: fake.call)));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('key-9')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(store.entryCount(), 1);
      expect(fake.calls, 0, reason: 'there is no rate between a thing and itself');
    });

    testWidgets('a foreign entry asks, and saves what came back',
        (tester) async {
      currency.setRate(code: 'USD', rate: 7.0);
      final fake = FakeRates(
        answer: rates.resolveRate(
            sameCurrency: false, historical: 0.14, liveAllowed: false),
      );
      await tester.pumpWidget(
          MaterialApp(home: sheet.RecordSheet(fetchRate: fake.call)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('key-9')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('cur-USD')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(fake.calls, 1);
      expect(fake.askedFor, 'USD');
      expect(store.entryCount(), 1);
    });

    testWidgets('a fetched rate is not called stale', (tester) async {
      currency.setRate(code: 'USD', rate: 7.0);
      final fake = FakeRates(
        answer: rates.resolveRate(
            sameCurrency: false, historical: 0.14, liveAllowed: false),
      );
      await tester.pumpWidget(
          MaterialApp(home: sheet.RecordSheet(fetchRate: fake.call)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('key-9')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('cur-USD')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(find.textContaining('缓存汇率'), findsNothing,
          reason: 'a rate for the entry own day is exactly right');
    });

    testWidgets('a network that says nothing still saves, and says so',
        (tester) async {
      currency.setRate(code: 'USD', rate: 7.0);
      // No signal, a captive portal, an API that is down — the ordinary case,
      // and the one the whole `staleRate` notice exists for.
      final fake = FakeRates(
        answer: rates.resolveRate(
            sameCurrency: false, liveAllowed: false, cached: 7.0),
      );
      await tester.pumpWidget(
          MaterialApp(home: sheet.RecordSheet(fetchRate: fake.call)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('key-9')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('cur-USD')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(store.entryCount(), 1, reason: 'the row is not lost to a bad network');
      expect(find.textContaining('缓存汇率'), findsOneWidget);
    });

    testWidgets('the day asked for is the entry own day, not today',
        (tester) async {
      // The reason to fetch at all: an expense entered a week late converted
      // at today rate is quietly the wrong number.
      currency.setRate(code: 'USD', rate: 7.0);
      final fake = FakeRates();
      await tester.pumpWidget(
          MaterialApp(home: sheet.RecordSheet(fetchRate: fake.call)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('key-9')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('cur-USD')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(fake.askedDay, today(),
          reason: 'a new entry is dated now, so today is the right ask');
    });
  });
}
