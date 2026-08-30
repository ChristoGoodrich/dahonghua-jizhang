// Two things the ledger already knew and nothing was asking it.
//
// The streak counts calendar days, and which day an instant falls on is the
// device's zone to answer — so Dart resolves the days and the core counts
// them. The note suggestions are the same shape of split: the ledger is Rust's
// and the offering is the screen's.
//
// Every date here is built relative to now. A streak test with a hardcoded
// today fails at midnight for reasons that have nothing to do with the code.

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/record_sheet.dart' as sheet;
import 'package:flutter_app/src/rust/api/history.dart' as history;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

String key(DateTime d) => '${d.year}-${d.month}-${d.day}';

DateTime daysAgo(int n) => DateTime.now().subtract(Duration(days: n));

void add(String id, {
  String io = 'exp',
  String cat = 'food',
  double amt = 30,
  String? note,
  DateTime? at,
}) {
  final t = (at ?? DateTime.now()).millisecondsSinceEpoch;
  store.addEntry(
    entry: store.NewEntry(io: io, cat: cat, amt: amt, note: note, ts: t),
    id: id,
    now: t,
  );
}

int streakOf(List<DateTime> days) => history
    .streak(days: days.map(key).toList(), today: key(DateTime.now()))
    .toInt();

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() => store.reset());

  group('the streak', () {
    testWidgets('an empty ledger has no streak', (tester) async {
      expect(streakOf(const []), 0);
    });

    testWidgets('recording today is a streak of one', (tester) async {
      expect(streakOf([DateTime.now()]), 1);
    });

    testWidgets('three days running counts three', (tester) async {
      expect(streakOf([daysAgo(0), daysAgo(1), daysAgo(2)]), 3);
    });

    testWidgets('a gap ends it, and what is past the gap does not count',
        (tester) async {
      expect(streakOf([daysAgo(0), daysAgo(1), daysAgo(3), daysAgo(4)]), 2);
    });

    testWidgets('several entries on one day are still one day', (tester) async {
      expect(streakOf([daysAgo(0), daysAgo(0), daysAgo(0), daysAgo(1)]), 2);
    });

    testWidgets('the order the days arrive in does not matter',
        (tester) async {
      expect(streakOf([daysAgo(2), daysAgo(0), daysAgo(1)]), 3);
    });

    testWidgets('not having recorded YET today does not break the streak',
        (tester) async {
      // The count starts from yesterday when today is empty, so opening the app
      // in the morning does not show a zero for a streak that is still running.
      expect(streakOf([daysAgo(1), daysAgo(2)]), 2);
    });

    testWidgets('nothing yesterday either and the streak really is over',
        (tester) async {
      expect(streakOf([daysAgo(2), daysAgo(3)]), 0);
    });
  });

  group('note suggestions', () {
    testWidgets('the note used most for a category comes first',
        (tester) async {
      add('a', note: '午饭');
      add('b', note: '午饭');
      add('c', note: '咖啡');

      expect(history.noteHints(io: 'exp', cat: 'food', limit: 4).first, '午饭');
    });

    testWidgets('another category is another history', (tester) async {
      add('a', note: '午饭');
      add('b', cat: 'trans', note: '打车');

      expect(history.noteHints(io: 'exp', cat: 'trans', limit: 4), ['打车']);
    });

    testWidgets('a direction is part of the question', (tester) async {
      add('a', io: 'inc', cat: 'salary', note: '工资');

      expect(history.noteHints(io: 'exp', cat: 'salary', limit: 4), isEmpty);
      expect(history.noteHints(io: 'inc', cat: 'salary', limit: 4), ['工资']);
    });

    testWidgets('a category never used has nothing to offer', (tester) async {
      add('a', note: '午饭');

      expect(history.noteHints(io: 'exp', cat: 'shopping', limit: 4), isEmpty);
    });

    testWidgets('a deleted entry stops being history', (tester) async {
      add('a', note: '午饭');
      store.removeEntry(id: 'a', now: DateTime.now().millisecondsSinceEpoch);

      expect(history.noteHints(io: 'exp', cat: 'food', limit: 4), isEmpty);
    });

    testWidgets('the limit is a limit', (tester) async {
      for (var i = 0; i < 9; i++) {
        add('e$i', note: '备注$i');
      }

      expect(history.noteHints(io: 'exp', cat: 'food', limit: 4), hasLength(4));
    });

    testWidgets('an unknown direction asks nothing of the ledger',
        (tester) async {
      add('a', note: '午饭');

      expect(history.noteHints(io: 'nonsense', cat: 'food', limit: 4), isEmpty);
    });
  });

  group('on the screens', () {
    testWidgets('the record sheet offers what the category is usually called',
        (tester) async {
      add('a', note: '公司食堂');
      add('b', note: '公司食堂');
      await tester.pumpWidget(const MaterialApp(home: sheet.RecordSheet()));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('note-hints')), findsOneWidget);
      expect(find.text('公司食堂'), findsOneWidget);
    });

    testWidgets('tapping one fills the box', (tester) async {
      add('a', note: '公司食堂');
      await tester.pumpWidget(const MaterialApp(home: sheet.RecordSheet()));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('note-hint-公司食堂')));
      await tester.pumpAndSettle();

      expect(find.widgetWithText(TextField, '公司食堂'), findsOneWidget);
    });

    testWidgets('editing a row is not offered that row back', (tester) async {
      // An entry's own note is usually the most-used note for its category, so
      // without this the sheet opens offering a chip that does nothing.
      add('a', note: '公司食堂');
      add('b', note: '公司食堂');
      await tester.pumpWidget(
          MaterialApp(home: sheet.RecordSheet(editId: 'a')));
      await tester.pumpAndSettle();

      expect(find.text('公司食堂'), findsOneWidget,
          reason: 'the box has it; the chips should not repeat it');
    });

    testWidgets('a fresh ledger offers nothing rather than an empty row',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(home: sheet.RecordSheet()));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('note-hints')), findsNothing);
    });

    testWidgets('the hub shows the streak once there is one', (tester) async {
      add('a', at: daysAgo(1));
      add('b', at: daysAgo(0));
      await tester.pumpWidget(const MaterialApp(home: Home()));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('tab-我的')));
      await tester.pumpAndSettle();

      expect(find.textContaining('连续 2 天'), findsOneWidget);
    });

    testWidgets('an empty ledger says nothing about streaks', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: Home()));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('tab-我的')));
      await tester.pumpAndSettle();

      expect(find.textContaining('连续'), findsNothing);
    });
  });
}
