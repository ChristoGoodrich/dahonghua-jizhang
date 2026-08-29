// Finding a row, on a device.
//
// The matching and the query parsing are Rust's and are under corpora of their
// own. What this file is about is the seam: a query that names a RANGE comes
// back as wall-clock numbers, and Dart is what turns those into the epoch
// bounds the filter compares against. Get that wrong and "上周" quietly means
// last week somewhere else.
//
// The dates are built relative to now rather than hardcoded. A test that says
// 上周 means 2026-08-17 starts failing on a Monday for reasons that have
// nothing to do with the code.

import 'package:flutter/material.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/src/rust/api/search.dart' as search;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

int msAt(DateTime d) => d.millisecondsSinceEpoch;

void add(String id, {
  String io = 'exp',
  String cat = 'food',
  double amt = 30,
  String? note,
  DateTime? at,
}) {
  final t = msAt(at ?? DateTime.now());
  store.addEntry(
    entry: store.NewEntry(io: io, cat: cat, amt: amt, note: note, ts: t),
    id: id,
    now: t,
  );
}

String today() {
  final d = DateTime.now();
  return '${d.year}-${d.month}-${d.day}';
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: EntryListScreen(zh: zh)));
  await tester.pumpAndSettle();
}

Future<void> type(WidgetTester tester, String q) async {
  await tester.tap(find.byKey(const Key('search-toggle')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('search-field')), q);
  await tester.pumpAndSettle();
}

