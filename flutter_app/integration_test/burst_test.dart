// 贴上一朵花: the flowers out of the + button for a new entry, and the
// templates on 明细's head that record one in a single press.
//
// The shipping app rewarded each entry with a burst (`PetalBurst.tsx`) and put
// its templates above the rows (`TemplateChips.tsx`); the port did neither.
// The burst's shape is `core::burst`'s and is tested there; what is checked
// here is when it plays and when it does not.

import 'package:flutter/material.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/petal_burst.dart';
import 'package:flutter_app/src/rust/api/burst.dart' as burst;
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

Future<void> press(WidgetTester tester, String k) async {
  await tester.tap(find.byKey(Key('key-$k')));
  await tester.pumpAndSettle();
}

void coffee() => catalog.addTemplate(
  id: 'tpl-coffee',
  io: 'exp',
  cat: 'food',
  amt: 36,
  note: '咖啡',
  name: '咖啡',
);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the burst', () {
    testWidgets('is the same burst for the same seed', (tester) async {
      final a = burst.petalBurst(seed: 5);
      expect(a.petals, hasLength(12));
      // petal by petal: the generated view compares its list by identity
      expect(burst.petalBurst(seed: 5).petals, a.petals);
      expect(burst.petalBurst(seed: 6).petals, isNot(a.petals));
      final longest = a.petals
          .map((p) => p.delay + p.duration)
          .reduce((x, y) => x > y ? x : y);
      expect(a.length, longest);
    });

    /// A flower for a new entry, once the sheet has gone and the + button it
    /// comes out of can be seen — and gone again when it has landed.
    ///
    /// Counted rather than looked for mid-flight: the flight is real time on
    /// the device, and the rebuild after a save can outlast it, which made a
    /// "is it on screen now" check pass or fail by the frame.
    testWidgets('plays when a new entry is saved and the sheet closes', (
      tester,
    ) async {
      final before = PetalBurst.planted;
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('record-button')));
      await tester.pumpAndSettle();
      await press(tester, '4');
      await press(tester, '2');
      await press(tester, 'save');
      await tester.pageBack();
      await tester.pump();
      // At least once: in the frame after the pop the sheet's own Scaffold is
      // still on its way out, and the messenger shows the word on both.
      expect(find.text('贴上一朵花'), findsWidgets);

      await tester.pumpAndSettle();
      expect(PetalBurst.planted, before + 1);
      expect(
        find.byKey(const Key('petal-burst')),
        findsNothing,
        reason: 'it takes itself away once the last flower lands',
      );
    });

    testWidgets('does not play for a sheet closed without saving', (
      tester,
    ) async {
      final before = PetalBurst.planted;
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('record-button')));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(PetalBurst.planted, before);
      expect(find.text('贴上一朵花'), findsNothing);
    });

    /// An edit planted nothing.
    testWidgets('does not play for an edit', (tester) async {
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 20,
          note: '午饭',
          ts: now,
        ),
        id: 'lunch',
        now: now,
      );
      final before = PetalBurst.planted;
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.tap(find.text('午饭'));
      await tester.pumpAndSettle();
      await press(tester, 'save');
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(PetalBurst.planted, before);
    });
  });

  group('a template on the head', () {
    Future<void> show(WidgetTester tester, {VoidCallback? onLogged}) async {
      await tester.pumpWidget(
        MaterialApp(home: EntryListScreen(onLogged: onLogged)),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('records in one press, says what it recorded, and undoes', (
      tester,
    ) async {
      coffee();
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'trans', amt: 4, ts: now),
        id: 'metro',
        now: now,
      );
      var logged = false;
      await show(tester, onLogged: () => logged = true);

      await tester.tap(find.byKey(const Key('tpl-chip-tpl-coffee')));
      await tester.pumpAndSettle();
      final live = store.liveEntries();
      expect(live, hasLength(2));
      final made = live.firstWhere((e) => e.id != 'metro');
      expect((made.amt, made.cat, made.note), (36.0, 'food', '咖啡'));
      expect(logged, isTrue, reason: 'the shell plays the flowers');
      expect(find.byKey(const Key('template-logged')), findsOneWidget);

      await tester.tap(find.byKey(const Key('template-undo')));
      await tester.pumpAndSettle();
      expect(store.liveEntries().map((e) => e.id), ['metro']);
    });

    /// A first launch may already hold templates; one press is the quickest
    /// first entry there is, so the empty ledger shows them too.
    testWidgets('is there on an empty ledger', (tester) async {
      coffee();
      await show(tester);
      expect(find.text('还没有记账'), findsOneWidget);
      await tester.tap(find.byKey(const Key('tpl-chip-tpl-coffee')));
      await tester.pumpAndSettle();
      expect(store.liveEntries(), hasLength(1));
    });

    testWidgets('is not there without templates', (tester) async {
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'trans', amt: 4, ts: now),
        id: 'metro',
        now: now,
      );
      await show(tester);
      expect(find.byKey(const Key('home-templates')), findsNothing);
    });
  });
}
