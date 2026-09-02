// 信用卡账单周期, on a device.
//
// The arithmetic is `statement.rs`'s under a corpus. What only a device shows
// is whether a user can configure a cycle at all — before this the accounts
// screen passed `statementDay: null` unconditionally, so the whole module was
// unreachable no matter how correct it was.
//
// The one rule worth restating where the tests are: a payment made after the
// close pays the STATEMENT first, which is what a card does. A repaid bill
// stops showing 待还 and stops reminding.

import 'package:flutter/material.dart';
import 'package:flutter_app/accounts_screen.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/statement.dart' as statement;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

String day(DateTime d) => '${d.year}-${d.month}-${d.day}';

DateTime daysAgo(int n) => DateTime.now().subtract(Duration(days: n));

/// A credit card with a cycle that closed `closedAgo` days back.
String card({int closedAgo = 10, int? dueDay}) {
  final closed = daysAgo(closedAgo);
  accounts.addAccount(
    id: 'card',
    name: '信用卡',
    balance: 0,
    kind: 'credit',
    statementDay: closed.day <= 28 ? closed.day : 28,
    dueDay: dueDay,
    fxCode: null,
  );
  return 'card';
}

void spend(String id, double amt, {DateTime? at, String acct = 'card'}) {
  final t = (at ?? DateTime.now()).millisecondsSinceEpoch;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: 'food', amt: amt, acct: acct, ts: t),
    id: id,
    now: t,
  );
}

void repay(String id, double amt, {DateTime? at}) {
  final t = (at ?? DateTime.now()).millisecondsSinceEpoch;
  store.addTransfer(
    transfer: store.NewTransfer(from: 'cash', to: 'card', amt: amt, ts: t),
    id: id,
    now: t,
  );
}

statement.StatementView? summary() {
  final live = store.liveEntries();
  return statement.statementOf(
    accountId: 'card',
    ids: live.map((e) => e.id).toList(),
    daysOf: live
        .map((e) => day(DateTime.fromMillisecondsSinceEpoch(e.ts)))
        .toList(),
    today: day(DateTime.now()),
  );
}

