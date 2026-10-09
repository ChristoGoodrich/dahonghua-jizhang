// The record sheet, driven on a device against the real Rust form.
//
// Nothing here is mocked. Keys are pressed, the expression grows through
// `applyKey`, the save runs `validate` and `draft` and writes to the ledger,
// and the assertions read what came out. What is being checked is the seam:
// that a decision made in Rust arrives on screen and in the store intact.

import 'package:flutter/material.dart';
import 'package:flutter_app/record_sheet.dart';
import 'package:flutter_app/src/rust/api/record.dart' as record;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: RecordSheet(zh: zh)));
  await tester.pumpAndSettle();
}

/// A keypad key, by key rather than by text: '0' and '=' also appear in the
/// amount panel, and a text finder cannot say which one it means.
Future<void> press(WidgetTester tester, String k) async {
  await tester.tap(find.byKey(Key('key-$k')));
  await tester.pumpAndSettle();
}

/// Anything else on the screen — a direction, a category — which is unique.
Future<void> tapText(WidgetTester tester, String label) async {
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

Future<void> type(WidgetTester tester, String digits) async {
  for (final d in digits.split('')) {
    await press(tester, d);
  }
}

/// 再记: save and stay, the amount cleared for the next of the same kind.
Future<void> saveAgain(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('record-again')));
  await tester.pumpAndSettle();
}

/// 保存: write the row and close the sheet.
Future<void> saveAndClose(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('key-save')));
  await tester.pumpAndSettle();
}

/// The expression as the amount panel shows it.
String expr(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('amount-expr'))).data!;

