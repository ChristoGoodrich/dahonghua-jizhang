// 快捷指令 — what the iPhone's Shortcuts asked for, into the ledger.
//
// The App Intents only write a request down; `shortcuts.dart` reads the queue,
// the core reads each request (`core::shortcut`, whose own tests hold what a
// sentence or a payment means), and this holds the rest: the time each entry
// is put at, the order of the save and the acknowledgement, a replay written
// once, a payment in another currency priced at its day's rate or left
// waiting, the shell draining at launch and while open, and the hub offering
// it on an iPhone and not on an Android phone.
//
// The queue is a fake: the real one is Swift's, and a test cannot run an
// App Intent.

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/shortcuts.dart';
import 'package:flutter_app/shortcuts_screen.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';

/// The Swift queue, as Dart sees it, kept in memory.
class FakeQueue extends ShortcutQueue {
  FakeQueue(this.rows, {this.here = true});

  final List<ShortcutRequest> rows;
  final bool here;
  final consumed = <String>[];

  /// What happened, in order: `read`, `persist`, `consume`, `open`.
  final log = <String>[];
  void Function()? onQueued;

  @override
  bool get supported => here;

  @override
  Future<List<ShortcutRequest>> pending() async {
    log.add('read');
    return [
      for (final r in rows)
        if (!consumed.contains(r.id)) r,
    ];
  }

  @override
  Future<void> consume(List<String> ids) async {
    log.add('consume');
    consumed.addAll(ids);
  }

  @override
  Future<void> openShortcuts() async => log.add('open');

  @override
  void listen(void Function() onQueued) => this.onQueued = onQueued;
}

/// 8:30 on the 9th of November: a morning, so noon of yesterday is a
/// different time of day from the moment the shortcut ran.
final ran = DateTime(2026, 11, 9, 8, 30).millisecondsSinceEpoch;

ShortcutRequest said(String id, String sentence, {int? at}) =>
    ShortcutRequest(id: id, at: at ?? ran, sentence: sentence);

/// A payment, its amount as Wallet writes it, on a phone in China.
ShortcutRequest paid(
  String id,
  String amount,
  String merchant, {
  String region = 'CNY',
}) => ShortcutRequest(
  id: id,
  at: ran,
  amount: amount,
  merchant: merchant,
  region: region,
);

/// The network's rates, and what was asked of it.
class FakeRates {
  FakeRates([Map<String, double>? table]) : table = {...?table};

  final Map<String, double> table;
  final asked = <(String, DateTime)>[];

  Future<double?> call(String cur, DateTime at) async {
    asked.add((cur, at));
    return table[cur];
  }
}

