// 移除动画 — what the app does when the phone asks for less motion.
//
// Android's setting reaches Flutter as `accessibilityFeatures.disableAnimations`,
// and three things answer it: the glass goes solid (`core::glass::resolve_tier`
// reads it as a request for less transparency, so there is no backdrop blur
// and every wash is opaque), a new entry plants no flowers, and 统计's charts
// arrive drawn rather than drawing themselves in.
//
// Nothing else in the suite goes down this path. CI runs it with animations
// on, because that is the phone it is written for; the one run that had them
// off failed bridge_test's blur checks and burst_test's flowers, which is how
// it came out that this path had no test of its own. Each check here has its
// counterpart with motion on beside it, so a check that cannot fail shows.

import 'package:flutter/material.dart';
import 'package:flutter_app/accessibility.dart';
import 'package:flutter_app/charts.dart';
import 'package:flutter_app/glass.dart';
import 'package:flutter_app/liquid.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/petal_burst.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/stats_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';

/// The phone's 移除动画, as Flutter hears it.
void still(WidgetTester tester) => _motion(tester, off: true);

/// And the counterparts' motion, said rather than assumed: an emulator
/// started with its animations off — main's CI did that — would otherwise
/// turn every counterpart into a second copy of the check it is there to
/// prove can fail.
void moving(WidgetTester tester) => _motion(tester, off: false);

void _motion(WidgetTester tester, {required bool off}) =>
    _features(tester, FakeAccessibilityFeatures(disableAnimations: off));

void _features(WidgetTester tester, FakeAccessibilityFeatures f) {
  tester.platformDispatcher.accessibilityFeaturesTestValue = f;
  addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
}

/// The iPhone's Reduce Motion. iOS does not set `disableAnimations` for it —
/// Flutter's own documentation says so — so it is a separate flag.
void reduceMotion(WidgetTester tester) =>
    _features(tester, const FakeAccessibilityFeatures(reduceMotion: true));

/// The iPhone's Reduce Transparency, as its platform side reports it.
void clearGlass(WidgetTester tester, bool on) {
  reduceTransparency.value = on;
  addTearDown(() => reduceTransparency.value = false);
}

/// The lens's stretch along its travel: 1 is none.
double stretchOf(WidgetTester tester) => tester
    .widget<Transform>(
      find
          .descendant(
            of: find.byType(LiquidLens),
            matching: find.byType(Transform),
          )
          .last,
    )
    .transform
    .entry(0, 0);

Future<void> lensAt(WidgetTester tester, double velocity) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Center(
        child: LiquidLens(width: 80, height: 40, velocity: velocity),
      ),
    ),
  );
  await tester.pump();
}

/// Solid: no blur anywhere in the shell, and every wash opaque.
void expectSolid(WidgetTester tester) {
  expect(everywhere(BackdropFilter), findsNothing);
  final glass = everywhere(Glass).evaluate().toList();
  expect(glass, isNotEmpty);
  for (final g in glass) {
    expect(washOf(tester, g).a, 1.0, reason: '${g.widget}');
  }
}

/// Built, whether or not it is showing: the four tabs are all alive in an
/// `IndexedStack`, and a blur on a tab nobody is looking at is still a blur
/// the moment somebody does.
Finder everywhere(Type t) => find.byType(t, skipOffstage: false);

/// A `Glass`'s wash — the first `Container` it builds, the one its content
/// sits in.
Color washOf(WidgetTester tester, Element glass) {
  final wash = tester.widget<Container>(
    find
        .descendant(
          of: find.byElementPredicate((e) => e == glass),
          matching: find.byType(Container),
          skipOffstage: false,
        )
        .first,
  );
  return (wash.decoration! as BoxDecoration).color!;
}

double donutProgress(WidgetTester tester) =>
    (tester.widget<CustomPaint>(find.byKey(const Key('donut'))).painter!
            as DonutPainter)
        .progress;

