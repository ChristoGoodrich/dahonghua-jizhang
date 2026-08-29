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
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

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
    for (final w in tester.widgetList<InkWell>(find.byType(InkWell))) {
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
  await tester.pageBack();
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
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
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
    testWidgets('is a route, and saving returns to what was underneath',
        (tester) async {
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

      // still on the sheet — saving a NEW entry clears for the next one rather
      // than leaving, which is what makes recording three things in a row work
      expect(find.byKey(const Key('flash')), findsOneWidget);
      expect(store.entryCount(), 1);

      // and going back lands on the list, with the row on it
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tab-明细')), findsOneWidget);
      expect(find.text('-42.00'), findsOneWidget);
    });

    testWidgets('editing a row opens the sheet on it and comes back',
        (tester) async {
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
      await tester.pageBack();
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

    testWidgets('reaches the subscriptions screen and comes back',
        (tester) async {
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
      expect(keys.last, 'me-settings',
          reason: 'the walk stopped before the bottom of the hub');

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
      await tester.pageBack();
      await tester.pumpAndSettle();

      // the net-worth screen was built before the entry existed, and has to
      // have re-read the store rather than kept its own copy
      await tapTab(tester, '资产');
      expect(textOf(tester, 'net-worth'), '￥-99.00');
    });
  });
}
