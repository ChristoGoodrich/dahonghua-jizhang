// 导出 CSV, on a device, with a real file.
//
// The rows, their order and their columns are Rust's and are under a corpus.
// What is testable only here is the seam and the file: that the day in the
// first column is the day this phone shows, that the bytes reach disk, and
// that the BOM Excel needs survives being written.
//
// The share sheet is injected. A test cannot drive a system chooser, and the
// part worth testing is the file that would be handed to it.

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_app/settings_screen.dart';
import 'package:flutter_app/src/rust/api/export.dart' as exporter;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

String dayOf(DateTime d) => '${d.year}-${d.month}-${d.day}';

void add(String id, {
  String io = 'exp',
  String cat = 'food',
  double amt = 30,
  String? note,
  String? acct,
  DateTime? at,
}) {
  final t = (at ?? DateTime.now()).millisecondsSinceEpoch;
  store.addEntry(
    entry: store.NewEntry(
        io: io, cat: cat, amt: amt, note: note, acct: acct, ts: t),
    id: id,
    now: t,
  );
}

/// The whole ledger as CSV bytes, the way the screen asks for it.
List<int> csvBytes() {
  final live = store.liveEntries();
  return exporter.exportCsv(
    ids: live.map((e) => e.id).toList(),
    daysOf: live
        .map((e) => dayOf(DateTime.fromMillisecondsSinceEpoch(e.ts)))
        .toList(),
  );
}

/// The document as text, BOM dropped — for the assertions that are about
/// content rather than about the bytes.
String csv() => utf8.decode(csvBytes().skip(3).toList());

