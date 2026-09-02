// Accounts on a device, over the real Rust balances.
//
// The screen's substance is four things the arithmetic decides and the UI must
// not re-decide: what a transfer does to two balances at once, what deleting an
// account does to the entries that pointed at it, why `default` has no buttons,
// and what an unparseable opening balance is worth.
//
// The account picker on the record sheet is tested here too, because it is the
// thing that makes these balances differ from each other at all — before it
// existed every entry landed on `default` and a transfer could not be saved.

import 'package:flutter/material.dart';
import 'package:flutter_app/accounts_screen.dart';
import 'package:flutter_app/record_sheet.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

/// A second account, opened at `balance`. Returns its id.
String open(String name, {double balance = 0, String kind = 'cash'}) =>
    accounts.addAccount(
      id: name,
      name: name,
      balance: balance,
      kind: kind,
      statementDay: null,
      dueDay: null,
      fxCode: null,
    );

void spend(String id, double amt, {String? acct, String cat = 'food'}) {
  final t = now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, acct: acct, ts: t),
    id: id,
    now: t,
  );
}

void earn(String id, double amt, {String? acct}) {
  final t = now;
  store.addEntry(
    entry: store.NewEntry(io: 'inc', cat: 'salary', amt: amt, acct: acct, ts: t),
    id: id,
    now: t,
  );
}

