// 币种 on a device, over the real Rust conversion.
//
// The base switch is the most dangerous operation in the app and these tests
// are mostly about it. The danger is in the data model: entry amounts, account
// balances, asset values, loan amounts, subscription charges, template amounts
// and budgets are all defined as "in the base currency", so the base is the
// unit those numbers are in and not a label on them.
//
// An earlier version of the shipping TypeScript only reassigned the label — a
// ￥10,000 balance became $10,000 on a CNY→USD switch. So the two things worth
// pinning hardest are that a switch moves EVERYTHING, and that a switch it
// cannot do moves NOTHING.

import 'package:flutter/material.dart';
import 'package:flutter_app/currency_screen.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/currency.dart' as cur;
import 'package:flutter_app/src/rust/api/networth.dart' as nw;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'dart:typed_data';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void spend(String id, double amt) {
  final t = now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: 'food', amt: amt, ts: t),
    id: id,
    now: t,
  );
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: CurrencyScreen(zh: zh)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the table', () {
    testWidgets('starts with CNY as the base and nothing else tracked',
        (tester) async {
      await show(tester);
      expect(cur.baseCurrency(), 'CNY');
      expect(find.byKey(const Key('no-rates')), findsOneWidget);
      expect(textOf(tester, 'base-currency'), contains('人民币'));
    });

    testWidgets('a code is added at parity', (tester) async {
      // parity is a placeholder rather than a claim — the rate is the next
      // thing the user edits
      cur.addRate(code: 'USD');
      expect(cur.rates().single.code, 'USD');
      expect(cur.rates().single.rate, 1);
    });

    testWidgets('a code sitting at zero counts as missing, not as tracked',
        (tester) async {
      // `if (!rates[code])` is a truthiness test, and a rate of zero is not a
      // rate
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 0);
      cur.addRate(code: 'USD');
      expect(cur.rates().single.rate, 1);
    });

    testWidgets('rates are sorted, so the list does not reshuffle itself',
        (tester) async {
      for (final c in ['USD', 'AUD', 'JPY']) {
        cur.addRate(code: c);
      }
      expect(cur.rates().map((r) => r.code).toList(), ['AUD', 'JPY', 'USD']);
    });

    testWidgets('a rate is edited and removed from the screen', (tester) async {
      cur.addRate(code: 'USD');
      await show(tester);

      await tester.enterText(find.byType(TextField), '7.2');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(cur.rates().single.rate, 7.2);

      await tester.tap(find.byKey(const Key('rate-USD-delete')));
      await tester.pumpAndSettle();
      expect(cur.rates(), isEmpty);
    });

    testWidgets('a base that turns up in its own table is drawn as a fixed 1',
        (tester) async {
      // Not a state the app produces — the core drops the base from the table
      // on every switch and the picker will not offer it — but a restored
      // config can say anything, and a row that silently vanished would read
      // as data loss. An editable field there would invite a number that means
      // nothing.
      cur.addRate(code: 'CNY');
      await show(tester);
      expect(textOf(tester, 'rate-CNY-fixed'), '1');
      expect(find.byKey(const Key('rate-CNY-base')), findsNothing);
      expect(find.byKey(const Key('rate-CNY-delete')), findsNothing);
    });
  });

  group('switching the base', () {
    testWidgets('re-expresses the ledger, not just the label', (tester) async {
      spend('e1', 720);
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 7.2);

      expect(cur.setBaseCurrency(code: 'USD', now: now), 'ok');

      expect(cur.baseCurrency(), 'USD');
      // 720 CNY at 1 USD = 7.2 CNY is 100 USD
      expect(store.getEntry(id: 'e1')!.amt, 100);
    });

    testWidgets('moves account balances too', (tester) async {
      accounts.addAccount(
        id: 'a1',
        name: '招行',
        balance: 7200,
        kind: 'cash',
        statementDay: null,
        dueDay: null,
        fxCode: null,
      );
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 7.2);

      cur.setBaseCurrency(code: 'USD', now: now);
      expect(accounts.balances().firstWhere((a) => a.id == 'a1').opening, 1000);
    });

    testWidgets('moves assets, loans, templates and budgets', (tester) async {
      nw.addAsset(id: 'as1', name: '房子', kind: 'asset', val: 720000);
      nw.addLoan(id: 'ln1', who: '小王', kind: 'lend', amt: 7200, ts: now);
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 72, note: null, name: 'X');
      budget.setSettings(
        view: budget.SettingsView(
          budget: 36000,
          dailyBudget: 720,
          cycleStart: 1,
          capCats: ['food'],
          capAmounts: Float64List.fromList([7200]),
        ),
      );
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 7.2);

      cur.setBaseCurrency(code: 'USD', now: now);

      expect(nw.assets().single.val, 100000);
      expect(nw.loans().single.amt, 1000);
      expect(catalog.templates().single.amt, 10);
      final s = budget.settings();
      expect(s.budget, 5000);
      expect(s.dailyBudget, 100);
      expect(s.capAmounts, [1000]);
    });

    testWidgets('switching to the base it already is does nothing',
        (tester) async {
      spend('e1', 720);
      expect(cur.setBaseCurrency(code: 'CNY', now: now), 'same');
      expect(store.getEntry(id: 'e1')!.amt, 720);
    });

    testWidgets('a code with no rate is REFUSED, and nothing moves',
        (tester) async {
      // refusing beats corrupting, and the test is that the refusal leaves
      // every one of these exactly as it was
      spend('e1', 720);
      accounts.addAccount(
        id: 'a1',
        name: '招行',
        balance: 7200,
        kind: 'cash',
        statementDay: null,
        dueDay: null,
        fxCode: null,
      );
      nw.addAsset(id: 'as1', name: '房子', kind: 'asset', val: 720000);

      expect(cur.setBaseCurrency(code: 'USD', now: now), 'noRate');

      expect(cur.baseCurrency(), 'CNY');
      expect(store.getEntry(id: 'e1')!.amt, 720);
      expect(accounts.balances().firstWhere((a) => a.id == 'a1').opening, 7200);
      expect(nw.assets().single.val, 720000);
    });

    testWidgets('a rate of zero is no rate at all', (tester) async {
      spend('e1', 720);
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 0);

      expect(cur.setBaseCurrency(code: 'USD', now: now), 'noRate');
      expect(store.getEntry(id: 'e1')!.amt, 720);
    });
  });

  group('the screen', () {
    testWidgets('asks before switching, and cancelling changes nothing',
        (tester) async {
      spend('e1', 720);
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 7.2);
      await show(tester);

      await tester.tap(find.byKey(const Key('rate-USD-base')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('base-dialog')), findsOneWidget);
      // the dialog says what it would do, in the unit it would do it in
      expect(find.textContaining('1 USD = 7.2 CNY'), findsOneWidget);

      await tester.tap(find.byKey(const Key('base-cancel')));
      await tester.pumpAndSettle();
      expect(cur.baseCurrency(), 'CNY');
      expect(store.getEntry(id: 'e1')!.amt, 720);
    });

    testWidgets('confirming switches, and the screen follows', (tester) async {
      spend('e1', 720);
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 7.2);
      await show(tester);

      await tester.tap(find.byKey(const Key('rate-USD-base')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('base-ok')));
      await tester.pumpAndSettle();

      expect(cur.baseCurrency(), 'USD');
      expect(textOf(tester, 'base-currency'), contains('USD'));
      // The table re-anchors: USD leaves it, because a base has no rate
      // against itself, and the OLD base joins it at the inverse.
      expect(find.byKey(const Key('rate-USD')), findsNothing);
      expect(cur.rates().single.code, 'CNY');
      expect(cur.rates().single.rate, closeTo(1 / 7.2, 0.000001));
    });

    testWidgets('a rateless code says so instead of opening the dialog',
        (tester) async {
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 0);
      await show(tester);

      await tester.tap(find.byKey(const Key('rate-USD-base')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('base-dialog')), findsNothing);
      expect(textOf(tester, 'cur-flash'), contains('还没有汇率'));
    });

    testWidgets('the picker offers only untracked codes', (tester) async {
      cur.addRate(code: 'USD');
      await show(tester);

      await tester.tap(find.byKey(const Key('add-currency')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pick-USD')), findsNothing);
      // nor the base, which has no rate against itself
      expect(find.byKey(const Key('pick-CNY')), findsNothing);
      expect(find.byKey(const Key('pick-AUD')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pick-AUD')));
      await tester.pumpAndSettle();
      expect(cur.rates().map((r) => r.code), containsAll(['AUD', 'USD']));
    });
  });

  group('the table survives', () {
    testWidgets('a snapshot and a reload', (tester) async {
      cur.addRate(code: 'USD');
      cur.setRate(code: 'USD', rate: 7.2);
      cur.setBaseCurrency(code: 'USD', now: now);
      final json = store.snapshotConfig();

      store.reset();
      expect(cur.baseCurrency(), 'CNY');

      expect(store.loadConfig(json: json), isTrue);
      expect(cur.baseCurrency(), 'USD');
      expect(cur.rates().firstWhere((r) => r.code == 'CNY').rate, isNot(0));
    });
  });
}