/// Tap a control on the settings screen, scrolling it into view first.
///
/// The screen keeps growing — reminders arrived above this button — and a
/// ListView does not build what is off screen. Tapping a control below the
/// fold lands on whatever is at those coordinates instead.
Future<void> tapSetting(WidgetTester tester, Key key) async {
  // `scrollUntilVisible`, not `ensureVisible`: the latter needs the widget to
  // be in the tree already, and a ListView does not build what is off screen
  // at all. There is nothing to make visible until the scroll has built it.
  await tester.scrollUntilVisible(find.byKey(key), 300);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() => store.reset());

  group('the document', () {
    testWidgets('starts with a BOM, so Excel does not guess a code page',
        (tester) async {
      add('a', note: '午饭');

      // Without it Excel reads the file as a local code page and every Chinese
      // category name comes out as mojibake. Checked as BYTES, because a Dart
      // string cannot hold the answer: `Utf8Decoder` strips a leading BOM, so
      // asserting on decoded text would pass with the BOM deleted.
      expect(csvBytes().take(3).toList(), [0xEF, 0xBB, 0xBF]);
    });

    testWidgets('has a header and one line per entry', (tester) async {
      add('a');
      add('b');

      expect(csv().split('\n'), hasLength(3));
    });

    testWidgets('an empty ledger is a header and nothing else',
        (tester) async {
      final lines = csv().split('\n');

      expect(lines, hasLength(1));
      expect(lines.first, contains('date'));
    });

    testWidgets('the date column is the local day, not the UTC one',
        (tester) async {
      // The shipping app used toISOString().slice(0, 10) here, so in Sydney
      // every entry logged before ten in the morning exported with yesterday's
      // date. The day comes from Dart now, which is where a zone is known.
      final now = DateTime.now();
      add('a', at: now);

      final row = csv().split('\n')[1];
      final expected = '${now.year}-'
          '${now.month.toString().padLeft(2, '0')}-'
          '${now.day.toString().padLeft(2, '0')}';
      expect(row, startsWith(expected));
    });

    testWidgets('a deleted entry is not in it', (tester) async {
      add('a', note: '留下');
      add('b', note: '删掉');
      store.removeEntry(id: 'b', now: DateTime.now().millisecondsSinceEpoch);

      final out = csv();
      expect(out, contains('留下'));
      expect(out, isNot(contains('删掉')));
    });

    testWidgets('a note with a comma does not become two columns',
        (tester) async {
      add('a', note: '午饭,加了个蛋');

      final row = csv().split('\n')[1];
      expect(row, contains('"午饭,加了个蛋"'),
          reason: 'the cell is quoted, or every column after it shifts');
    });

    testWidgets('a note with a quote in it survives', (tester) async {
      add('a', note: '他说"就这样"');

      expect(csv(), contains('他说""就这样""'));
    });

    testWidgets('the account column is a name, not an id', (tester) async {
      add('a', acct: 'cash');

      // 'cash' is a real account id, so what lands is its display name.
      final row = csv().split('\n')[1];
      expect(row, isNot(contains(',cash,')));
    });

    testWidgets('oldest first, whatever order the ledger is in',
        (tester) async {
      final now = DateTime.now();
      add('new', note: '新的', at: now);
      add('old', note: '旧的', at: now.subtract(const Duration(days: 5)));

      final lines = csv().split('\n');
      expect(lines[1], contains('旧的'));
      expect(lines[2], contains('新的'));
    });
  });

  group('the screen', () {
    testWidgets('writes a file and hands it over', (tester) async {
      add('a', note: '午饭');
      String? shared;
      await tester.pumpWidget(MaterialApp(
        home: SettingsScreen(share: (p) async => shared = p),
      ));
      await tester.pumpAndSettle();

      await tapSetting(tester, const Key('export-csv'));

      expect(shared, isNotNull);
      final file = File(shared!);
      expect(await file.exists(), isTrue);
      expect(await file.readAsString(), contains('午饭'));
    });

    testWidgets('the file is named for the day it was taken', (tester) async {
      add('a');
      String? shared;
      await tester.pumpWidget(MaterialApp(
        home: SettingsScreen(share: (p) async => shared = p),
      ));
      await tester.pumpAndSettle();
      await tapSetting(tester, const Key('export-csv'));

      final name = shared!.split(RegExp(r'[/\\]')).last;
      expect(name, startsWith('dahonghua-'));
      expect(name, endsWith('.csv'));
    });

    testWidgets('it says how many rows went', (tester) async {
      add('a');
      add('b');
      add('c');
      await tester.pumpWidget(MaterialApp(
        home: SettingsScreen(share: (_) async {}),
      ));
      await tester.pumpAndSettle();

      await tapSetting(tester, const Key('export-csv'));

      expect(find.text('已导出 3 条'), findsOneWidget);
    });

    testWidgets('a share that fails says so rather than looking finished',
        (tester) async {
      add('a');
      await tester.pumpWidget(MaterialApp(
        home: SettingsScreen(share: (_) async => throw const FileSystemException('no')),
      ));
      await tester.pumpAndSettle();

      await tapSetting(tester, const Key('export-csv'));

      expect(find.text('导出失败了'), findsOneWidget);
    });

    testWidgets('the file is real UTF-8 on disk, BOM included', (tester) async {
      add('a', note: '星巴克');
      String? shared;
      await tester.pumpWidget(MaterialApp(
        home: SettingsScreen(share: (p) async => shared = p),
      ));
      await tester.pumpAndSettle();
      await tapSetting(tester, const Key('export-csv'));

      final bytes = await File(shared!).readAsBytes();
      expect(bytes.take(3).toList(), [0xEF, 0xBB, 0xBF]);
      expect(utf8.decode(bytes.skip(3).toList()), contains('星巴克'));
    });

    testWidgets('English throughout when the app is in English',
        (tester) async {
      add('a');
      await tester.pumpWidget(MaterialApp(
        home: SettingsScreen(zh: false, share: (_) async {}),
      ));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(find.byKey(const Key('export-csv')), 300);
      await tester.pumpAndSettle();
      expect(find.text('Export CSV'), findsOneWidget);
      await tapSetting(tester, const Key('export-csv'));
      expect(find.text('Exported 1'), findsOneWidget);
    });

    testWidgets('the settings note no longer claims export is missing',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(home: SettingsScreen()));
      await tester.pumpAndSettle();

      // The note is the last thing on a screen that keeps growing, and a
      // ListView does not build what is off screen.
      await tester.scrollUntilVisible(
        find.byKey(const Key('settings-note')), 300);
      await tester.pumpAndSettle();
      final note = tester.widget<Text>(find.byKey(const Key('settings-note')));

      // The note is allowed to say xlsx export is not done — that one is a
      // decision, and it says why. What it may not do is leave `导出`
      // unqualified, which reads as "this app cannot export" to someone who
      // has just used the button three lines above.
      for (final sentence in note.data!.split('。')) {
        if (!sentence.contains('导出')) continue;
        expect(sentence, contains('xlsx'),
            reason: 'a list of what is missing has to stop naming what is here');
      }
    });
  });
}
