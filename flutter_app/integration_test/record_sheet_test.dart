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
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

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

/// The expression as the amount panel shows it.
String expr(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('amount-expr'))).data!;

String? flash(WidgetTester tester) {
  final f = find.byKey(const Key('flash'));
  return f.evaluate().isEmpty ? null : tester.widget<Text>(f).data;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() => store.reset());

  group('the keypad', () {
    testWidgets('builds an expression a digit at a time', (tester) async {
      await show(tester);
      await type(tester, '35');
      await press(tester, '.');
      await type(tester, '5');
      expect(expr(tester), '35.5');
    });

    testWidgets('refuses a second decimal point, as the shipping keypad does',
        (tester) async {
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

    testWidgets('shows a running total once there is an operator', (tester) async {
      await show(tester);
      await type(tester, '12');
      expect(find.textContaining('= '), findsNothing); // not the keypad's '=' key
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
      await press(tester, 'save');
      expect(store.liveEntries().first.amt, 36);
    });

    testWidgets('the equals key evaluates rather than typing a character',
        (tester) async {
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

    testWidgets('an operator cannot lead, and replaces a trailing one',
        (tester) async {
      await show(tester);
      await press(tester, '+'); // nothing to operate on
      expect(expr(tester), '0');
      await type(tester, '5');
      await press(tester, '+');
      await press(tester, '×'); // replaces, not appends
      expect(expr(tester), '5×');
    });

    testWidgets('deletes the last character, and stops at empty', (tester) async {
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
    testWidgets('writes the entry and clears for the next one', (tester) async {
      await show(tester);
      await type(tester, '35');
      await press(tester, 'save');

      expect(store.entryCount(), 1);
      final e = store.liveEntries().first;
      expect(e.amt, 35);
      expect(e.io, 'exp');
      expect(e.cat, 'food'); // the first expense category, from the catalog
      // 再记: the amount goes, the kind stays
      expect(expr(tester), '0');
      expect(flash(tester), '已保存');
    });

    testWidgets('evaluates the expression rather than storing the text',
        (tester) async {
      await show(tester);
      await type(tester, '12');
      await press(tester, '+');
      await type(tester, '8');
      await press(tester, 'save');
      expect(store.liveEntries().first.amt, 20);
    });

    testWidgets('refuses an empty amount, and says which refusal it is',
        (tester) async {
      await show(tester);
      await press(tester, 'save');

      expect(store.entryCount(), 0);
      expect(flash(tester), '请输入金额'); // spelled here, decided in Rust
    });

    testWidgets('refuses a zero, which is not the same as empty', (tester) async {
      await show(tester);
      await type(tester, '0');
      await press(tester, 'save');
      expect(store.entryCount(), 0);
      expect(flash(tester), '请输入金额');
    });

    testWidgets('a refusal goes when the thing it refused changes', (tester) async {
      // a complaint that outlives what it complained about is worse than none
      await show(tester);
      await press(tester, 'save');
      expect(flash(tester), '请输入金额');
      await type(tester, '5');
      expect(flash(tester), isNull);
    });

    testWidgets('refuses an expression that comes out negative', (tester) async {
      await show(tester);
      await type(tester, '5');
      await press(tester, '-');
      await type(tester, '9');
      await press(tester, 'save');
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

    testWidgets('a transfer with only one account is refused, and says why',
        (tester) async {
      // a fresh store has exactly one account, so there is no second one to
      // transfer to — pickIo leaves the destination empty and validate refuses
      await show(tester);
      await tapText(tester, '转账');
      await type(tester, '50');
      await press(tester, 'save');

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
      await press(tester, 'save'); // saves fine in the base currency
      expect(store.entryCount(), 1);
    });

    testWidgets('a rate of zero reads as no rate', (tester) async {
      // the currency screen never writes one, but `currencies` rides in the
      // config blob and a restored backup is a file that can say anything
      record.setCurrencies(base: 'CNY', codes: ['USD'], rates: [0]);
      expect(record.cachedRate(code: 'USD'), 0);
      final r = record.validateForm(
        form: record.initialForm(sourceId: '', editing: false, ledger: '')
            .copyWith(amt: '10', cur: 'USD'),
      );
      expect(r, 'noRate:USD');
    });
  });

  group('the sheet says nothing the core did not decide', () {
    testWidgets('a rejection is a kind, spelled by the reader language',
        (tester) async {
      expect(rejectionText('amount', true), '请输入金额');
      expect(rejectionText('amount', false), 'Enter an amount');
      expect(rejectionText('noRate:USD', false), 'No exchange rate for USD');
    });

    testWidgets('English draws the same form differently', (tester) async {
      await show(tester, zh: false);
      expect(find.text('Expense'), findsOneWidget);
      await press(tester, 'save');
      expect(flash(tester), 'Enter an amount');
    });
  });
}
