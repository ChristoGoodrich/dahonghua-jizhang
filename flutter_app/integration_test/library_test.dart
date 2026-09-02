// 标签、账本、模板 on a device, over the real Rust catalog.
//
// Tags are of two kinds and the difference is the whole substance. An ordinary
// tag is a label. A ledger is a separate book, so deleting one would orphan
// every entry filed under it — it archives first and deletes only once
// archived. Two rules ride along:
//
//   * removing the ACTIVE ledger clears the filter;
//   * the archived list is stored absent rather than as an empty array, so a
//     sync round-trip does not carry it back as a field that is set.

import 'package:flutter/material.dart';
import 'package:flutter_app/library_screen.dart';
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

Future<void> showTags(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: TagsScreen(zh: zh)));
  await tester.pumpAndSettle();
}

Future<void> showTemplates(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: TemplatesScreen(zh: zh)));
  await tester.pumpAndSettle();
}

/// Type a name into the one-field dialog and accept it.
Future<void> enterName(WidgetTester tester, String name) async {
  await tester.enterText(find.byKey(const Key('name-field')), name);
  await tester.tap(find.byKey(const Key('name-ok')));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('ordinary tags', () {
    testWidgets('are added and removed', (tester) async {
      await showTags(tester);
      expect(find.byKey(const Key('no-tags')), findsOneWidget);

      await tester.tap(find.byKey(const Key('add-tag')));
      await tester.pumpAndSettle();
      await enterName(tester, '报销');

      expect(catalog.tags(), ['报销']);
      expect(find.byKey(const Key('tag-报销')), findsOneWidget);

      await tester.tap(find.byKey(const Key('tag-报销-remove')));
      await tester.pumpAndSettle();
      expect(catalog.tags(), isEmpty);
    });

    testWidgets('a duplicate is ignored rather than refused', (tester) async {
      catalog.addTag(kind: 'normal', name: '报销');
      catalog.addTag(kind: 'normal', name: '报销');
      expect(catalog.tags(), ['报销']);
    });

    testWidgets('a name is trimmed, stripped of brackets and capped',
        (tester) async {
      // the cap is about what a chip can hold, which is why it lives on this
      // side rather than in the core
      await showTags(tester);
      await tester.tap(find.byKey(const Key('add-tag')));
      await tester.pumpAndSettle();
      await enterName(tester, '  <script>0123456789012345678  ');

      expect(catalog.tags().single.length, 16);
      expect(catalog.tags().single, isNot(contains('<')));
    });

    testWidgets('an empty name adds nothing', (tester) async {
      await showTags(tester);
      await tester.tap(find.byKey(const Key('add-tag')));
      await tester.pumpAndSettle();
      await enterName(tester, '   ');

      // the dialog stays open rather than closing on a tag it did not add
      expect(find.byKey(const Key('name-dialog')), findsOneWidget);
      expect(catalog.tags(), isEmpty);
      await tester.tap(find.byKey(const Key('name-cancel')));
      await tester.pumpAndSettle();
    });
  });

  group('ledgers', () {
    testWidgets('archive first, and only then offer to delete', (tester) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      await showTags(tester);

      // an active ledger offers archiving, not deletion
      expect(find.byKey(const Key('ledger-旅行')), findsOneWidget);
      expect(find.byKey(const Key('archived-旅行')), findsNothing);

      await tester.tap(find.byKey(const Key('ledger-旅行-remove')));
      await tester.pumpAndSettle();

      // now it is archived, and only now is there a delete
      expect(find.byKey(const Key('ledger-旅行')), findsNothing);
      expect(find.byKey(const Key('archived-旅行-delete')), findsOneWidget);
      expect(catalog.ledgers(), ['旅行']); // still there, just archived
    });

    testWidgets('an archived one comes back', (tester) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.archiveLedger(name: '旅行', archive: true);
      await showTags(tester);

      await tester.tap(find.byKey(const Key('archived-旅行-restore')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('ledger-旅行')), findsOneWidget);
      expect(catalog.archivedLedgers(), isEmpty);
    });

    testWidgets('deleting an archived one is final', (tester) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.archiveLedger(name: '旅行', archive: true);
      await showTags(tester);

      await tester.tap(find.byKey(const Key('archived-旅行-delete')));
      await tester.pumpAndSettle();

      expect(catalog.ledgers(), isEmpty);
      expect(find.byKey(const Key('no-ledgers')), findsOneWidget);
    });

    testWidgets('archiving the ACTIVE ledger clears the filter',
        (tester) async {
      // otherwise the list stays filtered by a book that is no longer offered
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.setCurrentLedger(name: '旅行');
      expect(catalog.currentLedger(), '旅行');

      catalog.archiveLedger(name: '旅行', archive: true);
      expect(catalog.currentLedger(), '');
    });

    testWidgets('removing the ACTIVE ledger clears the filter too',
        (tester) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.setCurrentLedger(name: '旅行');

      catalog.removeTag(kind: 'ledger', name: '旅行');
      expect(catalog.currentLedger(), '');
    });

    testWidgets('the picker keeps an archived ledger that is still selected',
        (tester) async {
      // an entry already filed under an archived book must not silently move
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.addTag(kind: 'ledger', name: '家用');
      catalog.archiveLedger(name: '旅行', archive: true);

      expect(catalog.pickableLedgers(keep: ''), ['家用']);
      expect(catalog.pickableLedgers(keep: '旅行'), ['旅行', '家用']);
    });
  });

  group('templates', () {
    testWidgets('say how to make one when there are none', (tester) async {
      await showTemplates(tester);
      expect(find.byKey(const Key('no-templates')), findsOneWidget);
    });

    testWidgets('draw a name, a category and a signed amount', (tester) async {
      catalog.addTemplate(
        id: 't1',
        io: 'exp',
        cat: 'food',
        amt: 35,
        note: '午饭',
        name: '公司午饭',
      );
      await showTemplates(tester);

      expect(textOf(tester, 'tpl-t1-name'), '公司午饭');
      expect(textOf(tester, 'tpl-t1-amt'), '-35.00');
      expect(find.textContaining('午饭'), findsWidgets);
    });

    testWidgets('an unnamed one falls back to its category name',
        (tester) async {
      catalog.addTemplate(
          id: 't1', io: 'inc', cat: 'salary', amt: 9000, note: null, name: '');
      await showTemplates(tester);

      expect(textOf(tester, 'tpl-t1-name'), '工资');
      expect(textOf(tester, 'tpl-t1-amt'), '+9,000.00');
    });

    testWidgets('are deleted from the list', (tester) async {
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35, note: null, name: 'X');
      await showTemplates(tester);

      await tester.tap(find.byKey(const Key('tpl-t1-delete')));
      await tester.pumpAndSettle();

      expect(catalog.templates(), isEmpty);
      expect(find.byKey(const Key('no-templates')), findsOneWidget);
    });
  });

  group('what a template would log', () {
    testWidgets('takes the current account and the current ledger',
        (tester) async {
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35, note: '午饭', name: 'X');
      catalog.setCurrentLedger(name: '旅行');

      final d = catalog.templateDraft(id: 't1')!;
      expect(d.cat, 'food');
      expect(d.amt, 35);
      expect(d.note, '午饭');
      expect(d.acct, 'default');
      expect(d.ledger, '旅行');
    });

    testWidgets('has two different fallbacks, and they differ on purpose',
        (tester) async {
      // `tpl.note ?? ''` against `curLedger || undefined`: an absent note
      // becomes an empty string, an empty ledger becomes absent
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35, note: null, name: 'X');
      final d = catalog.templateDraft(id: 't1')!;
      expect(d.note, '');
      expect(d.ledger, isNull);
    });

    testWidgets('an unknown id draws nothing', (tester) async {
      expect(catalog.templateDraft(id: 'nope'), isNull);
    });
  });

  group('all of it survives', () {
    testWidgets('a snapshot and a reload', (tester) async {
      catalog.addTag(kind: 'normal', name: '报销');
      catalog.addTag(kind: 'ledger', name: '旅行');
      catalog.addTag(kind: 'ledger', name: '家用');
      catalog.archiveLedger(name: '旅行', archive: true);
      catalog.setCurrentLedger(name: '家用');
      catalog.addTemplate(
          id: 't1', io: 'exp', cat: 'food', amt: 35, note: '午饭', name: 'X');
      final json = store.snapshotConfig();

      store.reset();
      expect(catalog.tags(), isEmpty);
      expect(catalog.templates(), isEmpty);

      expect(store.loadConfig(json: json), isTrue);
      expect(catalog.tags(), ['报销']);
      expect(catalog.ledgers(), ['旅行', '家用']);
      expect(catalog.archivedLedgers(), ['旅行']);
      expect(catalog.currentLedger(), '家用');
      expect(catalog.templates().single.name, 'X');
      expect(catalog.templates().single.note, '午饭');
    });

    testWidgets('and an empty archive list is written as absent, not as []',
        (tester) async {
      // an explicit `[]` would survive the round trip as a field that is set,
      // which is the same falsy-means-absent rule the rest of the store has
      catalog.addTag(kind: 'ledger', name: '旅行');
      expect(store.snapshotConfig(), isNot(contains('archivedLedgers')));

      catalog.archiveLedger(name: '旅行', archive: true);
      expect(store.snapshotConfig(), contains('archivedLedgers'));

      catalog.archiveLedger(name: '旅行', archive: false);
      expect(store.snapshotConfig(), isNot(contains('archivedLedgers')));
    });
  });
}
