// Every screen at the narrowest phone the app is laid out for.
//
// That phone is 360×640dp. 360 is the width of most Android phones that are
// not the large ones — a Galaxy A, a Redmi, a Pixel with its display size
// turned up — and the suite otherwise runs on a Pixel 7, 412dp wide, where
// 52dp of slack hides a row that does not fit. The one time the suite ran on
// a smaller screen it found fifty overflows. 640 is the height of a 16:9 one,
// and a sheet with a keypad in it runs out of height before width.
//
// The walk is the tour's, with the tour's month in it, in both languages:
// English is the longer one, and a row that fits 记一笔 may not fit "Record".
// It asserts nothing about how anything looks. An overflow is an error
// Flutter raises while laying out, so the walk only has to get every screen
// laid out — every row of it, which for a lazy list means scrolled to.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'month.dart';
import 'rust_init.dart';
import 'scroll.dart';

/// The narrowest phone, in dp.
const narrow = Size(360, 640);

/// Overflows raised while the walk runs, each with the screen it was on.
///
/// Flutter reports an overflow through `FlutterError.onError` and goes on
/// laying out, so letting the binding take it would report the first and
/// leave the rest for one run each. Anything that is not an overflow still
/// goes to the binding, and fails the test the ordinary way.
class Overflows {
  /// In the order met, once each.
  final found = <String>{};

  /// Where the walk is, for the report.
  String at = '';

  FlutterExceptionHandler? _binding;

  void listen() {
    _binding = FlutterError.onError;
    FlutterError.onError = (details) {
      final what = details.exceptionAsString();
      if (!what.contains(' overflowed by ')) return _binding?.call(details);
      // the widget the inspector blames, where the source has it
      final src = RegExp(
        r'flutter_app/(lib/[\w/]+\.dart:\d+)',
      ).firstMatch(details.toString())?.group(1);
      found.add('$at: ${what.split('\n').first}${src == null ? '' : ' $src'}');
    };
  }

  void stop() => FlutterError.onError = _binding;
}

/// Scroll the screen to its end a screenful at a time. A row that is never
/// built is never laid out, and a row that is never laid out cannot overflow.
Future<void> walkDown(WidgetTester tester) async {
  for (var i = 0; i < 40; i++) {
    final list = pageList(tester);
    if (list == null) return;
    final at = tester.state<ScrollableState>(list).position;
    if (at.pixels >= at.maxScrollExtent - 1) return;
    await tester.drag(list, const Offset(0, -420));
    await tester.pumpAndSettle();
  }
}

/// And back, so the next step finds what it expects at the top.
Future<void> walkUp(WidgetTester tester) async {
  final list = pageList(tester);
  if (list == null) return;
  await tester.drag(list, const Offset(0, 6000));
  await tester.pumpAndSettle();
}

/// Scroll the screen down from its top until [target] is out in the open.
///
/// From the top, because a lazy list has not built what is above where it was
/// left. And the list is pinned to its element first: [pageList] picks by what
/// a finger can reach, and a scroll changes that, so a finder that asked again
/// half way down could come back with nothing.
Future<void> reach(WidgetTester tester, Finder target) async {
  await walkUp(tester);
  final list = pageList(tester)!.evaluate().single;
  await scrollTo(
    tester,
    target,
    scrollable: find.byElementPredicate((e) => e == list),
  );
}

/// The phone's keyboard: about 300dp of a 640dp phone. Faked rather than
/// summoned, because whether an emulator puts its own up depends on how it
/// was started, and a walk that passed because none came up has not walked
/// the case that overflows. Every overflow a 640dp screen turned up had a
/// keyboard under it.
Future<void> keyboard(WidgetTester tester, {required bool up}) async {
  tester.view.viewInsets = up
      ? const FakeViewPadding(bottom: 300 * 3)
      : FakeViewPadding.zero;
  await tester.pumpAndSettle();
}

/// Close the dialog or sheet on top, the way the back button would.
Future<void> dismiss(WidgetTester tester) async {
  await tester.state<NavigatorState>(find.byType(Navigator)).maybePop();
  await tester.pumpAndSettle();
}

/// [open] a dialog or a sheet, put the keyboard up under it, and close it.
Future<void> typedInto(
  WidgetTester tester,
  Overflows o,
  String at,
  Future<void> Function() open,
) async {
  o.at = at;
  await open();
  await tester.pumpAndSettle();
  expect(
    find.byWidgetPredicate((w) => w is Dialog || w is BottomSheet),
    findsOneWidget,
    reason: '$at opened nothing',
  );
  await keyboard(tester, up: true);
  await keyboard(tester, up: false);
  await dismiss(tester);
}

