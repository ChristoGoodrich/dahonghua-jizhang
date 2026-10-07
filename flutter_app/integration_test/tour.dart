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

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/subscriptions.dart' as subs;
import 'package:flutter_app/src/rust/api/theme.dart' as theme;
import 'package:flutter_app/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';

const day = 86400000;

/// Which flower to tour in. Its name prefixes the files, except 大红花's.
const flower = String.fromEnvironment('TOUR_FLOWER', defaultValue: 'default');

/// A month somebody actually lived: breakfasts and lunches, a commute, a few
/// bigger purchases, rent, a salary and a bonus, one expense waiting to be
/// claimed back and one partly refunded.
void seed() {
  final now = DateTime.now().millisecondsSinceEpoch;
  accounts.addAccount(id: 'cash', name: '现金', balance: 820, kind: 'cash');
  accounts.addAccount(id: 'card', name: '招商银行', balance: 23650, kind: 'cash');
  accounts.addAccount(
    id: 'credit',
    name: '信用卡',
    balance: -3120,
    kind: 'credit',
    statementDay: 5,
    dueDay: 23,
  );

  final rows = <(String, String, double, String, int)>[
    ('exp', 'food', 18, '早餐 豆浆油条', 0),
    ('exp', 'food', 42.5, '午饭 牛肉面', 0),
    ('exp', 'trans', 4, '地铁', 0),
    ('exp', 'food', 36, '咖啡', 1),
    ('exp', 'shop', 299, '跑鞋', 1),
    ('exp', 'trans', 27.6, '打车回家', 1),
    ('exp', 'food', 128, '和朋友吃火锅', 2),
    ('exp', 'fun', 68, '电影', 2),
    ('inc', 'salary', 12800, '九月工资', 3),
    ('exp', 'home', 2800, '房租', 3),
    ('exp', 'food', 15, '早餐', 4),
    ('exp', 'health', 86, '药店', 5),
    ('exp', 'study', 59, '一本书', 6),
    ('exp', 'food', 23, '便利店', 7),
    ('exp', 'trans', 380, '高铁 出差', 8),
    ('exp', 'food', 188, '出差晚饭', 8),
    ('inc', 'bonus', 2000, '项目奖金', 10),
    ('exp', 'gift', 520, '朋友婚礼', 12),
    ('exp', 'shop', 1299, '耳机', 14),
    ('exp', 'food', 31, '外卖', 15),
    // last month, so 本月 vs 上月同期 has a month to compare with
    ('exp', 'home', 2800, '房租', 34),
    ('exp', 'food', 412, '聚餐', 36),
    ('exp', 'shop', 689, '外套', 40),
    ('exp', 'trans', 96, '打车', 44),
    ('inc', 'salary', 12800, '八月工资', 34),
  ];
  var i = 0;
  for (final (io, cat, amt, note, ago) in rows) {
    store.addEntry(
      entry: store.NewEntry(
        io: io,
        cat: cat,
        amt: amt,
        note: note,
        ts: now - ago * day - i * 3600000,
        acct: i.isEven ? 'card' : 'cash',
      ),
      id: 'tour-$i',
      now: now,
    );
    i++;
  }
  // the trip is claimable, and the headphones came partly back
  store.updateEntry(
    id: 'tour-14',
    patch: const store.EntryPatch(rb: 'pending'),
    now: now,
  );

  budget.setSettings(
    view: budget.SettingsView(
      budget: 6000,
      dailyBudget: 200,
      cycleStart: 1,
      capCats: const ['food'],
      capAmounts: Float64List.fromList([1500]),
    ),
  );
  subs.addSub(
    sub: const subs.NewSub(
      name: '视频会员',
      amt: 25,
      freq: 'monthly',
      day: 12,
      cat: 'fun',
      emoji: '📺',
      isTransfer: false,
    ),
    id: 'sub-video',
    now: now,
  );
  subs.addSub(
    sub: const subs.NewSub(
      name: '云存储',
      amt: 6,
      freq: 'monthly',
      day: 3,
      cat: 'other',
      emoji: '☁️',
      isTransfer: false,
    ),
    id: 'sub-cloud',
    now: now,
  );
  catalog.addTemplate(
    id: 'tpl-coffee',
    io: 'exp',
    cat: 'food',
    amt: 36,
    note: '咖啡',
    name: '咖啡',
  );
  catalog.addTemplate(
    id: 'tpl-metro',
    io: 'exp',
    cat: 'trans',
    amt: 4,
    note: '地铁',
    name: '地铁',
  );
  catalog.addTag(kind: 'normal', name: '出差');
  catalog.addTag(kind: 'normal', name: '聚餐');
  catalog.addTag(kind: 'ledger', name: '装修');
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pumpAndSettle();
    await binding.takeScreenshot(name);
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
      await tester.tap(
        find.byKey(Key('cal-${today.year}-${today.month}-${today.day}')),
      );
      await tester.pumpAndSettle();
      await tester.drag(
        find.descendant(
          of: find.byKey(const Key('cal-list')),
          matching: find.byType(Scrollable),
        ),
        const Offset(0, -500),
      );
      await shot(tester, '$room-01d-calendar-day');
      await tester.tap(find.byKey(const Key('calendar-toggle')));
      await tester.pumpAndSettle();

      // a delete: it asks, and then says so with 撤销 — which is used, so the
      // shots after this one have the same month in them
      await tester.drag(
        find.ancestor(
          of: find.text('早餐 豆浆油条'),
          matching: find.byType(Dismissible),
        ),
        const Offset(-500, 0),
      );
      await shot(tester, '$room-01e-delete-asks');
      await tester.tap(find.byKey(const Key('entry-delete-ok')));
      await shot(tester, '$room-01f-deleted');
      await tester.tap(find.byKey(const Key('deleted-undo')));
      await tester.pumpAndSettle();

      // a selection, since it is its own screen in all but name
      await tester.longPress(find.text('午饭 牛肉面'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('咖啡'));
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
