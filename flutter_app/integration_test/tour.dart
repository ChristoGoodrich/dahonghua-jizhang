// A walk through every screen, with a screenshot of each.
//
// Not a test: it asserts nothing and `gen-all-tests.js` does not pick it up,
// because it is named `tour.dart` rather than `*_test.dart`. It exists for
// design work — the review of how the app actually looks has to be done on
// real pixels, with a ledger in it that somebody might keep, and not on memory
// or on an empty screen. Run it before and after a change and compare.
//
//     cd flutter_app
//     flutter drive --driver=test_driver/tour.dart --target=integration_test/tour.dart -d <device>
//
// Another flower than 大红花 with `--dart-define=TOUR_FLOWER=forest` (or
// sakura, daisy, jasmine, ocean, sunset): the green ones are where a colour
// told apart from the leaf only by hue stops being told apart.
//
// Screenshots land in `flutter_app/build/tour/`. They are real surface
// captures, so the glass, the scrims and the lens render as they do on the
// phone — a `RepaintBoundary.toImage` would have drawn every backdrop blur as
// nothing, which is the one thing this app most needs to be seen with.

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/theme.dart' as theme;
import 'package:flutter_app/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'month.dart';
import 'rust_init.dart';
import 'scroll.dart';

/// Which flower to tour in. Its name prefixes the files, except 大红花's.
const flower = String.fromEnvironment('TOUR_FLOWER', defaultValue: 'default');

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pumpAndSettle();
    await binding.takeScreenshot(name);
  }

  /// Bring [target] out where a finger can press it, if it is not already.
  ///
  /// On a Pixel 7 everything the tour presses is in view and this moves
  /// nothing; `scrollTo` would, since it ends by scrolling the target to the
  /// top, and the shots would stop being comparable with earlier ones. On a
  /// 640dp screen (`wm size 1080x1920`, `wm density 480`) the head is most of
  /// the screen, and what is pressed is below it.
  ///
  /// From the top of the page's own list, pinned to its element — the
  /// arrangement `narrow_test` walks 640dp with: a lazy list has not built
  /// what is above where it was left, and a selection rebuilds the page
  /// around the list.
  Future<void> nearby(WidgetTester tester, Finder target) async {
    if (target.hitTestable().evaluate().isNotEmpty) return;
    final list = pageList(tester)!.evaluate().single;
    final pinned = find.byElementPredicate((e) => e == list);
    await tester.drag(pinned, const Offset(0, 6000));
    await tester.pumpAndSettle();
    await scrollTo(tester, target, scrollable: pinned);
  }

  Future<void> tab(WidgetTester tester, String label) async {
    await tester.tap(find.byKey(Key('tab-$label')));
    await tester.pumpAndSettle();
  }

  Future<void> hub(WidgetTester tester, String id, String name) async {
    await scrollAndTap(
      tester,
      find.byKey(Key('me-$id')),
      scrollable: find.descendant(
        of: find.byKey(const Key('me-list')),
        matching: find.byType(Scrollable),
      ),
    );
    await shot(tester, name);
    await goBack(tester);
    await tester.pumpAndSettle();
  }

  for (final dark in [false, true]) {
    final room =
        '${flower == 'default' ? '' : '$flower-'}${dark ? 'dark' : 'light'}';
    testWidgets('tour ($room)', (tester) async {
      store.reset();
      store.setLanguage(lang: 'zh');
      theme.setTheme(key: flower, dark: dark);
      refreshPalette();
      seed();

      await binding.convertFlutterSurfaceToImage();
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();

      await shot(tester, '$room-01-entries');
      // Scrolled, because a scrim over nothing shows nothing: the header's
      // blur is only visible with rows running under it.
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -260));
      await shot(tester, '$room-01b-entries-scrolled');
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 260));
      await tester.pumpAndSettle();

      // the calendar, and a day picked in it
      await tester.tap(find.byKey(const Key('calendar-toggle')));
      await shot(tester, '$room-01c-calendar');
      final today = DateTime.now();
      final calList = find.descendant(
        of: find.byKey(const Key('cal-list')),
        matching: find.byType(Scrollable),
      );
      final cell = find.byKey(
        Key('cal-${today.year}-${today.month}-${today.day}'),
      );
      await nearby(tester, cell);
      await tester.tap(cell);
      await tester.pumpAndSettle();
      await tester.drag(calList, const Offset(0, -500));
      await shot(tester, '$room-01d-calendar-day');
      await tester.tap(find.byKey(const Key('calendar-toggle')));
      await tester.pumpAndSettle();

      // a delete: it asks, and then says so with 撤销 — which is used, so the
      // shots after this one have the same month in them. The rows by key
      // (month.dart): tour-0 is 早餐 豆浆油条, tour-1 午饭 牛肉面, tour-3 咖啡.
      Finder row(int i) => find.byKey(Key('row-tour-$i'));
      await nearby(tester, row(0));
      await tester.drag(row(0), const Offset(-500, 0));
      await shot(tester, '$room-01e-delete-asks');
      await tester.tap(find.byKey(const Key('entry-delete-ok')));
      await shot(tester, '$room-01f-deleted');
      await tester.tap(find.byKey(const Key('deleted-undo')));
      await tester.pumpAndSettle();

      // a selection, since it is its own screen in all but name
      await nearby(tester, row(1));
      await tester.longPress(row(1));
      await tester.pumpAndSettle();
      await nearby(tester, row(3));
      await tester.tap(row(3));
      await shot(tester, '$room-02-selecting');
      await tester.tap(find.byKey(const Key('select-close')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('record-button')));
      await shot(tester, '$room-03-record');
      await goBack(tester);
      await tester.pumpAndSettle();

      await tab(tester, '统计');
      await shot(tester, '$room-04-stats');
      final statsList = find.descendant(
        of: find.byKey(const Key('stats-list')),
        matching: find.byType(Scrollable),
      );
      // The page is several screens long; each of these is roughly one more.
      for (final (n, dy) in [
        ('b', 520.0),
        ('c', 700.0),
        ('d', 700.0),
        ('e', 700.0),
      ]) {
        await tester.drag(statsList, Offset(0, -dy));
        await shot(tester, '$room-04$n-stats-scrolled');
      }
      await tester.drag(statsList, const Offset(0, 4000));
      await tester.pumpAndSettle();

      await tab(tester, '资产');
      await shot(tester, '$room-05-assets');
      await tester.tap(find.byKey(const Key('manage-accounts')));
      await shot(tester, '$room-06-accounts');
      await goBack(tester);
      await tester.pumpAndSettle();

      await tab(tester, '我的');
      await shot(tester, '$room-07-me');

      for (final (id, name) in [
        ('report', '08-report'),
        ('reimburse', '09-reimburse'),
        ('budget', '10-budget'),
        ('subs', '11-subs'),
        ('templates', '12-templates'),
        ('currency', '13-currency'),
        ('tags', '14-tags'),
        ('capture', '15-capture'),
        ('import', '16-import'),
        ('backup', '17-backup'),
        ('sync', '18-sync'),
        ('settings', '19-settings'),
      ]) {
        await hub(tester, id, '$room-$name');
      }

      // 一句话记账 with a sentence read, and 问账本 with a question answered —
      // both on the phone, which is how a fresh install meets them
      final meList = find.descendant(
        of: find.byKey(const Key('me-list')),
        matching: find.byType(Scrollable),
      );
      await scrollAndTap(
        tester,
        find.byKey(const Key('me-ai-entry')),
        // the rows are at the top, and the list was left at the bottom
        delta: -300,
        scrollable: meList,
      );
      await tester.enterText(
        find.byKey(const Key('ai-text')),
        '午饭35 打车12，昨天超市买菜128.5',
      );
      await tester.tap(find.byKey(const Key('ai-read')));
      await shot(tester, '$room-20-ai-entry');
      await goBack(tester);
      await tester.pumpAndSettle();
      await scrollAndTap(
        tester,
        find.byKey(const Key('me-ask')),
        // the rows are at the top, and the list was left at the bottom
        delta: -300,
        scrollable: meList,
      );
      await tester.tap(find.byKey(const Key('ask-suggest-1')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('ask-field')), '上个月餐饮花了多少');
      await tester.tap(find.byKey(const Key('ask-send')));
      await shot(tester, '$room-21-ask');
      await goBack(tester);
      await tester.pumpAndSettle();
    });
  }
}