Future<void> tap(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Future<void> tab(WidgetTester tester, String label) async {
  await tester.tap(find.byKey(Key('tab-$label')));
  await tester.pumpAndSettle();
}

Finder get hubList => find.descendant(
  of: find.byKey(const Key('me-list')),
  matching: find.byType(Scrollable),
);

/// A row on 我的, wherever the hub was left scrolled.
Future<void> hub(WidgetTester tester, String id) async {
  // the list is lazy: look down from the top, so either half is found
  await tester.drag(hubList, const Offset(0, 6000));
  await tester.pumpAndSettle();
  await scrollAndTap(tester, find.byKey(Key('me-$id')), scrollable: hubList);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);

  for (final lang in ['zh', 'en']) {
    final zh = lang == 'zh';

    /// Lay the app out at [narrow] in [lang] with the month in it, run
    /// [walk], and fail with every overflow it met.
    void at360(
      String name,
      Future<void> Function(WidgetTester, Overflows) walk,
    ) {
      testWidgets('$name ($lang)', (tester) async {
        tester.view.physicalSize = narrow * 3;
        tester.view.devicePixelRatio = 3;
        // no keyboard but the walk's own
        tester.view.viewInsets = FakeViewPadding.zero;
        addTearDown(tester.view.reset);
        store.reset();
        store.setLanguage(lang: lang);
        seed();

        final o = Overflows()..listen();
        try {
          await tester.pumpWidget(const App());
          await tester.pumpAndSettle();
          await walk(tester, o);
        } finally {
          o.stop();
        }
        expect(o.found, isEmpty, reason: o.found.join('\n'));
      });
    }

    at360('明细', (tester, o) async {
      o.at = '明细';
      await walkDown(tester);
      await walkUp(tester);

      o.at = '明细 › 日历';
      await tap(tester, 'calendar-toggle');
      final today = DateTime.now();
      await tap(tester, 'cal-${today.year}-${today.month}-${today.day}');
      await walkDown(tester);
      await walkUp(tester);
      await tap(tester, 'calendar-toggle');

      o.at = '明细 › 搜索';
      await tap(tester, 'search-toggle');
      await tester.enterText(find.byKey(const Key('search-field')), '早餐');
      await keyboard(tester, up: true);
      await keyboard(tester, up: false);
      await tap(tester, 'search-toggle');

      o.at = '明细 › 选择';
      // By key: the head quotes the latest notes too, in smaller type. And
      // scrolled to, because on a 640dp screen the head is most of it.
      // tour-1 is 午饭 牛肉面, tour-3 咖啡, tour-0 早餐 豆浆油条 — month.dart.
      final lunch = find.byKey(const Key('row-tour-1'));
      await reach(tester, lunch);
      await tester.longPress(lunch);
      await tester.pumpAndSettle();
      await typedInto(tester, o, '明细 › 退款', () async {
        await tap(tester, 'batch-more');
        await tap(tester, 'action-refund');
      });
      if (find.byKey(const Key('select-close')).evaluate().isNotEmpty) {
        await reach(tester, find.byKey(const Key('row-tour-3')));
        await tap(tester, 'row-tour-3');
        await tap(tester, 'select-close');
      }

      o.at = '明细 › 删除';
      final breakfast = find.byKey(const Key('row-tour-0'));
      await reach(tester, breakfast);
      await tester.drag(breakfast, const Offset(-500, 0));
      await tester.pumpAndSettle();
      await tap(tester, 'entry-delete-ok');
      await tap(tester, 'deleted-undo');
    });

    at360('记一笔', (tester, o) async {
      o.at = '记一笔';
      await tap(tester, 'record-button');
      // A title squeezed to nothing is not an overflow — the bar ellipsizes
      // it away without a word — and this one was, on every phone, behind
      // four labelled actions. So it is asked for by width.
      final title = tester.renderObject<RenderParagraph>(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.text(zh ? '记一笔' : 'Record'),
        ),
      );
      expect(
        title.size.width,
        greaterThanOrEqualTo(title.getMaxIntrinsicWidth(double.infinity) - 1),
        reason: 'the title is squeezed out of the bar',
      );
      // as wide a number as anybody keeps
      for (final k in '1234567.89'.split('')) {
        await tester.tap(find.byKey(Key('key-$k')));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      for (final dir in ['inc', 'xfer', 'exp']) {
        o.at = '记一笔 › $dir';
        await tap(tester, 'dir-$dir');
      }

      await typedInto(tester, o, '记一笔 › 日期', () => tap(tester, 'date-chip'));

      // a note: the phone's keyboard over the sheet's own
      o.at = '记一笔 › 备注';
      await keyboard(tester, up: true);
      await keyboard(tester, up: false);

      await tap(tester, 'key-clear');
      await tap(tester, 'key-4');
      await tap(tester, 'key-2');
      await typedInto(tester, o, '记一笔 › 存模板', () => tap(tester, 'record-pin'));
      await dismiss(tester);
    });

    at360('统计', (tester, o) async {
      await tab(tester, zh ? '统计' : 'Stats');
      for (final io in ['exp', 'inc']) {
        o.at = '统计 › $io';
        await tap(tester, 'io-$io');
        await walkDown(tester);
        await walkUp(tester);
      }
      // each window labels its axis and its bars differently
      for (final p in ['day', 'week', 'halfyear', 'year']) {
        o.at = '统计 › $p';
        await tap(tester, 'period-$p');
        await walkDown(tester);
        await walkUp(tester);
      }
    });

    at360('资产', (tester, o) async {
      await tab(tester, zh ? '资产' : 'Assets');
      o.at = '资产';
      await walkDown(tester);
      await walkUp(tester);
      await typedInto(
        tester,
        o,
        '资产 › 添加资产',
        () => scrollAndTap(tester, find.byKey(const Key('add-asset'))),
      );
      await typedInto(
        tester,
        o,
        '资产 › 添加借贷',
        () => scrollAndTap(tester, find.byKey(const Key('add-loan'))),
      );
      await walkUp(tester);

      o.at = '资产 › 账户';
      await scrollAndTap(tester, find.byKey(const Key('manage-accounts')));
      await walkDown(tester);
      await walkUp(tester);
      await typedInto(tester, o, '资产 › 账户 › 新建', () async {
        await tap(tester, 'add-account');
        // a credit card is the longest form
        await tap(tester, 'kind-credit');
      });

      o.at = '资产 › 账户 › 信用卡';
      await scrollAndTap(tester, find.byKey(const Key('acct-credit-open')));
      await walkDown(tester);
      await goBack(tester);
      await goBack(tester);
    });

    at360('我的', (tester, o) async {
      await tab(tester, zh ? '我的' : 'Me');
      o.at = '我的';
      await walkDown(tester);

      // Pressed where it is when a finger can reach it — an action in the
      // bar is not in the list, and has no list to be scrolled by.
      Future<void> Function() open(String key) => () async {
        final it = find.byKey(Key(key));
        if (it.hitTestable().evaluate().isEmpty) await reach(tester, it);
        await tester.tap(it);
        await tester.pumpAndSettle();
      };

      /// What each screen asks to have typed into it.
      final forms = <String, List<(String, Future<void> Function())>>{
        'budget': [('上限', open('tier-monthly'))],
        'subs': [('新建', open('add-sub'))],
        'tags': [('新标签', open('add-tag')), ('新分类', open('add-cat-exp'))],
        'backup': [('口令', open('take-backup'))],
        'settings': [
          (
            'AI 密钥',
            () async {
              await open('ai-toggle')();
              await open('ai-key-edit')();
            },
          ),
        ],
      };

      for (final id in [
        'report',
        'reimburse',
        'budget',
        'subs',
        'templates',
        'currency',
        'tags',
        'capture',
        'import',
        'backup',
        'sync',
        'settings',
      ]) {
        o.at = '我的 › $id';
        await hub(tester, id);
        for (final (what, form)
            in forms[id] ?? const <(String, Future<void> Function())>[]) {
          await walkUp(tester);
          await typedInto(tester, o, '我的 › $id › $what', form);
        }
        o.at = '我的 › $id';
        await walkDown(tester);
        await goBack(tester);
      }
    });

    at360('一句话记账 · 问账本', (tester, o) async {
      await tab(tester, zh ? '我的' : 'Me');

      o.at = '一句话记账';
      await hub(tester, 'ai-entry');
      await tester.enterText(
        find.byKey(const Key('ai-text')),
        '午饭35 打车12，昨天超市买菜128.5',
      );
      await keyboard(tester, up: true);
      await keyboard(tester, up: false);
      await tap(tester, 'ai-read');
      await walkDown(tester);
      await goBack(tester);

      o.at = '问账本';
      await hub(tester, 'ask');
      await tap(tester, 'ask-suggest-1');
      await tester.enterText(find.byKey(const Key('ask-field')), '上个月餐饮花了多少');
      await keyboard(tester, up: true);
      await keyboard(tester, up: false);
      await tap(tester, 'ask-send');
      await walkDown(tester);
      await goBack(tester);
    });
  }
}
