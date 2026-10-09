// The navigation shell on a device.
//
// Four tabs, a record button, and routes behind the hubs. The tests here are
// about the shape rather than any screen: that recording is a route and so
// returns you to what you were looking at, that a hub reaches what it lists,
// and that the tabs keep their own state instead of rebuilding from scratch.
//
// The shape is not a preference. A bottom bar runs out of room at about five
// slots and this app has twenty screens; the six-tab arrangement this replaced
// had already stopped being able to grow.

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';
import 'package:flutter_app/tap.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void add(String id, double amt, {String? note}) {
  final t = now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: 'food', amt: amt, note: note, ts: t),
    id: id,
    now: t,
  );
}

Future<void> shell(WidgetTester tester) async {
  await tester.pumpWidget(const App());
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(Key(key))).data!;

Future<void> tapTab(WidgetTester tester, String label) async {
  await tester.tap(find.byKey(Key('tab-$label')));
  await tester.pumpAndSettle();
}

/// Every row on the 我的 hub, found by scrolling the whole list.
///
/// Reading the built `InkWell`s was the first spelling and it was wrong in a
/// way that hid itself: a `ListView` does not build what is off screen, so the
/// walk silently stopped covering the hub the moment it grew past one
/// screenful. It went on passing, over fewer rows each time a screen was added.
Future<List<String>> meRowKeys(WidgetTester tester) async {
  final list = find.byKey(const Key('me-list'));
  final seen = <String>[];

  void collect() {
    // `Tap`, not `InkWell`: the hub rows moved onto the app's own press
    // feedback. Enumerating by widget type is what made this need touching —
    // but it is also what makes the test find rows it was never told about,
    // which is the property worth keeping.
    for (final w in tester.widgetList<Tap>(find.byType(Tap))) {
      final k = w.key;
      if (k is ValueKey<String> &&
          k.value.startsWith('me-') &&
          !seen.contains(k.value)) {
        seen.add(k.value);
      }
    }
  }

  collect();
  // Scroll to the end a screenful at a time, taking what each one brings into
  // being. `dragUntilVisible` cannot help here: the point is to find rows whose
  // keys are not known in advance.
  for (var i = 0; i < 20; i++) {
    final before = seen.length;
    await tester.drag(list, const Offset(0, -400));
    await tester.pumpAndSettle();
    collect();
    if (seen.length == before) break;
  }
  return seen;
}

