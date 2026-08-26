// 资产 on a device, over the real Rust net-worth arithmetic.
//
// The screen adds three lists together and the interesting part is which side
// each number lands on. One rule decides it and the screen does not get to
// re-decide it: a credit account **in debt** is a liability, and every other
// account — an overpaid card included — is an asset.
//
// The other rule worth pinning is the repayment cap, which is one-sided on
// purpose. It stops an overpayment and deliberately leaves a negative amount
// alone, because that is how a mis-tap gets undone.

import 'package:flutter/material.dart';
import 'package:flutter_app/assets_screen.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/networth.dart' as nw;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

String openAccount(String name, {double balance = 0, String kind = 'cash'}) =>
    accounts.addAccount(
      id: name,
      name: name,
      balance: balance,
      kind: kind,
      statementDay: null,
      dueDay: null,
      fxCode: null,
    );

void spend(String id, double amt, {String? acct}) {
  final t = now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: 'food', amt: amt, acct: acct, ts: t),
    id: id,
    now: t,
  );
}

String asset(String name, double val, {String kind = 'asset'}) =>
    nw.addAsset(id: 'as-$name', name: name, kind: kind, val: val);

String loan(String who, double amt, {String kind = 'lend'}) =>
    nw.addLoan(id: 'ln-$who', who: who, kind: kind, amt: amt, ts: now);

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: AssetsScreen(zh: zh)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() => store.reset());

  group('the split', () {
    testWidgets('a credit account in debt is a liability, not a negative asset',
        (tester) async {
      openAccount('招行', balance: 1000);
      openAccount('信用卡', kind: 'credit');
      spend('e1', 400, acct: '信用卡');
      await show(tester);

      expect(textOf(tester, 'nw-asset'), '￥1,000.00');
      expect(textOf(tester, 'nw-liab'), '￥400.00');
      expect(textOf(tester, 'net-worth'), '￥600.00');
    });

    testWidgets('an OVERPAID credit card is an asset again', (tester) async {
      // the rule is about the sign of the balance, not the kind of account
      openAccount('信用卡', balance: 500, kind: 'credit');
      await show(tester);

      expect(textOf(tester, 'nw-asset'), '￥500.00');
      expect(textOf(tester, 'nw-liab'), '￥0.00');
    });

    testWidgets('a cash account in debt is still counted as an asset',
        (tester) async {
      // only CREDIT accounts cross over; an overdrawn cash account is a
      // negative asset, which is what makes the two totals differ from a
      // simple positive/negative split
      openAccount('现金');
      spend('e1', 300, acct: '现金');
      await show(tester);

      expect(textOf(tester, 'nw-asset'), '￥-300.00');
      expect(textOf(tester, 'nw-liab'), '￥0.00');
      expect(textOf(tester, 'net-worth'), '￥-300.00');
    });
  });

  group('other assets', () {
    testWidgets('add to the total, and a liability subtracts', (tester) async {
      asset('房子', 500000);
      asset('房贷', 300000, kind: 'liab');
      await show(tester);

      expect(textOf(tester, 'nw-asset'), '￥500,000.00');
      expect(textOf(tester, 'nw-liab'), '￥300,000.00');
      expect(textOf(tester, 'net-worth'), '￥200,000.00');
    });

    testWidgets('one marked not-counted stays on the list and out of the sum',
        (tester) async {
      asset('房子', 500000);
      await show(tester);
      expect(textOf(tester, 'net-worth'), '￥500,000.00');

      await tester.tap(find.byKey(const Key('nw-asset-as-房子-count')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('nw-asset-as-房子-val')), findsOneWidget);
      expect(textOf(tester, 'net-worth'), '￥0.00');
      expect(find.text('不计入净资产'), findsOneWidget);
    });

    testWidgets('a new one is stored as counted rather than left absent',
        (tester) async {
      // `noCount: false` is written, not omitted — a reader that treated
      // absent as false would still be wrong once it crossed the wire
      asset('车', 80000);
      expect(nw.assets().single.noCount, isFalse);
    });

    testWidgets('deleting takes it off the total', (tester) async {
      asset('车', 80000);
      await show(tester);
      await tester.tap(find.byKey(const Key('nw-asset-as-车-delete')));
      await tester.pumpAndSettle();

      expect(nw.assets(), isEmpty);
      expect(textOf(tester, 'net-worth'), '￥0.00');
      expect(find.byKey(const Key('no-assets')), findsOneWidget);
    });
  });

  group('loans', () {
    testWidgets('money lent is an asset, money borrowed is a liability',
        (tester) async {
      loan('小王', 2000);
      loan('银行', 5000, kind: 'borrow');
      await show(tester);

      expect(textOf(tester, 'nw-asset'), '￥2,000.00');
      expect(textOf(tester, 'nw-liab'), '￥5,000.00');
      expect(textOf(tester, 'net-worth'), '￥-3,000.00');
    });

    testWidgets('a new one starts at zero repaid, stored rather than absent',
        (tester) async {
      loan('小王', 2000);
      expect(nw.loans().single.repaid, 0);
      expect(nw.loans().single.remaining, 2000);
    });

    testWidgets('a repayment reduces what is outstanding', (tester) async {
      loan('小王', 2000);
      await show(tester);

      await tester.tap(find.byKey(const Key('nw-loan-ln-小王-repay')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('repay-amt')), '500');
      await tester.tap(find.byKey(const Key('repay-ok')));
      await tester.pumpAndSettle();

      expect(nw.loans().single.remaining, 1500);
      expect(textOf(tester, 'nw-loan-ln-小王-val'), '￥1,500.00');
    });

    testWidgets('an overpayment is capped at what is owed', (tester) async {
      loan('小王', 2000);
      await show(tester);

      await tester.tap(find.byKey(const Key('nw-loan-ln-小王-repay')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('repay-amt')), '9999');
      await tester.tap(find.byKey(const Key('repay-ok')));
      await tester.pumpAndSettle();

      expect(nw.loans().single.repaid, 2000);
      expect(nw.loans().single.remaining, 0);
      expect(find.text('已结清'), findsOneWidget);
    });

    testWidgets('a negative repayment walks it back, which is how a mis-tap '
        'is undone', (tester) async {
      // the cap is one-sided on purpose, and the screen does not add a second
      // one — that would be the same rule implemented twice
      loan('小王', 2000);
      nw.repayLoan(id: 'ln-小王', amount: 500);
      nw.repayLoan(id: 'ln-小王', amount: -500);
      expect(nw.loans().single.repaid, 0);
    });

    testWidgets('a settled loan offers no repay button', (tester) async {
      loan('小王', 100);
      nw.repayLoan(id: 'ln-小王', amount: 100);
      await show(tester);

      expect(find.byKey(const Key('nw-loan-ln-小王-repay')), findsNothing);
      expect(find.byKey(const Key('nw-loan-ln-小王-delete')), findsOneWidget);
    });

    testWidgets('deleting removes it from the total', (tester) async {
      loan('小王', 2000);
      await show(tester);
      await tester.tap(find.byKey(const Key('nw-loan-ln-小王-delete')));
      await tester.pumpAndSettle();

      expect(nw.loans(), isEmpty);
      expect(textOf(tester, 'net-worth'), '￥0.00');
    });
  });

  group('the forms', () {
    testWidgets('creating an asset takes a name, a value and a kind',
        (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-asset')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('asset-name')), '房贷');
      await tester.enterText(find.byKey(const Key('asset-val')), '300000');
      await tester.tap(find.byKey(const Key('asset-kind-liab')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('asset-ok')));
      await tester.pumpAndSettle();

      final made = nw.assets().single;
      expect(made.name, '房贷');
      expect(made.kind, 'liab');
      expect(made.val, 300000);
    });

    testWidgets('an asset with no value creates nothing', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-asset')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('asset-name')), '空');
      await tester.tap(find.byKey(const Key('asset-ok')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('new-asset-dialog')), findsOneWidget);
      expect(nw.assets(), isEmpty);
      await tester.tap(find.byKey(const Key('asset-cancel')));
      await tester.pumpAndSettle();
    });

    testWidgets('creating a loan takes a name, an amount and a direction',
        (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-loan')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('loan-who')), '银行');
      await tester.enterText(find.byKey(const Key('loan-amt')), '5000');
      await tester.tap(find.byKey(const Key('loan-kind-borrow')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('loan-ok')));
      await tester.pumpAndSettle();

      final made = nw.loans().single;
      expect(made.who, '银行');
      expect(made.kind, 'borrow');
      expect(made.amt, 5000);
    });

    testWidgets('the repay dialog opens on what is still owed', (tester) async {
      loan('小王', 2000);
      nw.repayLoan(id: 'ln-小王', amount: 500);
      await show(tester);

      await tester.tap(find.byKey(const Key('nw-loan-ln-小王-repay')));
      await tester.pumpAndSettle();
      expect(find.text('1500.00'), findsOneWidget);
      await tester.tap(find.byKey(const Key('repay-cancel')));
      await tester.pumpAndSettle();
      expect(nw.loans().single.repaid, 500);
    });
  });

  group('accounts on the screen', () {
    testWidgets('are listed with their balances, archived ones excluded',
        (tester) async {
      openAccount('招行', balance: 1000);
      openAccount('旧卡', balance: 50);
      accounts.archiveAccount(id: '旧卡', archived: true);
      await show(tester);

      expect(find.byKey(const Key('nw-acct-招行-val')), findsOneWidget);
      expect(find.byKey(const Key('nw-acct-旧卡-val')), findsNothing);
      // still counted, though — archiving hides, it does not exclude
      expect(textOf(tester, 'nw-asset'), '￥1,050.00');
    });

    testWidgets('managing them is one level down and comes back',
        (tester) async {
      openAccount('招行', balance: 1000);
      await show(tester);

      await tester.tap(find.byKey(const Key('manage-accounts')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('add-account')), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('net-worth')), findsOneWidget);
    });
  });

  group('assets and loans survive', () {
    testWidgets('a snapshot and a reload', (tester) async {
      asset('房子', 500000);
      asset('车', 80000);
      nw.setAssetNoCount(id: 'as-车', noCount: true);
      loan('小王', 2000);
      nw.repayLoan(id: 'ln-小王', amount: 500);
      final json = store.snapshotConfig();

      store.reset();
      expect(nw.assets(), isEmpty);
      expect(nw.loans(), isEmpty);

      expect(store.loadConfig(json: json), isTrue);
      expect(nw.assets().length, 2);
      expect(nw.assets().firstWhere((a) => a.id == 'as-车').noCount, isTrue);
      final back = nw.loans().single;
      expect(back.who, '小王');
      expect(back.repaid, 500);
      expect(back.remaining, 1500);
    });
  });
}
