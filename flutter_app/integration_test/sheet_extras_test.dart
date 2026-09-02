// Templates, tags and ledgers on the record sheet.
//
// All three were already plumbed — the form carries them and `save_form`
// writes them — and none of them had any way in. A template you cannot log and
// a tag you cannot attach are half-features, so this closes the loop for both.
//
// The three rules worth pinning are the core's, not the screen's: a template
// draft takes the CURRENT account and ledger rather than storing its own, its
// two fallbacks point opposite ways, and tapping the ledger already selected
// clears it — there is no "no ledger" chip to add.

import 'package:flutter/material.dart';
import 'package:flutter_app/record_sheet.dart';
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

Future<void> sheet(WidgetTester tester, {String? editId}) async {
  await tester.pumpWidget(MaterialApp(
    home: RecordSheet(editId: editId, onSaved: ({required staleRate}) {}),
  ));
  await tester.pumpAndSettle();
}

/// Tap something on the sheet, scrolling it into view first.
///
/// The sheet grows: a currency row arrived between the accounts and the note,
/// and a chip that fitted on screen when its test was written does not stay
/// fitted. Tapping one below the fold lands on whatever is at those
/// coordinates instead — which is a pass or a fail depending on luck.
Future<void> tapOnSheet(WidgetTester tester, Key key) async {
  final f = find.byKey(key);
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Future<void> press(WidgetTester tester, String k) async {
  await tester.tap(find.byKey(Key('key-$k')));
  await tester.pumpAndSettle();
}

String amountShown(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('amount-expr'))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('templates on the sheet', () {
    testWidgets('are absent until one exists', (tester) async {
      await sheet(tester);
      expect(find.byKey(const Key('tpl-chip-t1')), findsNothing);
    });

    testWidgets('a tap fills the form rather than saving', (tester) async {
      // the amount is usually right and the note usually is not; a chip that
      // wrote a row on one tap would be a chip you could not correct
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35.5, note: '午饭', name: '公司午饭');
      await sheet(tester);

      await tester.tap(find.byKey(const Key('tpl-chip-t1')));
      await tester.pumpAndSettle();

      expect(amountShown(tester), '35.5');
      expect(find.text('午饭'), findsWidgets);
      expect(store.entryCount(), 0); // nothing written yet
    });

    testWidgets('the filled amount is a plain number, not a formatted one',
        (tester) async {
      // `35.50` in the keypad panel would read back as a different expression
      // from the `35.5` the template holds
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35.5, note: null, name: 'X');
      await sheet(tester);
      await tester.tap(find.byKey(const Key('tpl-chip-t1')));
      await tester.pumpAndSettle();
      expect(amountShown(tester), '35.5');
    });

    testWidgets('and then saving writes exactly that entry', (tester) async {
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35.5, note: '午饭', name: 'X');
      await sheet(tester);

      await tester.tap(find.byKey(const Key('tpl-chip-t1')));
      await tester.pumpAndSettle();
      await press(tester, 'save');

      final e = store.liveEntries().single;
      expect(e.amt, 35.5);
      expect(e.cat, 'food');
      expect(e.note, '午饭');
    });

    testWidgets('a template takes the CURRENT ledger, not one of its own',
        (tester) async {
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35.5, note: null, name: 'X');
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.setCurrentLedger(name: '旅行');
      await sheet(tester);

      await tester.tap(find.byKey(const Key('tpl-chip-t1')));
      await tester.pumpAndSettle();
      await press(tester, 'save');

      expect(store.liveEntries().single.ledger, '旅行');
    });

    testWidgets('are hidden while editing an entry', (tester) async {
      // a template is a way to START an entry, and this one has started
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35.5, note: null, name: 'X');
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'food', amt: 12, ts: now),
        id: 'e1',
        now: now,
      );
      await sheet(tester, editId: 'e1');
      expect(find.byKey(const Key('tpl-chip-t1')), findsNothing);
    });
  });

  group('pinning one from the sheet', () {
    testWidgets('a long press on save takes a name and stores it',
        (tester) async {
      await sheet(tester);
      for (final k in ['3', '5']) {
        await press(tester, k);
      }
      await tester.longPress(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tpl-name-dialog')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('tpl-name-field')), '午饭');
      await tester.tap(find.byKey(const Key('tpl-name-ok')));
      await tester.pumpAndSettle();

      final t = catalog.templates().single;
      expect(t.name, '午饭');
      expect(t.amt, 35);
      expect(store.entryCount(), 0); // pinning is not recording
    });

    testWidgets('an empty name is allowed, because the list falls back',
        (tester) async {
      await sheet(tester);
      await press(tester, '9');
      await tester.longPress(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('tpl-name-ok')));
      await tester.pumpAndSettle();

      expect(catalog.templates().single.name, '');
    });

    testWidgets('with no amount it says so instead of pinning nothing',
        (tester) async {
      await sheet(tester);
      await tester.longPress(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tpl-name-dialog')), findsNothing);
      expect(catalog.templates(), isEmpty);
      expect(
        tester.widget<Text>(find.byKey(const Key('flash'))).data,
        '先输入金额',
      );
    });

    testWidgets('cancelling pins nothing', (tester) async {
      await sheet(tester);
      await press(tester, '9');
      await tester.longPress(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('tpl-name-cancel')));
      await tester.pumpAndSettle();
      expect(catalog.templates(), isEmpty);
    });
  });

  group('tags on the sheet', () {
    testWidgets('are absent until one is made', (tester) async {
      await sheet(tester);
      expect(find.byKey(const Key('tag-chip-报销')), findsNothing);
    });

    testWidgets('attach to the entry, and more than one can', (tester) async {
      catalog.addTag(kind: 'normal', name: '报销');
      catalog.addTag(kind: 'normal', name: '公司');
      await sheet(tester);

      await tapOnSheet(tester, const Key('tag-chip-报销'));
      await tapOnSheet(tester, const Key('tag-chip-公司'));
      await press(tester, '5');
      await press(tester, 'save');

      expect(store.liveEntries().single.tags, ['报销', '公司']);
    });

    testWidgets('a second tap takes one off again', (tester) async {
      catalog.addTag(kind: 'normal', name: '报销');
      await sheet(tester);

      await tapOnSheet(tester, const Key('tag-chip-报销'));
      await tapOnSheet(tester, const Key('tag-chip-报销'));
      await press(tester, '5');
      await press(tester, 'save');

      expect(store.liveEntries().single.tags, anyOf(isNull, isEmpty));
    });
  });

  group('the ledger on the sheet', () {
    testWidgets('is absent until a book is made', (tester) async {
      await sheet(tester);
      expect(find.byKey(const Key('ledger-chip-旅行')), findsNothing);
    });

    testWidgets('files the entry under the one picked', (tester) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      await sheet(tester);

      await tapOnSheet(tester, const Key('ledger-chip-旅行'));
      await press(tester, '5');
      await press(tester, 'save');

      expect(store.liveEntries().single.ledger, '旅行');
    });

    testWidgets('tapping the one already picked clears it', (tester) async {
      // single-select with no "none" chip: the way back out is the same tap
      catalog.addTag(kind: 'ledger', name: '旅行');
      await sheet(tester);

      await tapOnSheet(tester, const Key('ledger-chip-旅行'));
      await tapOnSheet(tester, const Key('ledger-chip-旅行'));
      await press(tester, '5');
      await press(tester, 'save');

      expect(store.liveEntries().single.ledger, anyOf(isNull, ''));
    });

    testWidgets('an archived book is not offered', (tester) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.archiveLedger(name: '旅行', archive: true);
      await sheet(tester);
      expect(find.byKey(const Key('ledger-chip-旅行')), findsNothing);
    });

    testWidgets('but one an edited entry already sits on is', (tester) async {
      // otherwise opening an old entry would silently move it off its book
      catalog.addTag(kind: 'ledger', name: '旅行');
      store.addEntry(
        entry: store.NewEntry(
            io: 'exp', cat: 'food', amt: 12, ledger: '旅行', ts: now),
        id: 'e1',
        now: now,
      );
      catalog.archiveLedger(name: '旅行', archive: true);

      await sheet(tester, editId: 'e1');
      expect(find.byKey(const Key('ledger-chip-旅行')), findsOneWidget);
    });
  });
}
