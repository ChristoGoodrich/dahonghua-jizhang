// 设置 on a device, and the language reaching every screen.
//
// The settings screen itself is small — two preferences that need no plugin —
// but the language one is the point of this test file. Eleven screens took a
// `zh` flag and nothing ever set it, so the app was Chinese by accident rather
// than by choice. The threading is what these tests are about: the shell reads
// the language once and hands it down, because a screen that fetched it itself
// would keep the old one until it happened to rebuild, and switching language
// would translate the app a screen at a time.

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/settings_screen.dart';
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: SettingsScreen(zh: zh)));
  await tester.pumpAndSettle();
}

Future<void> shell(WidgetTester tester) async {
  await tester.pumpWidget(const App());
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

/// Tap a row on the 我的 hub, scrolling it into view first.
///
/// The hub grows. A row that fitted on screen when its test was written does
/// not stay fitted, and tapping one that has dropped below the fold lands on
/// the tab bar instead — which looks enough like success to keep passing.
Future<void> tapMeRow(WidgetTester tester, String key) async {
  final f = find.byKey(Key(key));
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() => store.reset());

  group('the language setting', () {
    testWidgets('starts as Chinese', (tester) async {
      expect(store.language(), 'zh');
    });

    testWidgets('switches and stays switched', (tester) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('lang-en')));
      await tester.pumpAndSettle();
      expect(store.language(), 'en');
    });

    testWidgets('a language this build has never heard of falls back to zh',
        (tester) async {
      // a restored config can say anything
      store.setLanguage(lang: 'fr');
      expect(store.language(), 'zh');
    });

    testWidgets('survives a snapshot and a reload', (tester) async {
      store.setLanguage(lang: 'en');
      final json = store.snapshotConfig();

      store.reset();
      expect(store.language(), 'zh');

      expect(store.loadConfig(json: json), isTrue);
      expect(store.language(), 'en');
    });
  });

  group('the language reaching the app', () {
    testWidgets('the shell is Chinese by default', (tester) async {
      await shell(tester);
      expect(find.byKey(const Key('tab-明细')), findsOneWidget);
      expect(find.byKey(const Key('tab-我的')), findsOneWidget);
    });

    testWidgets('and English when the store says so', (tester) async {
      store.setLanguage(lang: 'en');
      await shell(tester);
      expect(find.byKey(const Key('tab-Entries')), findsOneWidget);
      expect(find.byKey(const Key('tab-Me')), findsOneWidget);
    });

    testWidgets('switching it translates the WHOLE shell, not one screen',
        (tester) async {
      // the failure this guards is a language that arrives a screen at a time,
      // which is what happens when each screen reads the setting itself
      await shell(tester);
      await tester.tap(find.byKey(const Key('tab-我的')));
      await tester.pumpAndSettle();
      expect(find.text('记账工具'), findsOneWidget);

      await tapMeRow(tester, 'me-settings');
      await tester.tap(find.byKey(const Key('lang-en')));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();

      // the hub, the tab bar and the rows all moved together
      expect(find.text('Tools'), findsOneWidget);
      expect(find.byKey(const Key('tab-Entries')), findsOneWidget);
      expect(find.text('Report'), findsOneWidget);
      expect(find.text('记账工具'), findsNothing);
    });

    testWidgets('and a pushed screen opens in the language just chosen',
        (tester) async {
      store.setLanguage(lang: 'en');
      await shell(tester);
      await tester.tap(find.byKey(const Key('tab-Me')));
      await tester.pumpAndSettle();
      await tapMeRow(tester, 'me-subs');

      expect(find.text('Subscriptions'), findsOneWidget);
      expect(find.text('No subscriptions yet'), findsOneWidget);
    });
  });

  group('the cycle start', () {
    testWidgets('is stored and shown', (tester) async {
      await show(tester);
      expect(textOf(tester, 'cycle-current'), contains('1'));

      await tester.tap(find.byKey(const Key('cycle-15')));
      await tester.pumpAndSettle();

      expect(budget.settings().cycleStart, 15);
      expect(textOf(tester, 'cycle-current'), contains('15'));
    });

    testWidgets('offers nothing past 28', (tester) async {
      // the months without a 29th, 30th or 31st would skip a cycle entirely
      await show(tester);
      expect(find.byKey(const Key('cycle-28')), findsOneWidget);
      expect(find.byKey(const Key('cycle-31')), findsNothing);
    });

    testWidgets('changing it changes which entries the budget counts',
        (tester) async {
      // the setting is not decorative: the cycle is what the budget screen and
      // the report both slice by
      await show(tester);
      await tester.tap(find.byKey(const Key('cycle-15')));
      await tester.pumpAndSettle();
      expect(budget.settings().cycleStart, 15);
    });
  });

  group('what is deliberately absent', () {
    testWidgets('says so, rather than listing rows that do nothing',
        (tester) async {
      await show(tester);
      // The note is the last thing on a screen that keeps growing, and a
      // ListView does not build what is off screen.
      await tester.scrollUntilVisible(
        find.byKey(const Key('settings-note')), 300);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('settings-note')), findsOneWidget);

      // Asserted by what it NAMES rather than by its wording. A note listing
      // absent features is only worth having while it is accurate, and the
      // way it goes wrong is by still naming something that has since been
      // built — which is exactly what a substring match on the sentence
      // would not notice.
      final note = textOf(tester, 'settings-note');
      expect(note, contains('提醒'), reason: 'reminders really are missing');
      expect(note, isNot(contains('锁屏')), reason: 'the lock is here now');
      expect(note, isNot(contains('主题')), reason: 'so are themes');
      expect(note, isNot(contains('导出')), reason: 'and so is export');
    });
  });
}