/// Every entry card currently on screen, by note.
Iterable<String> notesOnScreen(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((t) => t.data ?? '')
    .where((s) => s.isNotEmpty);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() => store.reset());

  group('what the box means', () {
    testWidgets('a bare word is text and nothing else', (tester) async {
      final p = search.parseQuery(query: '星巴克', today: today());

      expect(p.text, '星巴克');
      expect(p.io, isNull);
      expect(p.from, isNull);
    });

    testWidgets('a direction word is lifted out of the text', (tester) async {
      final p = search.parseQuery(query: '收入 工资', today: today());

      expect(p.io, 'inc');
      expect(p.text, '工资');
    });

    testWidgets('a query that is entirely a date leaves no text behind',
        (tester) async {
      final p = search.parseQuery(query: '上周', today: today());

      expect(p.from, isNotNull);
      expect(p.to, isNotNull);
      expect(p.text, isEmpty,
          reason: 'the whole box was the range; there is nothing left to match');
    });

    testWidgets('a range comes back as wall time, not as an instant',
        (tester) async {
      final p = search.parseQuery(query: '上周', today: today());

      // Midnight to the last second of the day — the platform is what places
      // those on the clock.
      expect([p.from!.h, p.from!.mi, p.from!.s], [0, 0, 0]);
      expect([p.to!.h, p.to!.mi, p.to!.s], [23, 59, 59]);
    });
  });

  group('what it finds', () {
    testWidgets('text matches a note', (tester) async {
      add('a', note: '星巴克拿铁');
      add('b', note: '地铁');

      final hits = search.searchIds(
          ids: const ['a', 'b'], text: '星巴克', zh: true);

      expect(hits, ['a']);
    });

    testWidgets('the order given is the order returned', (tester) async {
      add('a', note: '咖啡一');
      add('b', note: '咖啡二');
      add('c', note: '咖啡三');

      expect(search.searchIds(ids: const ['c', 'a', 'b'], text: '咖啡', zh: true),
          ['c', 'a', 'b'],
          reason: 'this is a filter over a list, not a ranking');
    });

    testWidgets('a direction narrows without touching the text',
        (tester) async {
      add('a', io: 'exp', note: '午饭');
      add('b', io: 'inc', cat: 'salary', note: '午饭补贴');

      expect(
          search.searchIds(
              ids: const ['a', 'b'], text: '午饭', io: 'inc', zh: true),
          ['b']);
    });

    testWidgets('a date range excludes what falls outside it', (tester) async {
      final now = DateTime.now();
      add('old', note: '老的', at: now.subtract(const Duration(days: 40)));
      add('new', note: '新的', at: now);

      final from = DateTime(now.year, now.month, now.day)
          .subtract(const Duration(days: 7));
      final hits = search.searchIds(
        ids: const ['old', 'new'],
        text: '',
        fromMs: msAt(from),
        toMs: msAt(now.add(const Duration(days: 1))),
        zh: true,
      );

      expect(hits, ['new']);
    });

    testWidgets('an id the ledger no longer holds is dropped, not thrown on',
        (tester) async {
      add('a', note: '在的');

      expect(search.searchIds(ids: const ['a', 'gone'], text: '', zh: true),
          ['a']);
    });

    testWidgets('an empty query matches everything given', (tester) async {
      add('a');
      add('b');

      expect(search.searchIds(ids: const ['a', 'b'], text: '', zh: true),
          hasLength(2));
    });
  });

  group('the screen', () {
    testWidgets('the box is not there until it is asked for', (tester) async {
      add('a', note: '午饭');
      await show(tester);

      expect(find.byKey(const Key('search-field')), findsNothing);
      expect(find.text('大红花记账'), findsOneWidget);
    });

    testWidgets('typing narrows the list', (tester) async {
      add('a', note: '星巴克');
      add('b', note: '地铁');
      await show(tester);

      await type(tester, '星巴克');

      expect(find.text('星巴克'), findsWidgets);
      expect(find.text('地铁'), findsNothing);
    });

    testWidgets('a date word is read as a date and said so', (tester) async {
      add('a', note: '午饭');
      await show(tester);

      await type(tester, '上周');

      // The readback is the only way a user can tell the word was understood
      // as a range rather than matched as text.
      expect(find.byKey(const Key('search-readback')), findsOneWidget);
    });

    testWidgets('a typed date actually narrows the list, not just the readback',
        (tester) async {
      // The seam this file exists for. The range crosses as wall-clock numbers
      // and Dart places them on the clock; a screen that renders the readback
      // and then forgets to pass the bounds looks completely correct.
      final now = DateTime.now();
      add('old', note: '很久以前', at: now.subtract(const Duration(days: 40)));
      add('new', note: '刚刚');
      await show(tester);

      // 今天 rather than 上周: an entry recorded during the test is today by
      // construction, so there is no hour at which this means something else.
      await type(tester, '今天');

      expect(find.text('刚刚'), findsOneWidget);
      expect(find.text('很久以前'), findsNothing,
          reason: 'the bounds reached the filter, not just the label');
    });

    testWidgets('a direction word is said back too', (tester) async {
      add('a', io: 'inc', cat: 'salary', note: '工资');
      await show(tester);

      await type(tester, '收入');

      expect(find.textContaining('只看收入'), findsOneWidget);
    });

    testWidgets('nothing matched is not the same as nothing recorded',
        (tester) async {
      add('a', note: '午饭');
      await show(tester);

      await type(tester, '不存在的东西');

      expect(find.text('没有找到'), findsOneWidget);
      expect(find.text('还没有记账'), findsNothing);
    });

    testWidgets('an empty ledger still says it is empty', (tester) async {
      await show(tester);

      expect(find.text('还没有记账'), findsOneWidget);
    });

    testWidgets('closing the box brings the whole list back', (tester) async {
      add('a', note: '星巴克');
      add('b', note: '地铁');
      await show(tester);
      await type(tester, '星巴克');
      expect(find.text('地铁'), findsNothing);

      await tester.tap(find.byKey(const Key('search-toggle')));
      await tester.pumpAndSettle();

      expect(find.text('地铁'), findsOneWidget);
      expect(find.byKey(const Key('search-field')), findsNothing);
    });

    testWidgets('English hint when the app is in English', (tester) async {
      await show(tester, zh: false);
      await tester.tap(find.byKey(const Key('search-toggle')));
      await tester.pumpAndSettle();

      expect(find.text('last week · income · coffee'), findsOneWidget);
    });
  });
}