void move(String id, String from, String to, double amt,
    {double? fee, double? discount}) {
  final t = now;
  store.addTransfer(
    transfer: store.NewTransfer(
      from: from,
      to: to,
      amt: amt,
      fee: fee,
      discount: discount,
      ts: t,
    ),
    id: id,
    now: t,
  );
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: AccountsScreen(zh: zh)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

double balanceOf(String id) =>
    accounts.balances().firstWhere((a) => a.id == id).balance;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('a balance', () {
    testWidgets('is the opening figure plus what touched the account',
        (tester) async {
      open('招行', balance: 1000);
      spend('e1', 35.5, acct: '招行');
      earn('e2', 200, acct: '招行');
      await show(tester);

      expect(textOf(tester, 'acct-招行-bal'), '￥1,164.50');
    });

    testWidgets('an entry naming no account lands on default', (tester) async {
      open('招行', balance: 1000);
      spend('e1', 40); // no acct
      await show(tester);

      expect(textOf(tester, 'acct-default-bal'), '￥-40.00');
      expect(textOf(tester, 'acct-招行-bal'), '￥1,000.00');
    });

    testWidgets('an entry naming an account that no longer exists is dropped',
        (tester) async {
      // not resurrected as a phantom row — the arithmetic only writes keys the
      // account list already holds
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'food', amt: 99, acct: 'ghost'),
        id: 'e1',
        now: now,
      );
      await show(tester);

      expect(find.byKey(const Key('acct-ghost-bal')), findsNothing);
      expect(textOf(tester, 'acct-default-bal'), '￥0.00');
    });

    testWidgets('an unparseable opening balance starts at zero', (tester) async {
      // `a.balance || 0` is a truthiness test, so a NaN opening figure starts
      // the account at zero rather than poisoning it for good
      open('坏账', balance: double.nan);
      spend('e1', 10, acct: '坏账');
      await show(tester);

      expect(textOf(tester, 'acct-坏账-bal'), '￥-10.00');
    });
  });

  group('a transfer', () {
    testWidgets('moves the amount out of one account and into the other',
        (tester) async {
      open('招行', balance: 1000);
      open('支付宝', balance: 0);
      move('t1', '招行', '支付宝', 300);
      await show(tester);

      expect(textOf(tester, 'acct-招行-bal'), '￥700.00');
      expect(textOf(tester, 'acct-支付宝-bal'), '￥300.00');
    });

    testWidgets('the fee leaves the source and the discount credits the target',
        (tester) async {
      open('招行', balance: 1000);
      open('支付宝', balance: 0);
      move('t1', '招行', '支付宝', 300, fee: 2, discount: 5);
      await show(tester);

      expect(textOf(tester, 'acct-招行-bal'), '￥698.00'); // 1000 - (300 + 2)
      expect(textOf(tester, 'acct-支付宝-bal'), '￥305.00'); // 300 + 5
    });

    testWidgets('and does not change the total, apart from the fee',
        (tester) async {
      open('招行', balance: 1000);
      open('支付宝', balance: 0);
      move('t1', '招行', '支付宝', 300);
      await show(tester);
      expect(textOf(tester, 'acct-total'), '￥1,000.00');
    });
  });

  group('the total', () {
    testWidgets('adds every account together, including the negative ones',
        (tester) async {
      open('招行', balance: 1000);
      open('信用卡', balance: 0, kind: 'credit');
      spend('e1', 400, acct: '信用卡');
      await show(tester);

      expect(textOf(tester, 'acct-信用卡-bal'), '￥-400.00');
      expect(textOf(tester, 'acct-total'), '￥600.00');
    });

    testWidgets('a negative figure is coloured rather than hidden',
        (tester) async {
      open('信用卡', balance: 0, kind: 'credit');
      spend('e1', 400, acct: '信用卡');
      await show(tester);

      expect(
        tester.widget<Text>(find.byKey(const Key('acct-信用卡-bal'))).style!.color,
        palette.hibiscus,
      );
    });
  });

  group('deleting an account', () {
    testWidgets('migrates the entries that pointed at it rather than orphaning',
        (tester) async {
      open('招行', balance: 0);
      spend('e1', 35, acct: '招行');
      await show(tester);

      await tester.tap(find.byKey(const Key('acct-招行-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('delete-ok')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('acct-招行-bal')), findsNothing);
      expect(store.getEntry(id: 'e1')!.acct, 'default');
      // the money did not evaporate with the account
      expect(textOf(tester, 'acct-default-bal'), '￥-35.00');
    });

    testWidgets('migrates a transfer target too', (tester) async {
      // `acctTo` is as much a reference as `acct`, and v7 left those dangling
      open('招行', balance: 500);
      open('支付宝', balance: 0);
      move('t1', '招行', '支付宝', 100);
      await show(tester);

      await tester.tap(find.byKey(const Key('acct-支付宝-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('delete-ok')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 't1')!.acctTo, 'default');
      expect(textOf(tester, 'acct-default-bal'), '￥100.00');
    });

    testWidgets('stamps the rewritten entries so a sync push can see them',
        (tester) async {
      // an unstamped rewrite is invisible to the push watermark, and other
      // devices would keep pointing at an account that no longer exists
      open('招行', balance: 0);
      spend('e1', 35, acct: '招行');
      final before = store.getEntry(id: 'e1')!.updatedAt!;
      await show(tester);

      await tester.tap(find.byKey(const Key('acct-招行-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('delete-ok')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'e1')!.updatedAt!, greaterThanOrEqualTo(before));
    });

    testWidgets('cancel changes nothing', (tester) async {
      open('招行', balance: 0);
      spend('e1', 35, acct: '招行');
      await show(tester);

      await tester.tap(find.byKey(const Key('acct-招行-delete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('delete-cancel')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('acct-招行-bal')), findsOneWidget);
      expect(store.getEntry(id: 'e1')!.acct, '招行');
    });
  });

  group('the default account', () {
    testWidgets('offers neither destructive button', (tester) async {
      // the core refuses both, and a button that does nothing when pressed is
      // worse than no button at all
      open('招行', balance: 0);
      await show(tester);

      expect(find.byKey(const Key('acct-default-delete')), findsNothing);
      expect(find.byKey(const Key('acct-default-archive')), findsNothing);
      expect(find.byKey(const Key('acct-招行-delete')), findsOneWidget);
      expect(find.byKey(const Key('acct-招行-archive')), findsOneWidget);
    });

    testWidgets('and refuses at the core even when asked directly',
        (tester) async {
      expect(accounts.removeAccount(id: 'default', now: now), isFalse);
      expect(accounts.archiveAccount(id: 'default', archived: true), isFalse);
      expect(accounts.balances().where((a) => a.id == 'default').length, 1);
    });
  });

  group('archiving', () {
    testWidgets('hides the account without touching its balance',
        (tester) async {
      open('旧卡', balance: 250);
      await show(tester);

      await tester.tap(find.byKey(const Key('acct-旧卡-archive')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('acct-旧卡-bal')), findsNothing);
      expect(balanceOf('旧卡'), 250); // still there, still counted
      expect(textOf(tester, 'acct-total'), '￥250.00');
    });

    testWidgets('is reversible from the archived list', (tester) async {
      open('旧卡', balance: 250);
      accounts.archiveAccount(id: '旧卡', archived: true);
      await show(tester);

      expect(find.byKey(const Key('acct-旧卡-bal')), findsNothing);
      await tester.tap(find.byKey(const Key('toggle-archived')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('acct-旧卡-bal')), findsOneWidget);

      await tester.tap(find.byKey(const Key('acct-旧卡-archive')));
      await tester.pumpAndSettle();
      expect(accounts.balances().firstWhere((a) => a.id == '旧卡').archived,
          isFalse);
    });

    testWidgets('moves the record sheet off the account it just hid',
        (tester) async {
      // otherwise the next entry defaults to an account the picker will not
      // show, which reads as the picker being broken
      open('旧卡', balance: 0);
      spend('e1', 10, acct: '旧卡'); // spending there makes it current
      expect(store.currentAccount(), '旧卡');
      await show(tester);

      await tester.tap(find.byKey(const Key('acct-旧卡-archive')));
      await tester.pumpAndSettle();
      expect(store.currentAccount(), 'default');
    });

    testWidgets('there is no toggle when nothing is archived', (tester) async {
      open('招行', balance: 0);
      await show(tester);
      expect(find.byKey(const Key('toggle-archived')), findsNothing);
    });
  });

  group('creating an account', () {
    testWidgets('takes a name, an opening balance and a kind', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-account')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('new-name')), '信用卡');
      await tester.enterText(find.byKey(const Key('new-balance')), '-200');
      await tester.tap(find.byKey(const Key('kind-credit')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('new-ok')));
      // pumped all the way out, which is where a disposed controller asserts
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('new-account-dialog')), findsNothing);
      final made = accounts.balances().firstWhere((a) => a.name == '信用卡');
      expect(made.kind, 'credit');
      expect(made.balance, -200);
      expect(find.text('￥-200.00'), findsWidgets);
    });

    testWidgets('an empty name creates nothing', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-account')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('new-name')), '   ');
      await tester.tap(find.byKey(const Key('new-ok')));
      await tester.pumpAndSettle();

      // the dialog stays open rather than closing on a row it did not write
      expect(find.byKey(const Key('new-account-dialog')), findsOneWidget);
      expect(accounts.balances().length, 1);
      await tester.tap(find.byKey(const Key('new-cancel')));
      await tester.pumpAndSettle();
    });

    testWidgets('an unparseable opening balance is zero, not a refusal',
        (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-account')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('new-name')), '现金');
      await tester.enterText(find.byKey(const Key('new-balance')), 'abc');
      await tester.tap(find.byKey(const Key('new-ok')));
      await tester.pumpAndSettle();

      expect(accounts.balances().firstWhere((a) => a.name == '现金').balance, 0);
    });

    testWidgets('spells its own label colours instead of inheriting them',
        (tester) async {
      // the focused 名称 label came out lavender on the device — Material 3's
      // default scheme, against warm paper, in an app whose accent is amber.
      // No test saw it: a colour a widget does not set is not one a widget
      // test can read.
      await show(tester);
      await tester.tap(find.byKey(const Key('add-account')));
      await tester.pumpAndSettle();

      final name = tester.widget<TextField>(find.byKey(const Key('new-name')));
      expect(name.decoration!.floatingLabelStyle!.color,
          palette.stamen);
      expect(name.decoration!.labelStyle!.color, palette.inkSoft);

      await tester.tap(find.byKey(const Key('new-cancel')));
      await tester.pumpAndSettle();
    });

    testWidgets('cancel creates nothing', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('add-account')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('new-name')), '不要');
      await tester.tap(find.byKey(const Key('new-cancel')));
      await tester.pumpAndSettle();
      expect(accounts.balances().length, 1);
    });
  });

  group('the picker on the record sheet', () {
    testWidgets('records against the account that was picked', (tester) async {
      open('招行', balance: 1000);
      await tester.pumpWidget(
        MaterialApp(home: RecordSheet(onSaved: ({required staleRate}) {})),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('acct-招行')));
      await tester.pumpAndSettle();
      for (final k in ['3', '5']) {
        await tester.tap(find.byKey(Key('key-$k')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(balanceOf('招行'), 965);
    });

    testWidgets('a transfer can be saved at all, which it could not before',
        (tester) async {
      // `validate` refuses a transfer with no destination, and until the picker
      // existed nothing on the sheet could name one
      open('招行', balance: 1000);
      open('支付宝', balance: 0);
      await tester.pumpWidget(
        MaterialApp(home: RecordSheet(onSaved: ({required staleRate}) {})),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('转账'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('acct-招行')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('acct-to-支付宝')));
      await tester.pumpAndSettle();
      for (final k in ['1', '0', '0']) {
        await tester.tap(find.byKey(Key('key-$k')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('flash')), findsOneWidget);
      expect(balanceOf('招行'), 900);
      expect(balanceOf('支付宝'), 100);
    });

    testWidgets('switching to a transfer picks a destination that is not the '
        'source', (tester) async {
      // `pick_io` fills `acctTo` with the first visible account that is not the
      // one being transferred from — which is why the "pick a destination"
      // refusal is almost never seen. A test that expected it here got 已保存.
      open('招行', balance: 1000);
      await tester.pumpWidget(
        MaterialApp(home: RecordSheet(onSaved: ({required staleRate}) {})),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('转账'));
      await tester.pumpAndSettle();
      for (final k in ['5', '0']) {
        await tester.tap(find.byKey(Key('key-$k')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(store.entryCount(), 1);
      expect(balanceOf('default'), -50);
      expect(balanceOf('招行'), 1050);
    });

    testWidgets('and refuses one when there is no second account to pick',
        (tester) async {
      // the one case the auto-pick cannot cover: a fresh install has exactly
      // one account, and money cannot be moved from it to itself
      await tester.pumpWidget(
        MaterialApp(home: RecordSheet(onSaved: ({required staleRate}) {})),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('转账'));
      await tester.pumpAndSettle();
      for (final k in ['5', '0']) {
        await tester.tap(find.byKey(Key('key-$k')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(
        tester.widget<Text>(find.byKey(const Key('flash'))).data,
        '请选择转入账户',
      );
      expect(store.entryCount(), 0);
    });

    testWidgets('and refuses one that goes to where it came from',
        (tester) async {
      open('招行', balance: 1000);
      await tester.pumpWidget(
        MaterialApp(home: RecordSheet(onSaved: ({required staleRate}) {})),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('转账'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('acct-招行')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('acct-to-招行')));
      await tester.pumpAndSettle();
      for (final k in ['5', '0']) {
        await tester.tap(find.byKey(Key('key-$k')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(
        tester.widget<Text>(find.byKey(const Key('flash'))).data,
        '转入和转出不能是同一个账户',
      );
      expect(store.entryCount(), 0);
    });

    testWidgets('does not offer an archived account', (tester) async {
      open('旧卡', balance: 0);
      accounts.archiveAccount(id: '旧卡', archived: true);
      await tester.pumpWidget(
        MaterialApp(home: RecordSheet(onSaved: ({required staleRate}) {})),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('acct-旧卡')), findsNothing);
      expect(find.byKey(const Key('acct-default')), findsOneWidget);
    });

    testWidgets('but keeps one that an entry being edited already sits on',
        (tester) async {
      // otherwise opening an old entry would silently move it somewhere else
      open('旧卡', balance: 0);
      spend('e1', 20, acct: '旧卡');
      accounts.archiveAccount(id: '旧卡', archived: true);

      await tester.pumpWidget(
        MaterialApp(
          home: RecordSheet(editId: 'e1', onSaved: ({required staleRate}) {}),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('acct-旧卡')), findsOneWidget);
    });
  });

  group('accounts survive', () {
    testWidgets('a snapshot and a reload', (tester) async {
      open('招行', balance: 1000);
      accounts.archiveAccount(id: '招行', archived: true);
      final json = store.snapshotConfig();

      store.reset();
      expect(accounts.balances().length, 1);

      expect(store.loadConfig(json: json), isTrue);
      final back = accounts.balances().firstWhere((a) => a.id == '招行');
      expect(back.opening, 1000);
      expect(back.archived, isTrue);
    });
  });
}
