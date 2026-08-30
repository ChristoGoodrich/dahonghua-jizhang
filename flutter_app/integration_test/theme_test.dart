// 主题 — seven flowers, each with a day and a night.
//
// The colours are Rust's, under a 504-case corpus, so nothing here re-checks
// arithmetic. What only a device shows is whether a choice actually reaches
// the screen: the palette is a cached getter, `MaterialApp.theme` is computed
// once in a widget that has to be rebuilt, and the choice has to survive a
// restart. Each of those is a place a correct palette can fail to arrive.

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/settings_screen.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/theme.dart' as theme;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_app/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

Future<void> showSettings(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: SettingsScreen(zh: zh)));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() {
    store.reset();
    // The palette is process-global and cached, so one test's flower is
    // another's fixture unless this is here.
    theme.setTheme(key: 'default', dark: false);
    refreshPalette();
  });

  group('the choice', () {
    testWidgets('starts on the hibiscus the app is named for', (tester) async {
      expect(theme.themeKey(), 'default');
      expect(theme.isDark(), isFalse);
    });

    testWidgets('every flower is offered, with the accent it is known by',
        (tester) async {
      final opts = theme.themeOptions();

      expect(opts, hasLength(7));
      expect(opts.first.key, 'default');
      expect(opts.first.swatch, '#D94E5C');
    });

    testWidgets('a key this build has never heard of reads back as default',
        (tester) async {
      theme.setTheme(key: 'chrysanthemum', dark: false);

      expect(theme.themeKey(), 'default',
          reason: 'a config from a newer build must not stop the app opening');
    });

    testWidgets('the stored key is normalised, not kept verbatim',
        (tester) async {
      theme.setTheme(key: 'SAKURA', dark: false);

      expect(theme.themeKey(), 'default',
          reason: 'what is stored is always a key this build understands');
    });
  });

  group('the palette', () {
    testWidgets('changing the flower changes the accent', (tester) async {
      final before = palette.hibiscus;
      theme.setTheme(key: 'ocean', dark: false);
      refreshPalette();

      expect(palette.hibiscus, isNot(before));
      expect(palette.hibiscus, parseHex('#4A90B8'));
    });

    testWidgets('the dark room keeps the flower', (tester) async {
      theme.setTheme(key: 'ocean', dark: false);
      refreshPalette();
      final accent = palette.hibiscus;

      theme.setTheme(key: 'ocean', dark: true);
      refreshPalette();

      expect(palette.hibiscus, accent, reason: 'only the room changes');
      expect(palette.isDark, isTrue);
    });

    testWidgets('the dark paper is dark and the ink is light', (tester) async {
      theme.setTheme(key: 'default', dark: true);
      refreshPalette();

      // The one property that matters and that a wrong swap would break:
      // paper and ink must not both be dark.
      expect(palette.paper.computeLuminance(),
          lessThan(palette.ink.computeLuminance()));
    });

    testWidgets('every flower is readable in both rooms', (tester) async {
      for (final o in theme.themeOptions()) {
        for (final dark in [false, true]) {
          theme.setTheme(key: o.key, dark: dark);
          refreshPalette();
          final gap = (palette.paper.computeLuminance() -
                  palette.ink.computeLuminance())
              .abs();
          expect(gap, greaterThan(0.5),
              reason: '${o.key} ${dark ? 'dark' : 'light'} has too little '
                  'contrast between paper and ink');
        }
      }
    });

    testWidgets('the cache is what makes a stale palette possible',
        (tester) async {
      final before = palette.hibiscus;
      theme.setTheme(key: 'forest', dark: false);

      // Deliberately NOT refreshed: this is the failure mode the getter has,
      // and the reason every caller of setTheme has to refresh.
      expect(palette.hibiscus, before);

      refreshPalette();
      expect(palette.hibiscus, isNot(before));
    });
  });

  group('the settings screen', () {
    testWidgets('offers a swatch per flower and a dark switch',
        (tester) async {
      await showSettings(tester);

      expect(find.byKey(const Key('theme-default')), findsOneWidget);
      expect(find.byKey(const Key('theme-sunset')), findsOneWidget);
      expect(find.byKey(const Key('dark-toggle')), findsOneWidget);
    });

    testWidgets('tapping a swatch changes the palette', (tester) async {
      await showSettings(tester);

      await tester.tap(find.byKey(const Key('theme-jasmine')));
      await tester.pumpAndSettle();

      expect(theme.themeKey(), 'jasmine');
      expect(palette.hibiscus, parseHex('#7C9C8F'),
          reason: 'the cached palette was refreshed, not left behind');
    });

    testWidgets('the switch turns the light off without losing the flower',
        (tester) async {
      await showSettings(tester);
      await tester.tap(find.byKey(const Key('theme-sunset')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('dark-toggle')));
      await tester.pumpAndSettle();

      expect(theme.isDark(), isTrue);
      expect(theme.themeKey(), 'sunset');
    });

    testWidgets('the screen it is chosen on repaints itself', (tester) async {
      await showSettings(tester);
      await tester.tap(find.byKey(const Key('dark-toggle')));
      await tester.pumpAndSettle();

      // The settings screen paints its own background from the palette, so it
      // is the first thing that would show a stale one.
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold).first);
      expect(scaffold.backgroundColor, palette.paper);
      expect(palette.isDark, isTrue);
    });

    testWidgets('the note no longer claims themes are missing',
        (tester) async {
      await showSettings(tester);

      final note = tester.widget<Text>(find.byKey(const Key('settings-note')));
      expect(note.data, isNot(contains('主题')));
    });
  });

  group('the whole app', () {
    testWidgets('Material defaults follow the theme, not just our own widgets',
        (tester) async {
      // `MaterialApp.theme` is computed once. Without the root rebuilding, a
      // dark app keeps light dialogs and light menus — every widget this app
      // does not paint itself.
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('tab-我的')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('me-settings')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('me-settings')));
      await tester.pumpAndSettle();

      // The theme group is partway down a scrolling screen. Tapping a control
      // below the fold lands on whatever is at those coordinates instead.
      await tester.ensureVisible(find.byKey(const Key('dark-toggle')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('dark-toggle')));
      await tester.pumpAndSettle();

      final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
      expect(app.theme!.colorScheme.brightness, Brightness.dark);
    });

    testWidgets('the choice survives a snapshot and a reload', (tester) async {
      theme.setTheme(key: 'daisy', dark: true);
      final blob = store.snapshotConfig();

      theme.setTheme(key: 'default', dark: false);
      expect(store.loadConfig(json: blob), isTrue);

      expect(theme.themeKey(), 'daisy');
      expect(theme.isDark(), isTrue);
    });

    testWidgets('a config written before dark mode existed is a lit room',
        (tester) async {
      theme.setTheme(key: 'ocean', dark: true);

      expect(store.loadConfig(json: '{"theme":"forest"}'), isTrue);

      expect(theme.themeKey(), 'forest');
      expect(theme.isDark(), isFalse,
          reason: 'a missing key is not a dark room');
    });

    testWidgets('a config with no theme at all is the default flower',
        (tester) async {
      theme.setTheme(key: 'ocean', dark: true);

      expect(store.loadConfig(json: '{}'), isTrue);

      expect(theme.themeKey(), 'default');
      expect(theme.isDark(), isFalse);
    });
  });
}