Future<void> press(WidgetTester tester, String k) async {
  await tester.tap(find.byKey(Key('key-$k')));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the glass', () {
    testWidgets('goes solid: nothing blurs, and every wash is opaque', (
      tester,
    ) async {
      still(tester);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();

      expect(everywhere(BackdropFilter), findsNothing);
      final glass = everywhere(Glass).evaluate().toList();
      expect(glass, isNotEmpty);
      for (final g in glass) {
        expect(washOf(tester, g).a, 1.0, reason: '${g.widget}');
      }
    });

    testWidgets('a pushed screen\'s header is solid too', (tester) async {
      still(tester);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('tab-我的')));
      await tester.pumpAndSettle();
      await scrollAndTap(
        tester,
        find.byKey(const Key('me-settings')),
        scrollable: find.descendant(
          of: find.byKey(const Key('me-list')),
          matching: find.byType(Scrollable),
        ),
      );
      expect(find.byType(GlassScrim), findsWidgets);
      expect(everywhere(BackdropFilter), findsNothing);
    });

    /// The counterpart: the same shell with motion on is glass, so the two
    /// checks above are checks of something.
    testWidgets('with motion on, the same shell blurs and lets light through', (
      tester,
    ) async {
      moving(tester);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();

      expect(everywhere(BackdropFilter), findsWidgets);
      expect(
        everywhere(Glass).evaluate().any((g) => washOf(tester, g).a < 1.0),
        isTrue,
      );
    });
  });

  group('the flowers', () {
    /// The word stays: it is the part that says the entry landed. burst_test
    /// holds the flowers with motion on.
    testWidgets('a new entry plants none, and still says it landed', (
      tester,
    ) async {
      still(tester);
      final before = PetalBurst.planted;
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('record-button')));
      await tester.pumpAndSettle();
      await press(tester, '4');
      await press(tester, '2');
      // Looked for frame by frame rather than after settling: the word is up
      // for 1.6s of real time, and settling the shell after a save took
      // longer than that once on the emulator, so it had come and gone.
      await tester.tap(find.byKey(const Key('key-save')));
      var said = false;
      for (var i = 0; i < 100 && !said; i++) {
        await tester.pump(const Duration(milliseconds: 16));
        said = find.text('贴上一朵花').evaluate().isNotEmpty;
      }
      expect(said, isTrue, reason: 'the word is the part that stays');

      await tester.pumpAndSettle();
      expect(PetalBurst.planted, before);
      expect(find.byKey(const Key('petal-burst')), findsNothing);
      expect(store.liveEntries(), hasLength(1));
    });
  });

  group('统计', () {
    void lunch() {
      final now = DateTime.now().millisecondsSinceEpoch;
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'food', amt: 30, ts: now),
        id: 'lunch',
        now: now,
      );
    }

    /// One frame and no settling: what that frame draws is all a reader with
    /// motion off is going to see arrive.
    testWidgets('the charts arrive drawn', (tester) async {
      lunch();
      still(tester);
      await tester.pumpWidget(const MaterialApp(home: StatsScreen()));
      expect(donutProgress(tester), 1.0);
    });

    testWidgets('with motion on, they draw themselves in from nothing', (
      tester,
    ) async {
      lunch();
      moving(tester);
      await tester.pumpWidget(const MaterialApp(home: StatsScreen()));
      expect(donutProgress(tester), lessThan(1.0));
      await tester.pumpAndSettle();
      expect(donutProgress(tester), 1.0);
    });
  });

  /// The iPhone asks for these by name, and none of them reached the app:
  /// it answered only Android's 移除动画.
  group('on an iPhone', () {
    testWidgets('Reduce Motion: a new entry plants no flowers', (tester) async {
      reduceMotion(tester);
      final before = PetalBurst.planted;
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('record-button')));
      await tester.pumpAndSettle();
      await press(tester, '4');
      await tester.tap(find.byKey(const Key('key-save')));
      await tester.pumpAndSettle();
      expect(PetalBurst.planted, before);
      expect(store.liveEntries(), hasLength(1));
    });

    testWidgets('Reduce Motion: the charts arrive drawn', (tester) async {
      final now = DateTime.now().millisecondsSinceEpoch;
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'food', amt: 30, ts: now),
        id: 'lunch',
        now: now,
      );
      reduceMotion(tester);
      await tester.pumpWidget(const MaterialApp(home: StatsScreen()));
      expect(donutProgress(tester), 1.0);
    });

    /// Apple's Reduce Motion takes the elastic part out of its own glass.
    testWidgets('Reduce Motion: a thrown lens does not stretch', (
      tester,
    ) async {
      reduceMotion(tester);
      await lensAt(tester, 2000);
      expect(stretchOf(tester), 1.0);
    });

    testWidgets('with motion on, a thrown lens stretches', (tester) async {
      moving(tester);
      await lensAt(tester, 2000);
      expect(stretchOf(tester), greaterThan(1.0));
    });

    /// Reduce Motion is about movement; the material is Reduce
    /// Transparency's to change.
    testWidgets('Reduce Motion leaves the glass as glass', (tester) async {
      reduceMotion(tester);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      expect(everywhere(BackdropFilter), findsWidgets);
    });

    testWidgets('Reduce Transparency: the glass goes solid', (tester) async {
      moving(tester);
      clearGlass(tester, true);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      expectSolid(tester);
    });

    testWidgets('Reduce Transparency turned on while the app is open', (
      tester,
    ) async {
      moving(tester);
      clearGlass(tester, false);
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      expect(everywhere(BackdropFilter), findsWidgets);

      reduceTransparency.value = true;
      await tester.pumpAndSettle();
      expectSolid(tester);
    });

    testWidgets('Increase Contrast: the glass goes solid', (tester) async {
      _features(tester, const FakeAccessibilityFeatures(highContrast: true));
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      expectSolid(tester);
    });
  });
}