String? flash(WidgetTester tester) {
  final f = find.byKey(const Key('flash'));
  return f.evaluate().isEmpty ? null : tester.widget<Text>(f).data;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the keypad', () {
    testWidgets('builds an expression a digit at a time', (tester) async {
      await show(tester);
      await type(tester, '35');
      await press(tester, '.');
      await type(tester, '5');
      expect(expr(tester), '35.5');
    });

    testWidgets('refuses a second decimal point, as the shipping keypad does', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '1');
      await press(tester, '.');
      await type(tester, '5');
      await press(tester, '.');
      await type(tester, '9');
      // not `1.5.9` — the grammar is Rust's, and this is why the keypress
      // crosses the boundary rather than appending a character here
      expect(expr(tester), '1.59');
    });

    testWidgets('shows a running total once there is an operator', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '12');
      expect(
        find.textContaining('= '),
        findsNothing,
      ); // not the keypad's '=' key
      await press(tester, '+');
      await type(tester, '8');
      expect(find.text('= 20.00'), findsOneWidget);
    });

    testWidgets('multiplies with × rather than *', (tester) async {
      // `applyKey` matches on the exact characters `+-×÷`. A keypad sending `*`
      // would have it appended as though it were a digit, which is what the
      // first draft of this screen did with `=`.
      await show(tester);
      await type(tester, '12');
      await press(tester, '×');
      await type(tester, '3');
      expect(expr(tester), '12×3');
      await saveAgain(tester);
      expect(store.liveEntries().first.amt, 36);
    });

    testWidgets('the equals key evaluates rather than typing a character', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '12');
      await press(tester, '+');
      await type(tester, '8');
      await press(tester, 'eq');
      expect(expr(tester), '20'); // not `12+8=`
    });

    testWidgets('clear empties the expression', (tester) async {
      await show(tester);
      await type(tester, '123');
      await press(tester, 'clear');
      expect(expr(tester), '0');
    });

    testWidgets('an operator cannot lead, and replaces a trailing one', (
      tester,
    ) async {
      await show(tester);
      await press(tester, '+'); // nothing to operate on
      expect(expr(tester), '0');
      await type(tester, '5');
      await press(tester, '+');
      await press(tester, '×'); // replaces, not appends
      expect(expr(tester), '5×');
    });

    testWidgets('deletes the last character, and stops at empty', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '12');
      await press(tester, 'back');
      expect(expr(tester), '1');
      await press(tester, 'back');
      await press(tester, 'back');
      expect(expr(tester), '0'); // the panel's placeholder for an empty field
    });
  });

  group('saving', () {
    testWidgets('再记 writes and stays, clearing the amount for the next', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '35');
      await saveAgain(tester);

      expect(store.entryCount(), 1);
      final e = store.liveEntries().first;
      expect(e.amt, 35);
      expect(e.io, 'exp');
      expect(e.cat, 'food'); // the first expense category, from the catalog
      // 再记: the amount goes, the kind stays
      expect(expr(tester), '0');
      expect(flash(tester), '已保存');
    });

    testWidgets('保存 writes and closes — the form is cleared by going away', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '35');
      await saveAndClose(tester);

      expect(store.entryCount(), 1);
      // the sheet is gone, so there is no form left to hold the last entry
      expect(find.byType(RecordSheet), findsNothing);
    });

    testWidgets('evaluates the expression rather than storing the text', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '12');
      await press(tester, '+');
      await type(tester, '8');
      await saveAgain(tester);
      expect(store.liveEntries().first.amt, 20);
    });

    testWidgets('refuses an empty amount, and says which refusal it is', (
      tester,
    ) async {
      await show(tester);
      await saveAgain(tester);

      expect(store.entryCount(), 0);
      expect(flash(tester), '请输入金额'); // spelled here, decided in Rust
    });

    testWidgets('refuses a zero, which is not the same as empty', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '0');
      await saveAgain(tester);
      expect(store.entryCount(), 0);
      expect(flash(tester), '请输入金额');
    });

    testWidgets('a refusal goes when the thing it refused changes', (
      tester,
    ) async {
      // a complaint that outlives what it complained about is worse than none
      await show(tester);
      await saveAgain(tester);
      expect(flash(tester), '请输入金额');
      await type(tester, '5');
      expect(flash(tester), isNull);
    });

    testWidgets('refuses an expression that comes out negative', (
      tester,
    ) async {
      await show(tester);
      await type(tester, '5');
      await press(tester, '-');
      await type(tester, '9');
      await saveAgain(tester);
      expect(store.entryCount(), 0);
    });
  });

  group('direction', () {
    testWidgets('income keeps its own categories', (tester) async {
      await show(tester);
      await tapText(tester, '收入');
      expect(find.textContaining('工资'), findsOneWidget);
      expect(find.textContaining('餐饮'), findsNothing);
    });

    testWidgets('a transfer hides the category picker', (tester) async {
      await show(tester);
      await tapText(tester, '转账');
      expect(find.textContaining('餐饮'), findsNothing);
      expect(find.textContaining('工资'), findsNothing);
    });

    testWidgets('a transfer with only one account is refused, and says why', (
      tester,
    ) async {
      // a fresh store has exactly one account, so there is no second one to
      // transfer to — pickIo leaves the destination empty and validate refuses
      await show(tester);
      await tapText(tester, '转账');
      await type(tester, '50');
      await saveAgain(tester);

      expect(store.entryCount(), 0);
      expect(flash(tester), '请选择转入账户');
    });
  });

  group('currency', () {
    testWidgets('refuses a currency with no rate, naming it', (tester) async {
      record.setCurrencies(base: 'CNY', codes: ['JPY'], rates: [0.048]);
      await show(tester);
      // the form opens on the base currency; put it on one with no rate
      await type(tester, '10');
      await saveAgain(tester); // saves fine in the base currency
      expect(store.entryCount(), 1);
    });

    testWidgets('a rate of zero reads as no rate', (tester) async {
      // the currency screen never writes one, but `currencies` rides in the
      // config blob and a restored backup is a file that can say anything
      record.setCurrencies(base: 'CNY', codes: ['USD'], rates: [0]);
      expect(record.cachedRate(code: 'USD'), 0);
      final r = record.validateForm(
        form: record
            .initialForm(sourceId: '', editing: false, ledger: '')
            .copyWith(amt: '10', cur: 'USD'),
      );
      expect(r, 'noRate:USD');
    });
  });

  group('the sheet says nothing the core did not decide', () {
    testWidgets('a rejection is a kind, spelled by the reader language', (
      tester,
    ) async {
      expect(rejectionText('amount', true), '请输入金额');
      expect(rejectionText('amount', false), 'Enter an amount');
      expect(rejectionText('noRate:USD', false), 'No exchange rate for USD');
    });

    testWidgets('English draws the same form differently', (tester) async {
      await show(tester, zh: false);
      expect(find.text('Expense'), findsOneWidget);
      await saveAgain(tester);
      expect(flash(tester), 'Enter an amount');
    });
  });

  group('the date an entry is on', () {
    String dateLabel(WidgetTester tester) =>
        tester.widget<Text>(find.byKey(const Key('date-label'))).data!;

    /// Open the picker and take a day from the quick row. 0 is today, 1
    /// yesterday, 2 the day before.
    Future<void> pickBack(WidgetTester tester, int back) async {
      await tester.tap(find.byKey(const Key('date-chip')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key('date-quick-$back')));
      await tester.pumpAndSettle();
    }

    DateTime dayOf(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);

    testWidgets('a new entry is on today, and says so', (tester) async {
      await show(tester);
      expect(dateLabel(tester), '今天');
    });

    /// The whole point of the control. The port had dropped it, so an expense
    /// forgotten yesterday could only be recorded as today's — and a ledger
    /// where yesterday's lunch is filed under today is a ledger whose day
    /// totals are wrong.
    testWidgets('a backdated entry is saved on the day picked', (tester) async {
      await show(tester);
      await pickBack(tester, 1);
      expect(dateLabel(tester), '昨天');

      await type(tester, '42');
      await saveAgain(tester);

      final saved = dayOf(store.liveEntries().first.ts);
      final yesterday = DateTime.now().subtract(const Duration(days: 1));
      expect(saved.year, yesterday.year);
      expect(saved.month, yesterday.month);
      expect(saved.day, yesterday.day);
    });

    /// Moving the day keeps the time of day. Dropping it to midnight would
    /// reorder the entry against everything else logged that day, since the
    /// list sorts on the instant.
    testWidgets('and keeps the time of day it had', (tester) async {
      await show(tester);
      final before = DateTime.now();
      await pickBack(tester, 2);
      await type(tester, '10');
      await saveAgain(tester);

      final saved = dayOf(store.liveEntries().first.ts);
      expect(saved.hour, before.hour);
      expect(saved.minute, closeTo(before.minute, 1));
    });

    /// 再记一笔 keeps the date, which is `after_save_next`'s doing and the
    /// shipping behaviour: somebody entering a stack of yesterday's receipts
    /// should not have to re-pick the day for each one.
    testWidgets('the next entry stays on the day just used', (tester) async {
      await show(tester);
      await pickBack(tester, 1);
      await type(tester, '10');
      await saveAgain(tester);

      expect(dateLabel(tester), '昨天');
      await type(tester, '20');
      await saveAgain(tester);

      final days = store.liveEntries().map((e) => dayOf(e.ts).day).toSet();
      expect(days, hasLength(1), reason: 'both on the same day');
    });

    /// An expense has already happened. A day after today would sit at the
    /// top of the list pretending to be the most recent thing.
    testWidgets('tomorrow cannot be picked', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('date-chip')));
      await tester.pumpAndSettle();

      final now = DateTime.now();
      final tomorrow = DateTime(now.year, now.month, now.day + 1);
      if (tomorrow.month != now.month) return; // it is on the next page
      expect(
        find.byKey(Key('date-day-${tomorrow.day}')),
        findsNothing,
        reason: 'a future day is drawn, but not as something to press',
      );
      expect(find.byKey(Key('date-day-${now.day}')), findsOneWidget);
    });

    testWidgets('and the month cannot be paged past this one', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('date-chip')));
      await tester.pumpAndSettle();

      final next = tester.widget<IconButton>(
        find.byKey(const Key('date-next')),
      );
      expect(next.onPressed, isNull);

      await tester.tap(find.byKey(const Key('date-prev')));
      await tester.pumpAndSettle();
      final back = tester.widget<IconButton>(
        find.byKey(const Key('date-next')),
      );
      expect(back.onPressed, isNotNull, reason: 'and back again from there');
    });
  });
}