List<statement.DueView> dueSoon({int within = 7}) {
  final live = store.liveEntries();
  return statement.dueWithin(
    ids: live.map((e) => e.id).toList(),
    daysOf: live
        .map((e) => day(DateTime.fromMillisecondsSinceEpoch(e.ts)))
        .toList(),
    today: day(DateTime.now()),
    withinDays: within,
  );
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: AccountsScreen(zh: zh)));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('when there is no cycle', () {
    testWidgets('a cash account has no statement', (tester) async {
      accounts.addAccount(
          id: 'card',
          name: '现金卡',
          balance: 0,
          kind: 'cash',
          statementDay: null,
          dueDay: null,
          fxCode: null);

      expect(summary(), isNull);
    });

    testWidgets('a credit card with no statement day has no statement',
        (tester) async {
      accounts.addAccount(
          id: 'card',
          name: '信用卡',
          balance: 0,
          kind: 'credit',
          statementDay: null,
          dueDay: null,
          fxCode: null);

      expect(summary(), isNull,
          reason: 'an unconfigured cycle has no 出账日 to report');
    });
  });

  group('the cycle', () {
    testWidgets('a charge before the close is billed', (tester) async {
      card(closedAgo: 10);
      spend('a', 100, at: daysAgo(15));

      final st = summary()!;
      expect(st.billedDue, 100);
      expect(st.unbilled, 0);
    });

    testWidgets('a charge after the close is not billed yet', (tester) async {
      card(closedAgo: 10);
      spend('a', 100, at: daysAgo(5));

      final st = summary()!;
      expect(st.billedDue, 0);
      expect(st.unbilled, 100);
    });

    testWidgets('both are owed, and add up to the debt', (tester) async {
      card(closedAgo: 10);
      spend('old', 100, at: daysAgo(15));
      spend('new', 40, at: daysAgo(5));

      final st = summary()!;
      expect(st.billedDue, 100);
      expect(st.unbilled, 40);
      expect(st.currentDebt, 140);
    });

    testWidgets('a payment pays the statement first', (tester) async {
      // What a card actually does, and the reason a repaid bill stops
      // reminding even while new charges are accruing.
      card(closedAgo: 10);
      spend('old', 100, at: daysAgo(15));
      spend('new', 40, at: daysAgo(5));
      repay('pay', 100, at: daysAgo(3));

      final st = summary()!;
      expect(st.billedDue, 0, reason: 'the bill is settled');
      expect(st.unbilled, 40, reason: 'the new charge is untouched');
    });

    testWidgets('paying more than the bill leaves the rest against the new',
        (tester) async {
      card(closedAgo: 10);
      spend('old', 100, at: daysAgo(15));
      spend('new', 40, at: daysAgo(5));
      repay('pay', 120, at: daysAgo(3));

      final st = summary()!;
      expect(st.billedDue, 0);
      expect(st.unbilled, 20);
    });

    testWidgets('debt never goes negative', (tester) async {
      card(closedAgo: 10);
      spend('old', 50, at: daysAgo(15));
      repay('pay', 500, at: daysAgo(3));

      expect(summary()!.currentDebt, 0);
    });
  });

  group('the due date', () {
    testWidgets('there is none when no due day is set', (tester) async {
      card(closedAgo: 10);
      spend('a', 100, at: daysAgo(15));

      final st = summary()!;
      expect(st.dueDate, isNull);
      expect(st.daysToDue, isNull);
    });

    testWidgets('a settled card does not remind', (tester) async {
      final due = DateTime.now().add(const Duration(days: 3));
      card(closedAgo: 10, dueDay: due.day <= 28 ? due.day : 28);
      spend('old', 100, at: daysAgo(15));
      repay('pay', 100, at: daysAgo(3));

      expect(dueSoon(), isEmpty);
    });

    testWidgets('a card with nothing on it does not remind', (tester) async {
      final due = DateTime.now().add(const Duration(days: 3));
      card(closedAgo: 10, dueDay: due.day <= 28 ? due.day : 28);

      expect(dueSoon(), isEmpty);
    });
  });

  group('the screen', () {
    testWidgets('a credit card is offered a cycle and a cash one is not',
        (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-account')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('stmt-day-15')), findsNothing,
          reason: 'cash is the default kind and has no cycle');

      await tester.tap(find.byKey(const Key('kind-credit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('stmt-day-15')), findsOneWidget);
      expect(find.byKey(const Key('due-day-5')), findsOneWidget);
    });

    testWidgets('the days chosen are the days stored', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-account')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('new-name')), '招行');
      await tester.tap(find.byKey(const Key('kind-credit')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stmt-day-10')));
      await tester.tap(find.byKey(const Key('due-day-25')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('new-ok')));
      await tester.pumpAndSettle();

      // The failure this guards is the one that made the whole module
      // unreachable: the dialog used to pass null for both, unconditionally.
      final made = accounts.balances().firstWhere((a) => a.name == '招行');
      final st = statement.statementOf(
        accountId: made.id,
        ids: const [],
        daysOf: const [],
        today: day(DateTime.now()),
      );
      expect(st, isNotNull, reason: 'a cycle was configured, so there is one');
    });

    testWidgets('tapping the chosen day again clears it', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-account')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('new-name')), '中信');
      await tester.tap(find.byKey(const Key('kind-credit')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stmt-day-10')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stmt-day-10')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('new-ok')));
      await tester.pumpAndSettle();

      final made = accounts.balances().firstWhere((a) => a.name == '中信');
      expect(
        statement.statementOf(
            accountId: made.id,
            ids: const [],
            daysOf: const [],
            today: day(DateTime.now())),
        isNull,
        reason: 'unset is a state a user has to be able to get back to',
      );
    });

    testWidgets('a configured card shows where it stands', (tester) async {
      card(closedAgo: 10);
      spend('a', 100, at: daysAgo(15));
      await show(tester);

      expect(find.byKey(const Key('acct-card-stmt')), findsOneWidget);
      expect(find.textContaining('本期待还'), findsOneWidget);
    });

    testWidgets('a card with no cycle shows nothing rather than zeroes',
        (tester) async {
      accounts.addAccount(
          id: 'card',
          name: '信用卡',
          balance: 0,
          kind: 'credit',
          statementDay: null,
          dueDay: null,
          fxCode: null);
      await show(tester);

      expect(find.byKey(const Key('acct-card-stmt')), findsNothing,
          reason: 'a row of zeroes reads as a card that is paid off');
    });

    testWidgets('a bill coming due is at the top, not halfway down a list',
        (tester) async {
      final due = DateTime.now().add(const Duration(days: 3));
      card(closedAgo: 10, dueDay: due.day <= 28 ? due.day : 28);
      spend('a', 100, at: daysAgo(15));
      await show(tester);

      expect(find.byKey(const Key('due-banner')), findsOneWidget);
      expect(find.byKey(const Key('due-card')), findsOneWidget);
    });

    testWidgets('nothing due means no banner', (tester) async {
      card(closedAgo: 10);
      spend('a', 100, at: daysAgo(15));
      await show(tester);

      expect(find.byKey(const Key('due-banner')), findsNothing);
    });
  });
}
