// Frame times on the screens 我的 opens: push each, scroll it, pop it.
//
// Not a test, like `tour.dart`: it asserts nothing and the suite does not pick
// it up. It exists because "the second-level screens stutter" is a claim about
// frames, and a change meant to fix it has to be measured before and after
// rather than looked at. Run it in profile mode — debug frames are not real
// frames:
//
//     cd flutter_app
//     flutter drive --profile --driver=test_driver/perf.dart --target=integration_test/perf.dart -d <device>
//
// Writes `build/perf.json`: per screen, the build and raster times of every
// frame from the tap to the pop settling, and of toggling a setting. An
// emulator's numbers are its own — compare runs on one device, not devices with
// each other — and its raster times are mostly the emulator's: they barely move
// with every blur in the app turned off. Its build times are the useful half.
//
// `--dart-define=PERF_ROWS=3000` adds that many entries over the past year, so
// the ledger is the size of one somebody has kept for a while.

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/theme.dart' as theme;
import 'package:flutter_app/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';
import 'tour.dart' show seed;

const _rows = int.fromEnvironment('PERF_ROWS');

/// A year of ordinary entries, on top of the tour's month.
void bulk(int n) {
  final now = DateTime.now().millisecondsSinceEpoch;
  const cats = ['food', 'trans', 'shop', 'fun', 'home'];
  for (var i = 0; i < n; i++) {
    final ts = now - (i * 360 * 86400000 ~/ n) - 3600000;
    store.addEntry(
      entry: store.NewEntry(
        io: i % 23 == 0 ? 'inc' : 'exp',
        cat: i % 23 == 0 ? 'salary' : cats[i % cats.length],
        amt: 5 + (i * 37 % 200).toDouble(),
        note: i % 3 == 0 ? '第$i笔' : null,
        ts: ts,
      ),
      id: 'bulk-$i',
      now: ts,
    );
  }
}

const _screens = [
  'report',
  'reimburse',
  'budget',
  'subs',
  'templates',
  'currency',
  'tags',
  'settings',
];

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // Frames at the display's pace, as the app gets them — not one per pump.
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  setUpAll(ensureRust);

  Future<void> wait(int ms) => Future<void>.delayed(Duration(milliseconds: ms));

  testWidgets('我的', (tester) async {
    store.reset();
    store.setLanguage(lang: 'zh');
    theme.setTheme(key: 'default', dark: false);
    refreshPalette();
    seed();
    bulk(_rows);
    await tester.pumpWidget(const App());
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('tab-我的')));
    await tester.pumpAndSettle();

    final list = find.descendant(
      of: find.byKey(const Key('me-list')),
      matching: find.byType(Scrollable),
    );
    final size = tester.view.physicalSize / tester.view.devicePixelRatio;
    final middle = Offset(size.width / 2, size.height * 0.55);

    for (final id in _screens) {
      final row = find.byKey(Key('me-$id'));
      await scrollTo(tester, row, scrollable: list);
      await wait(300);
      await binding.watchPerformance(() async {
        await tester.tap(row);
        await wait(700);
        await tester.flingFrom(middle, const Offset(0, -300), 1500);
        await wait(700);
        await tester.flingFrom(middle, const Offset(0, 300), 1500);
        await wait(700);
        await goBack(tester);
        await wait(700);
      }, reportKey: id);
    }

    // A setting changed with 设置 open: what it costs the screen being used.
    final settings = find.byKey(const Key('me-settings'));
    await scrollTo(tester, settings, scrollable: list);
    await tester.tap(settings);
    await tester.pumpAndSettle();
    // Every config change takes the same path to the shell, so which one
    // does not matter; the flower is one that asks for no permission.
    await wait(300);
    await binding.watchPerformance(() async {
      for (final f in ['sakura', 'default', 'sakura', 'default']) {
        await tester.tap(find.byKey(Key('theme-$f')));
        await wait(600);
      }
    }, reportKey: 'toggle');
  });
}
