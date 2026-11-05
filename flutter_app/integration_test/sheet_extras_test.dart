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
import 'package:flutter_app/src/rust/api/record.dart' as record;
import 'package:flutter_app/src/rust/api/store.dart' as store;
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
    testWidgets('the pin in the bar takes a name and stores it', (
      tester,
    ) async {
      await sheet(tester);
      for (final k in ['3', '5']) {
        await press(tester, k);
      }
      await tester.tap(find.byKey(const Key('record-pin')));
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

    testWidgets('a transfer offers no pin, and a long press pins nothing', (
      tester,
    ) async {
      // a template logs one account, and a transfer needs two
      await sheet(tester);
      await tester.tap(find.byKey(const Key('dir-xfer')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('record-pin')), findsNothing);

      await press(tester, '5');
      await tester.longPress(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tpl-name-dialog')), findsNothing);
      expect(catalog.templates(), isEmpty);
    });

    testWidgets('a long press on save still works too', (tester) async {
      await sheet(tester);
      for (final k in ['3', '5']) {
        await press(tester, k);
      }
      await tester.longPress(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tpl-name-dialog')), findsOneWidget);
      await tester.tap(find.byKey(const Key('tpl-name-ok')));
      await tester.pumpAndSettle();
      expect(catalog.templates(), hasLength(1));
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

    testWidgets('a new entry starts in the ledger 明细 is filtered to', (
      tester,
    ) async {
      // recorded anywhere else, it would vanish from the list it was
      // recorded on
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.setCurrentLedger(name: '旅行');
      await sheet(tester);

      await press(tester, '5');
      await press(tester, 'save');

      expect(store.liveEntries().single.ledger, '旅行');
    });

    testWidgets('an edit keeps its own ledger, whatever 明细 is on', (
      tester,
    ) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'food', amt: 8, ts: 1000),
        id: 'e1',
        now: 1000,
      );
      catalog.setCurrentLedger(name: '旅行');
      await sheet(tester, editId: 'e1');

      await press(tester, 'save');

      expect(store.getEntry(id: 'e1')!.ledger, anyOf(isNull, ''));
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
  group('subcategories on the sheet', () {
    // The port saved a subcategory and the library could make them, but the
    // sheet had no way to pick one, so every entry was saved without.
    testWidgets('the chosen category offers its own, and one is saved', (
      tester,
    ) async {
      catalog.addSubcat(catKey: 'food', id: 's1', name: '午餐');
      catalog.addSubcat(catKey: 'trans', id: 's2', name: '地铁');
      await sheet(tester);

      expect(find.byKey(const Key('subcat-chip-s1')), findsOneWidget);
      expect(find.byKey(const Key('subcat-chip-s2')), findsNothing);

      await tapOnSheet(tester, const Key('subcat-chip-s1'));
      await press(tester, '5');
      await press(tester, 'save');

      final e = store.liveEntries().single;
      expect((e.cat, e.subcat), ('food', 's1'));
    });

    testWidgets('another category clears it, and offers its own', (
      tester,
    ) async {
      catalog.addSubcat(catKey: 'food', id: 's1', name: '午餐');
      catalog.addSubcat(catKey: 'trans', id: 's2', name: '地铁');
      await sheet(tester);

      await tapOnSheet(tester, const Key('subcat-chip-s1'));
      await tapOnSheet(tester, const Key('cat-chip-trans'));
      expect(find.byKey(const Key('subcat-chip-s1')), findsNothing);
      expect(find.byKey(const Key('subcat-chip-s2')), findsOneWidget);
      await press(tester, '5');
      await press(tester, 'save');

      // 午餐 under 交通 would be a subcategory of nothing
      final e = store.liveEntries().single;
      expect(e.cat, 'trans');
      expect(e.subcat, anyOf(isNull, ''));
    });

    testWidgets('the category already chosen keeps it', (tester) async {
      catalog.addSubcat(catKey: 'food', id: 's1', name: '午餐');
      await sheet(tester);

      await tapOnSheet(tester, const Key('subcat-chip-s1'));
      await tapOnSheet(tester, const Key('cat-chip-food'));
      await press(tester, '5');
      await press(tester, 'save');

      expect(store.liveEntries().single.subcat, 's1');
    });

    testWidgets('tapping the chosen one again clears it', (tester) async {
      catalog.addSubcat(catKey: 'food', id: 's1', name: '午餐');
      await sheet(tester);

      await tapOnSheet(tester, const Key('subcat-chip-s1'));
      await tapOnSheet(tester, const Key('subcat-chip-s1'));
      await press(tester, '5');
      await press(tester, 'save');

      expect(store.liveEntries().single.subcat, anyOf(isNull, ''));
    });

    testWidgets('a category with none spends no row on them', (tester) async {
      // The fields fill the space above the keypad exactly. A row holding
      // only 「＋ 子分类」 on every sheet pushed the learned notes under the
      // keypad on a Pixel 7, where history_test's tap on one missed.
      catalog.addSubcat(catKey: 'trans', id: 's2', name: '地铁');
      await sheet(tester);

      expect(find.byKey(const Key('subcat-add')), findsNothing);
      await tapOnSheet(tester, const Key('cat-chip-trans'));
      expect(find.byKey(const Key('subcat-add')), findsOneWidget);
    });

    testWidgets('＋ 子分类 makes one under the category and picks it', (
      tester,
    ) async {
      catalog.addSubcat(catKey: 'trans', id: 's2', name: '地铁');
      await sheet(tester);
      await tapOnSheet(tester, const Key('cat-chip-trans'));

      await tapOnSheet(tester, const Key('subcat-add'));
      // cleaned as the library cleans a name
      await tester.enterText(find.byKey(const Key('name-field')), '  <打车>  ');
      await tester.tap(find.byKey(const Key('name-ok')));
      await tester.pumpAndSettle();

      final made = catalog.subcatsOf(catKey: 'trans').last;
      expect(made.name, '打车');
      expect(catalog.subcatsOf(catKey: 'trans'), hasLength(2));
      expect(catalog.subcatsOf(catKey: 'food'), isEmpty);
      await press(tester, '5');
      await press(tester, 'save');
      expect(store.liveEntries().single.subcat, made.k);
    });

    testWidgets('an edit opens on the one it was saved with', (tester) async {
      catalog.addSubcat(catKey: 'food', id: 's1', name: '午餐');
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          subcat: 's1',
          amt: 20,
          ts: now,
        ),
        id: 'e1',
        now: now,
      );
      await sheet(tester, editId: 'e1');

      await press(tester, 'save');

      expect(store.getEntry(id: 'e1')!.subcat, 's1');
    });

    testWidgets('a transfer has no category, and so none', (tester) async {
      catalog.addSubcat(catKey: 'food', id: 's1', name: '午餐');
      await sheet(tester);
      expect(find.byKey(const Key('subcat-add')), findsOneWidget);

      await tester.tap(find.byKey(const Key('dir-xfer')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('subcat-add')), findsNothing);
      expect(find.byKey(const Key('subcat-chip-s1')), findsNothing);
    });
  });

  group('a new category from the sheet', () {
    // The shipping picker ended its grid with 「新分类」. The port could make
    // one only in 分类管理, which is not where anyone is when they find they
    // need one.
    Future<void> make(WidgetTester tester, String name, {String? emoji}) async {
      await tapOnSheet(tester, const Key('cat-new'));
      await tester.enterText(find.byKey(const Key('cat-name')), name);
      if (emoji != null) {
        await tester.tap(find.byKey(Key('cat-emoji-$emoji')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('cat-ok')));
      await tester.pumpAndSettle();
    }

    testWidgets('is made, picked, and the entry is filed under it', (
      tester,
    ) async {
      await sheet(tester);
      await make(tester, '猫粮', emoji: '🐱');

      final made = catalog.customCats(io: 'exp').single;
      expect(made.zh, '猫粮');
      expect(made.e, '🐱');
      // the same category 分类管理 shows, and none for the other direction
      expect(catalog.customCats(io: 'inc'), isEmpty);
      expect(find.byKey(Key('cat-chip-${made.k}')), findsOneWidget);

      await press(tester, '5');
      await press(tester, 'save');
      expect(store.liveEntries().single.cat, made.k);
    });

    testWidgets('an income one is an income category', (tester) async {
      await sheet(tester);
      await tester.tap(find.byKey(const Key('dir-inc')));
      await tester.pumpAndSettle();
      await make(tester, '稿费');

      expect(catalog.customCats(io: 'exp'), isEmpty);
      final made = catalog.customCats(io: 'inc').single;
      await press(tester, '5');
      await press(tester, 'save');
      final e = store.liveEntries().single;
      expect(e.io, 'inc');
      expect(e.cat, made.k);
    });

    testWidgets('cancelling makes none and keeps the category picked', (
      tester,
    ) async {
      await sheet(tester);
      await tapOnSheet(tester, const Key('cat-chip-trans'));
      await tapOnSheet(tester, const Key('cat-new'));
      await tester.enterText(find.byKey(const Key('cat-name')), '猫粮');
      await tester.tap(find.byKey(const Key('cat-cancel')));
      await tester.pumpAndSettle();

      expect(catalog.customCats(io: 'exp'), isEmpty);
      await press(tester, '5');
      await press(tester, 'save');
      expect(store.liveEntries().single.cat, 'trans');
    });
  });

  group("a receipt on the sheet", () {
    testWidgets("offers a picker", (tester) async {
      // The system picker is not driven here — a camera has no place in a
      // test harness — only that the control is on the sheet.
      await sheet(tester);
      expect(find.byKey(const Key("record-photo")), findsOneWidget);
    });

    /// An entry with a receipt, written the way the sheet writes one.
    void withReceipt(String id) {
      final form = record
          .initialForm(sourceId: '', editing: false, ledger: '')
          .copyWith(amt: '35', photo: 'r1.jpg');
      final r = record.saveForm(
        form: form,
        editId: '',
        id: id,
        now: now,
        rateWasCached: false,
      );
      expect(r.rejected, isNull);
      // otherwise the tests below could pass by never having had one
      expect(store.getEntry(id: id)!.photo, 'r1.jpg');
    }

    testWidgets('taken off in an edit, stays off', (tester) async {
      // The ✕ emptied the sheet's field, and the save turned "empty" into
      // "not in the patch" — which means "leave it". The receipt was back
      // the next time the entry was opened.
      withReceipt('p1');
      await sheet(tester, editId: 'p1');
      await tapOnSheet(tester, const Key('photo-clear'));
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'p1')!.photo, isNull);
    });

    testWidgets('an edit that leaves it alone keeps it', (tester) async {
      withReceipt('p1');
      await sheet(tester, editId: 'p1');
      await tapOnSheet(tester, const Key('key-0'));
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      final e = store.getEntry(id: 'p1')!;
      expect(e.amt, 350, reason: 'the edit itself has to have landed');
      expect(e.photo, 'r1.jpg');
    });
  });

}