Future<List<String>> drain(FakeQueue q, {FakeRates? rates}) => drainShortcuts(
  q,
  persist: () async => q.log.add('persist'),
  rate: (rates ?? FakeRates()).call,
);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('a request into the ledger', () {
    testWidgets('a sentence becomes its entries, at the moment it ran', (
      tester,
    ) async {
      final q = FakeQueue([said('q1', '午饭35 打车12')]);
      final ids = await drain(q);

      expect(ids, hasLength(2));
      final live = store.liveEntries()..sort((a, b) => a.amt.compareTo(b.amt));
      expect(
        [for (final e in live) (e.note, e.amt)],
        [('打车', 12.0), ('午饭', 35.0)],
      );
      expect(live.every((e) => e.ts == ran), isTrue);
      expect(
        live.every((e) => e.src == null),
        isTrue,
        reason: 'the user\'s words',
      );
    });

    testWidgets('a day the words name is noon of it', (tester) async {
      await drain(FakeQueue([said('q1', '昨天超市128')]));
      final e = store.liveEntries().single;
      expect(e.ts, DateTime(2026, 11, 8, 12).millisecondsSinceEpoch);
    });

    /// 昨天 counts from when it was said, not from when the app next opened.
    testWidgets(
      '昨天 is the day before the shortcut ran, however late it is read',
      (tester) async {
        final aWeekAgo = DateTime(2026, 11, 2, 8, 30).millisecondsSinceEpoch;
        await drain(FakeQueue([said('q1', '昨天超市128', at: aWeekAgo)]));
        expect(
          store.liveEntries().single.ts,
          DateTime(2026, 11, 1, 12).millisecondsSinceEpoch,
        );
      },
    );

    testWidgets(
      'a payment is an expense, filed by its merchant, as a capture',
      (tester) async {
        await drain(FakeQueue([paid('p1', '¥23.50', '滴滴出行')]));
        final e = store.liveEntries().single;
        expect(
          (e.io, e.cat, e.amt, e.note, e.ts),
          ('exp', 'trans', 23.5, '滴滴出行', ran),
        );
        expect(e.src, 'notif', reason: 'as Android\'s 自动记账 rows are');
      },
    );

    /// The queue is acknowledged only once the rows are on disk: a crash in
    /// between hands them over again, rather than losing them.
    testWidgets('the queue forgets only after the ledger is saved', (
      tester,
    ) async {
      final q = FakeQueue([paid('p1', '9', '店')]);
      await drain(q);
      expect(q.log, ['read', 'persist', 'consume']);
      expect(q.consumed, ['p1']);
    });

    testWidgets('handed over again, nothing is written twice', (tester) async {
      final rows = [said('q1', '午饭35'), paid('p1', '9', '店')];
      await drain(FakeQueue(rows));
      expect(store.liveEntries(), hasLength(2));

      // the same requests, as after a crash before the acknowledgement
      final again = FakeQueue(rows);
      expect(await drain(again), isEmpty);
      expect(store.liveEntries(), hasLength(2));
      expect(again.consumed, ['q1', 'p1'], reason: 'and forgotten this time');
      expect(again.log, isNot(contains('persist')), reason: 'nothing to save');
    });

    testWidgets('a deleted one stays deleted when handed over again', (
      tester,
    ) async {
      final rows = [paid('p1', '9', '店')];
      final id = (await drain(FakeQueue(rows))).single;
      store.removeEntry(id: id, now: DateTime.now().millisecondsSinceEpoch);
      expect(await drain(FakeQueue(rows)), isEmpty);
      expect(store.liveEntries(), isEmpty);
    });

    testWidgets('a request that asks for nothing is still forgotten', (
      tester,
    ) async {
      final q = FakeQueue([said('q1', '今天天气不错'), paid('p1', '¥0.00', '店')]);
      expect(await drain(q), isEmpty);
      expect(store.liveEntries(), isEmpty);
      expect(q.consumed, ['q1', 'p1'], reason: 'or it is read on every launch');
    });

    testWidgets('a payment as Wallet writes it, thousands and all', (
      tester,
    ) async {
      final rates = FakeRates();
      await drain(FakeQueue([paid('p1', 'CN¥1,234.50', '宜家家居')]), rates: rates);
      final e = store.liveEntries().single;
      expect((e.amt, e.cur, e.origAmt), (1234.5, null, null));
      expect(rates.asked, isEmpty, reason: 'the ledger\'s own needs no rate');
    });

    testWidgets('one in another currency is converted at its day\'s rate', (
      tester,
    ) async {
      final rates = FakeRates({'USD': 7.1});
      await drain(
        FakeQueue([paid('p1', 'US\$5.00', 'Blue Bottle')]),
        rates: rates,
      );
      final e = store.liveEntries().single;
      expect(e.amt, closeTo(35.5, 1e-9));
      expect(
        (e.cur, e.origAmt, e.rate),
        ('USD', 5.0, 7.1),
        reason: 'its own amount kept beside it, as the record sheet keeps it',
      );
      expect(rates.asked, [
        ('USD', DateTime.fromMillisecondsSinceEpoch(ran)),
      ], reason: 'the day it was paid, not the day it was read');
    });

    testWidgets('a rate is asked once for a currency and a day', (
      tester,
    ) async {
      final rates = FakeRates({'USD': 7.0});
      await drain(
        FakeQueue([
          paid('p1', 'US\$5.00', 'Blue Bottle'),
          paid('p2', 'US\$3.00', 'Muni'),
        ]),
        rates: rates,
      );
      expect(store.liveEntries(), hasLength(2));
      expect(rates.asked, hasLength(1));
    });

    /// A bare ¥ is the yen on a phone in Japan: the region travels with the
    /// request, and the core reads it.
    testWidgets('a bare ¥ is the region\'s own currency', (tester) async {
      final rates = FakeRates({'JPY': 0.047});
      await drain(
        FakeQueue([paid('p1', '¥500', 'ローソン', region: 'JPY')]),
        rates: rates,
      );
      expect(rates.asked.single.$1, 'JPY');
      expect(store.liveEntries().single.origAmt, 500);
    });

    /// No network and no rate held: the payment is not written at a made-up
    /// rate. It stays in the queue, and the next drain that can price it
    /// records it.
    testWidgets('with no rate it waits in the queue, and is recorded later', (
      tester,
    ) async {
      final q = FakeQueue([
        said('q1', '午饭35'),
        paid('p1', 'US\$5.00', 'Blue Bottle'),
      ]);
      final rates = FakeRates();
      await drain(q, rates: rates);
      expect([for (final e in store.liveEntries()) e.note], ['午饭']);
      expect(q.consumed, ['q1'], reason: 'the payment is left to wait');

      rates.table['USD'] = 7.0;
      final ids = await drain(q, rates: rates);
      expect(ids, ['sp1-0']);
      expect(store.getEntry(id: 'sp1-0')!.amt, 35);
      expect(q.consumed, ['q1', 'p1']);
    });

    testWidgets('a request read off the channel', (tester) async {
      final r = ShortcutRequest.fromMap(const {
        'id': 'p1',
        'at': 5,
        'amount': '¥35.00',
        'merchant': '店',
        'region': 'CNY',
      });
      expect(
        (r.id, r.at, r.amount, r.merchant, r.region),
        ('p1', 5, '¥35.00', '店', 'CNY'),
      );
      // a number typed into a shortcut by hand is read as its words
      expect(
        ShortcutRequest.fromMap(const {'id': 'p', 'amount': 35.5}).amount,
        '35.5',
      );
    });

    testWidgets('a phone with no Shortcuts reads nothing', (tester) async {
      final q = FakeQueue([paid('p1', '9', '店')], here: false);
      expect(await drain(q), isEmpty);
      expect(q.log, isEmpty);
      expect(store.liveEntries(), isEmpty);
    });
  });

  group('in the shell', () {
    Future<void> shell(WidgetTester tester, FakeQueue q) async {
      await tester.pumpWidget(MaterialApp(home: Home(shortcuts: q)));
      await tester.pumpAndSettle();
    }

    final notice = find.byKey(const Key('shortcut-logged'));

    /// What Siri or Apple Pay asked for while the app was closed is in the
    /// ledger once it opens, and says so with 撤销.
    testWidgets('what was asked while it was closed is recorded at launch', (
      tester,
    ) async {
      final q = FakeQueue([said('q1', '午饭35 打车12')]);
      await tester.pumpWidget(MaterialApp(home: Home(shortcuts: q)));
      await pumpUntil(
        tester,
        () => notice.evaluate().isNotEmpty,
        'the notice of what was recorded',
      );
      expect(store.liveEntries(), hasLength(2));
      expect(find.text('快捷指令记了 2 笔'), findsOneWidget);

      // pressable, not just built: the notice slides in
      final undo = find.byKey(const Key('shortcut-undo'));
      await pumpUntil(
        tester,
        () => undo.hitTestable().evaluate().isNotEmpty,
        '撤销 pressable',
      );
      await tester.tap(undo);
      await tester.pumpAndSettle();
      expect(store.liveEntries(), isEmpty, reason: '撤销 takes all of it back');
    });

    testWidgets('one asked while it is open is recorded then', (tester) async {
      final q = FakeQueue([]);
      await shell(tester, q);
      expect(store.liveEntries(), isEmpty);

      q.rows.add(paid('p1', '¥18.00', '奶茶'));
      q.onQueued!();
      await pumpUntil(
        tester,
        () => notice.evaluate().isNotEmpty,
        'the notice of what was recorded',
      );
      expect(store.liveEntries().single.amt, 18);
    });

    testWidgets('and on coming back to the foreground', (tester) async {
      final q = FakeQueue([]);
      await shell(tester, q);
      q.rows.add(paid('p1', '¥30.00', '超市'));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await pumpUntil(
        tester,
        () => store.liveEntries().isNotEmpty,
        'the payment recorded on resume',
      );
      expect(store.liveEntries().single.amt, 30);
    });
  });

  group('the screen', () {
    testWidgets('says how, for Siri, the Action button and Apple Pay', (
      tester,
    ) async {
      final q = FakeQueue([]);
      await tester.pumpWidget(
        MaterialApp(home: ShortcutsScreen(zh: true, queue: q)),
      );
      await tester.pumpAndSettle();
      for (final k in ['shortcuts-siri', 'shortcuts-action', 'shortcuts-pay']) {
        expect(find.byKey(Key(k)), findsOneWidget, reason: k);
      }
      // the action the Wallet automation runs, by the name Shortcuts shows
      expect(find.textContaining('记一笔付款'), findsOneWidget);

      await scrollAndTap(tester, find.byKey(const Key('open-shortcuts')));
      expect(q.log, ['read', 'open']);
      expect(
        find.byKey(const Key('shortcuts-waiting')),
        findsNothing,
        reason: 'nothing is waiting',
      );
    });

    /// What is left in the queue when the screen opens found no rate, and
    /// nothing else says so.
    testWidgets('says what is waiting for a rate', (tester) async {
      final q = FakeQueue([paid('p1', 'US\$5.00', 'Blue Bottle')]);
      await tester.pumpWidget(
        MaterialApp(home: ShortcutsScreen(zh: true, queue: q)),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('shortcuts-waiting')), findsOneWidget);
      expect(find.textContaining('还有 1 笔外币付款在等汇率'), findsOneWidget);
    });

    testWidgets('in English too', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: ShortcutsScreen(zh: false, queue: FakeQueue([]))),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Record a payment'), findsOneWidget);
      // the end of a list that builds what it shows
      await scrollTo(tester, find.text('Open Shortcuts'));
      expect(find.text('Open Shortcuts'), findsOneWidget);
    });
  });
}