/// Tap a hub row, scrolling it into view first.
///
/// A row below the fold is laid out but clipped, and tapping it lands on
/// whatever occupies those coordinates instead — for the bottom of this screen,
/// the tab bar. `ensureVisible` walks up to the row's own scrollable, which
/// matters because four tabs are alive in an `IndexedStack` and `Scrollable`
/// alone is ambiguous.
/// Come back from a pushed screen to the top of the hub.
///
/// Scrolling to reach a row is not undone by popping the route, so the first
/// group heading — which is how these tests recognise the hub — is no longer
/// built when the list is left part way down. The pop and the scroll belong
/// together, or the next assertion is about the wrong thing.
Future<void> backToHub(WidgetTester tester) async {
  await goBack(tester);
  await tester.pumpAndSettle();
  await tester.scrollUntilVisible(
    find.text('记账工具'),
    -300,
    scrollable: find.descendant(
      of: find.byKey(const Key('me-list')),
      matching: find.byType(Scrollable),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> tapMeRow(WidgetTester tester, String key) async {
  final f = find.byKey(Key(key));
  // A row far down the hub is not built while the top is showing — the list
  // is lazy, and it grew past what one screen's cache holds — so it is
  // scrolled to before it is centred.
  final list = find.descendant(
    of: find.byKey(const Key('me-list')),
    matching: find.byType(Scrollable),
  );
  // above the screen or below it, whichever it is
  for (final step in const [-200.0, 200.0]) {
    if (f.evaluate().isNotEmpty) break;
    try {
      await tester.scrollUntilVisible(
        f,
        step,
        scrollable: list,
        maxScrolls: 20,
      );
    } on StateError {
      // not that way
    }
  }
  // Centred, not merely revealed. `tester.ensureVisible` scrolls the minimum
  // needed to bring a row inside the viewport — and since the bar started
  // floating, the viewport runs BEHIND it, so "inside" can mean "under the
  // bar" and the tap lands on the bar instead. A user hits this too and
  // scrolls a little further; the test has to do the same thing.
  await Scrollable.ensureVisible(tester.element(f), alignment: 0.5);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the bar', () {
    testWidgets('has four tabs and a record button', (tester) async {
      await shell(tester);
      for (final label in ['明细', '统计', '资产', '我的']) {
        expect(find.byKey(Key('tab-$label')), findsOneWidget);
      }
      expect(find.byKey(const Key('record-button')), findsOneWidget);
    });

    testWidgets('moves between the tabs', (tester) async {
      add('e1', 35.5, note: '午饭');
      await shell(tester);
      expect(find.text('午饭'), findsOneWidget);

      await tapTab(tester, '资产');
      expect(find.byKey(const Key('net-worth')), findsOneWidget);

      await tapTab(tester, '我的');
      expect(find.text('记账工具'), findsOneWidget);

      await tapTab(tester, '明细');
      expect(find.text('午饭'), findsOneWidget);
    });
  });

  group('recording', () {
    testWidgets('is a route, and saving returns to what was underneath', (
      tester,
    ) async {
      await shell(tester);
      await tester.tap(find.byKey(const Key('record-button')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('key-save')), findsOneWidget);

      for (final k in ['4', '2']) {
        await tester.tap(find.byKey(Key('key-$k')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      // 保存 closes — the form going away is the clear. Going back lands on
      // the list, with the row on it.
      expect(find.byKey(const Key('flash')), findsNothing);
      expect(store.entryCount(), 1);
      expect(find.byKey(const Key('tab-明细')), findsOneWidget);
      expect(find.text('-42.00'), findsOneWidget);
    });

    testWidgets('editing a row opens the sheet on it and comes back', (
      tester,
    ) async {
      add('e1', 35.5, note: '午饭');
      await shell(tester);

      await tester.tap(find.text('午饭'));
      await tester.pumpAndSettle();
      // the sheet opened on the entry, with its amount in the panel
      expect(find.byKey(const Key('amount-expr')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('amount-expr'))).data,
        '35.5',
      );

      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      expect(store.entryCount(), 1); // edited in place, not written twice
      expect(find.byKey(const Key('tab-明细')), findsOneWidget);
    });
  });

  group('the 我的 hub', () {
    testWidgets('reaches the budget screen and comes back', (tester) async {
      await shell(tester);
      await tapTab(tester, '我的');

      await tapMeRow(tester, 'me-budget');
      expect(find.text('预算'), findsWidgets);

      await backToHub(tester);
      expect(find.text('记账工具'), findsOneWidget);
    });

    testWidgets('reaches the subscriptions screen and comes back', (
      tester,
    ) async {
      await shell(tester);
      await tapTab(tester, '我的');

      await tapMeRow(tester, 'me-subs');
      expect(find.byKey(const Key('add-sub')), findsOneWidget);

      await backToHub(tester);
      expect(find.text('记账工具'), findsOneWidget);
    });

    testWidgets('lists nothing that goes nowhere', (tester) async {
      // A hub that lists screens which do not exist teaches the reader to stop
      // trusting it. The check is that EVERY row reaches something and comes
      // back — not a count of rows, which was the first spelling and which
      // broke the moment the hub grew by two. A test that has to be edited to
      // add a screen is a test that will eventually be edited without being
      // read.
      await shell(tester);
      await tapTab(tester, '我的');

      final keys = await meRowKeys(tester);
      expect(keys, isNotEmpty);
      // One anchor rather than a count: the walk has to reach the LAST row, or
      // it is back to covering whatever fits on a screen. A count would have to
      // be edited to add a screen, which is the thing this test avoids.
      expect(
        keys.last,
        'me-settings',
        reason: 'the walk stopped before the bottom of the hub',
      );

      for (final k in keys) {
        await tapMeRow(tester, k);
        // something was pushed — the hub is no longer the top route
        expect(find.text('记账工具'), findsNothing, reason: '$k went nowhere');
        await backToHub(tester);
        expect(find.text('记账工具'), findsOneWidget);
      }
    });
  });

  group('what a tab keeps', () {
    testWidgets('a change on one tab shows on another', (tester) async {
      await shell(tester);
      await tester.tap(find.byKey(const Key('record-button')));
      await tester.pumpAndSettle();
      for (final k in ['9', '9']) {
        await tester.tap(find.byKey(Key('key-$k')));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();

      // the net-worth screen was built before the entry existed, and has to
      // have re-read the store rather than kept its own copy
      await tapTab(tester, '资产');
      expect(textOf(tester, 'net-worth'), '￥-99.00');
    });

    /// 撤销 in the shell, not on a list shown alone. The delete tells the
    /// shell, the shell recreates the list, and the notice's 撤销 belonged
    /// to the list that was gone: it put the row back and then called
    /// setState on a disposed state, every time. The tests of the list on
    /// its own could not see it, because nothing recreated that list.
    testWidgets('撤销 after a delete works where the list is recreated', (
      tester,
    ) async {
      add('e1', 35.5, note: '午饭');
      await shell(tester);
      await tester.drag(find.byKey(const Key('row-e1')), const Offset(-500, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('entry-delete-ok')));
      await tester.pumpAndSettle();
      expect(store.liveEntries(), isEmpty);

      await tester.tap(find.byKey(const Key('deleted-undo')));
      await tester.pumpAndSettle();
      expect(store.liveEntries(), hasLength(1));
      expect(find.text('午饭'), findsOneWidget, reason: 'and the list shows it');
    });
  });

  group('the four tabs have one header', () {
    /// The title, told apart from the tab bar's label of the same word by its
    /// size.
    Finder title(String text) => find.byWidgetPredicate(
      (w) => w is Text && w.data == text && w.style?.fontSize == 26,
    );

    /// They used to disagree: 明细 and 统计 titled themselves in a 20px app
    /// bar, 资产 and 我的 with a 26px title inside the list. Then all four had
    /// a large title under a bar of actions, a row spent on a word. The rule
    /// now is the title and the actions on one row, the same row on every tab.
    testWidgets('every tab puts its title on the row of its actions', (
      tester,
    ) async {
      await shell(tester);
      final rows = <String, double>{};
      for (final (tab, heading) in [
        ('明细', '大红花记账'),
        ('统计', '统计'),
        ('资产', '资产'),
        ('我的', '我的'),
      ]) {
        await tapTab(tester, tab);
        final f = title(heading);
        expect(f, findsOneWidget, reason: '$tab has a title');
        final bar = find.ancestor(of: f, matching: find.byType(AppBar));
        expect(bar, findsOneWidget, reason: '$tab: the title is in the bar');
        rows[tab] = tester.getCenter(f).dy;
      }
      final first = rows.values.first;
      for (final e in rows.entries) {
        expect(e.value, closeTo(first, 0.5), reason: '${e.key}: $rows');
      }

      // 明细's three buttons are on that row too
      await tapTab(tester, '明细');
      final y = tester.getCenter(title('大红花记账')).dy;
      for (final k in ['select-toggle', 'calendar-toggle', 'search-toggle']) {
        final b = find.byKey(Key(k));
        expect(b, findsOneWidget, reason: k);
        expect(
          tester.getCenter(b).dy,
          closeTo(y, 2),
          reason: '$k is beside it',
        );
      }
    });

    /// Nothing scrolls away, so nothing has to be picked back up: the title
    /// is where it was, once.
    testWidgets('the title stays put as the list scrolls', (tester) async {
      await shell(tester);
      await tapTab(tester, '我的');
      final at = tester.getCenter(title('我的'));

      await tester.drag(
        find.descendant(
          of: find.byKey(const Key('me-list')),
          matching: find.byType(Scrollable),
        ),
        const Offset(0, -200),
      );
      await tester.pumpAndSettle();
      expect(title('我的'), findsOneWidget);
      expect(tester.getCenter(title('我的')), at);
    });
  });
}
