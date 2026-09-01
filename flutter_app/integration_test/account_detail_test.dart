// One account's history, on a device.
//
// The rules are `core::acct` and have 5,400 parity cases behind them. What is
// checked here is that the screen asks the right question and draws the answer
// — in particular that a transfer's two sides show DIFFERENT numbers, which is
// the thing a screen computing its own delta would get wrong.

import 'package:flutter/material.dart';
import 'package:flutter_app/account_detail_screen.dart';
import 'package:flutter_app/accounts_screen.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const t0 = 1787000000000;

void add(String id, double amt,
    {String io = 'exp', String? acct, int? ts, String note = ''}) {
  store.addEntry(
    entry: store.NewEntry(
      io: io,
      cat: 'food',
      amt: amt,
      ts: ts ?? t0,
      acct: acct,
      note: note.isEmpty ? null : note,
    ),
    id: id,
    now: ts ?? t0,
  );
}

void transfer(String id, double amt,
    {required String from, required String to, double? fee, double? discount}) {
  store.addTransfer(
    transfer: store.NewTransfer(
      from: from,
      to: to,
      amt: amt,
      fee: fee,
      discount: discount,
      ts: t0,
    ),
    id: id,
    now: t0,
  );
}

Future<void> show(WidgetTester tester, String id, {bool zh = true}) async {
  await tester.pumpWidget(
      MaterialApp(home: AccountDetailScreen(id: id, zh: zh)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, Key k) =>
    tester.widget<Text>(find.byKey(k)).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() {
    store.reset();
    accounts.addAccount(
        id: 'wallet', name: '钱包', balance: 0, kind: 'cash');
    accounts.addAccount(id: 'bank', name: '银行', balance: 0, kind: 'cash');
  });

  group('the list', () {
    testWidgets('shows this account and not another', (tester) async {
      add('mine', 12.5, acct: 'wallet');
      add('theirs', 30, acct: 'bank');
      await show(tester, 'wallet');

      expect(find.byKey(const Key('acct-row-mine')), findsOneWidget);
      expect(find.byKey(const Key('acct-row-theirs')), findsNothing);
    });

    testWidgets('an expense leaves and income arrives', (tester) async {
      add('out', 12, acct: 'wallet');
      add('in', 30, io: 'inc', acct: 'wallet');
      await show(tester, 'wallet');

      expect(textOf(tester, const Key('acct-row-out-delta')), contains('-12'));
      expect(
          textOf(tester, const Key('acct-row-in-delta')), isNot(contains('-')));
    });

    testWidgets('an account with nothing says so', (tester) async {
      await show(tester, 'wallet');
      expect(find.byKey(const Key('acct-detail-empty')), findsOneWidget);
    });

    testWidgets('a deleted entry is not a row', (tester) async {
      add('gone', 12, acct: 'wallet');
      store.removeEntry(id: 'gone', now: t0 + 1);
      await show(tester, 'wallet');

      expect(find.byKey(const Key('acct-row-gone')), findsNothing);
    });

    testWidgets('newest first', (tester) async {
      add('old', 1, acct: 'wallet', ts: t0);
      add('new', 1, acct: 'wallet', ts: t0 + 90000000);
      await show(tester, 'wallet');

      final newY = tester.getTopLeft(find.byKey(const Key('acct-row-new'))).dy;
      final oldY = tester.getTopLeft(find.byKey(const Key('acct-row-old'))).dy;
      expect(newY, lessThan(oldY));
    });
  });

  group('a transfer', () {
    testWidgets('appears on both accounts', (tester) async {
      transfer('x', 100, from: 'wallet', to: 'bank');

      await show(tester, 'wallet');
      expect(find.byKey(const Key('acct-row-x')), findsOneWidget);

      await show(tester, 'bank');
      expect(find.byKey(const Key('acct-row-x')), findsOneWidget);
    });

    testWidgets('with a different number on each side', (tester) async {
      // The whole reason the delta comes from Rust rather than from the entry.
      // The sender pays the fee, the recipient takes the discount, so these are
      // not negatives of each other — a screen deriving one from the other
      // would be right only for transfers that have neither.
      transfer('x', 100, from: 'wallet', to: 'bank', fee: 2, discount: 3);

      await show(tester, 'wallet');
      final out = textOf(tester, const Key('acct-row-x-delta'));

      await show(tester, 'bank');
      final inn = textOf(tester, const Key('acct-row-x-delta'));

      expect(out, contains('102'), reason: 'the sender pays the fee');
      expect(inn, contains('103'), reason: 'the recipient takes the discount');
    });
  });

  group('the balance card', () {
    testWidgets('shows the account balance', (tester) async {
      add('a', 12.5, acct: 'wallet');
      await show(tester, 'wallet');
      expect(find.byKey(const Key('acct-detail-balance')), findsOneWidget);
    });

    testWidgets('a credit card in the red is owed, not negative',
        (tester) async {
      accounts.addAccount(
          id: 'card', name: '信用卡', balance: 0, kind: 'credit');
      add('spend', 1200, acct: 'card');
      await show(tester, 'card');

      expect(find.text('欠款'), findsOneWidget);
      expect(textOf(tester, const Key('acct-detail-balance-value')),
          isNot(contains('-')),
          reason: 'owing 1,200 is not a balance of minus 1,200');
    });

    testWidgets('a cash account is a balance', (tester) async {
      add('a', 12.5, io: 'inc', acct: 'wallet');
      await show(tester, 'wallet');
      expect(find.text('余额'), findsOneWidget);
    });
  });

  group('an account that is not there', () {
    testWidgets('draws a screen rather than throwing', (tester) async {
      await show(tester, 'nope');
      expect(find.byKey(const Key('acct-detail-title')), findsOneWidget);
      expect(find.byKey(const Key('acct-detail-empty')), findsOneWidget);
    });
  });

  group('getting to it', () {
    testWidgets('tapping an account on the accounts screen opens it',
        (tester) async {
      add('a', 12.5, acct: 'wallet');
      await tester.pumpWidget(const MaterialApp(home: AccountsScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('acct-wallet-open')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('acct-detail-balance')), findsOneWidget,
          reason: 'the screen existed and nothing reached it before this');
      expect(find.byKey(const Key('acct-row-a')), findsOneWidget);
    });
  });

  group('English', () {
    testWidgets('throughout when the app is in English', (tester) async {
      add('a', 12.5, acct: 'wallet');
      await show(tester, 'wallet', zh: false);
      expect(find.text('Balance'), findsOneWidget);
      expect(find.text('What moved through it'), findsOneWidget);
    });
  });
}
