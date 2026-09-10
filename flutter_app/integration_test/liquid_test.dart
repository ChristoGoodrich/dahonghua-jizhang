// 液态玻璃 — the tab lens, on a device.
//
// The arithmetic has its own unit tests in `core::liquid`: area-conserving
// stretch, a shadow that trails rather than leads, a highlight that lags, and
// a flick that lands where it was heading. What these check is the seam — that
// a finger on the glass actually reaches it.
//
// The claim being tested is the one the old indicator could not make: **the
// lens has a position of its own.** A widget that derived its position from
// the selected tab can only teleport between four values, and no amount of
// easing makes a teleport into a push.

import 'package:flutter/material.dart';
import 'package:flutter_app/bottom_nav.dart';
import 'package:flutter_app/liquid.dart';
import 'package:flutter_app/src/rust/api/liquid.dart' as q;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

const labels = ['明细', '统计', '资产', '我的'];

/// The bar on its own, which is how it is drawn in the shell: in the
/// `bottomNavigationBar` slot with the body running behind it.
///
/// `tag` is not decoration. Pumping the same widget tree twice in one test
/// **reuses the element**, and reusing the element keeps `_TabRowState` —
/// including the lens's position. A test that showed the bar twice to compare
/// two gestures was starting the second one from wherever the first had left
/// the lens, which is exactly the comparison it was trying not to make. A
/// different key is a different element and therefore a fresh lens.
Future<List<int>> showBar(
  WidgetTester tester, {
  int active = 0,
  String tag = 'a',
}) async {
  final changes = <int>[];
  await tester.pumpWidget(
    MaterialApp(
      key: ValueKey(tag),
      home: StatefulBuilder(
        builder: (context, setState) => Scaffold(
          extendBody: true,
          body: const ColoredBox(color: Colors.white),
          bottomNavigationBar: BottomNav(
            active: active,
            labels: labels,
            onAdd: () {},
            onChange: (i) => setState(() {
              changes.add(i);
              active = i;
            }),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return changes;
}

Finder get bar => find.byKey(const Key('tab-bar'));

/// A slow drag: it moves the lens and lets go with nothing left over.
///
/// `tester.drag` sends one move, so the velocity tracker has a single sample
/// and reports zero — which is what a crawl is. Hand-rolling this with
/// `startGesture` and `moveBy` does NOT work: every event defaults to a
/// timestamp of zero, and even passing timestamps explicitly the recogniser
/// declined to call it a fling. `fling` and `drag` are the framework's own
/// timed gestures and they are what these two cases are.
Future<void> crawlBy(WidgetTester tester, double dx) async {
  await tester.drag(bar, Offset(dx, 0));
  await tester.pumpAndSettle();
}

/// The same distance, thrown.
Future<void> flingBy(WidgetTester tester, double dx, double speed) async {
  await tester.fling(bar, Offset(dx, 0), speed);
  await tester.pumpAndSettle();
}

double lensVelocity(WidgetTester tester) =>
    tester.widget<LiquidLens>(find.byType(LiquidLens)).velocity;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);

  group('the lens is an object', () {
    testWidgets('the bar draws one, and it is still at rest', (tester) async {
      await showBar(tester);
      expect(find.byType(LiquidLens), findsOneWidget);
      expect(
        lensVelocity(tester),
        0,
        reason: 'a resting lens must not stretch, trail or slide its highlight',
      );
    });

    /// The whole point. A drag moves the lens continuously and the selection
    /// follows it, rather than the selection changing and the lens catching up.
    testWidgets('a drag pushes it, and the tabs light up as it passes', (
      tester,
    ) async {
      final changes = await showBar(tester);
      final centre = tester.getCenter(bar);
      final g = await tester.startGesture(centre);

      // Past the touch slop first, then a tab's width at a time. 800 logical
      // pixels wide gives a 90dp tab; the constant is not asserted anywhere
      // because it is the layout's business, but the crossings are.
      await g.moveBy(const Offset(40, 0));
      await tester.pump(const Duration(milliseconds: 16));
      await g.moveBy(const Offset(90, 0));
      await tester.pump(const Duration(milliseconds: 16));

      expect(changes, isNotEmpty, reason: 'the drag never reached the lens');
      expect(changes.first, greaterThan(0));
      expect(
        lensVelocity(tester),
        isNot(0),
        reason: 'a lens being pushed is a lens with a velocity',
      );

      await g.up();
      await tester.pumpAndSettle();
      expect(lensVelocity(tester), 0, reason: 'and it comes to rest');
    });

    testWidgets('dragging back the other way takes the selection back', (
      tester,
    ) async {
      final changes = await showBar(tester, active: 3);
      final centre = tester.getCenter(bar);
      final g = await tester.startGesture(centre);
      await g.moveBy(const Offset(-40, 0));
      await tester.pump(const Duration(milliseconds: 16));
      await g.moveBy(const Offset(-180, 0));
      await tester.pump(const Duration(milliseconds: 16));
      await g.up();
      await tester.pumpAndSettle();

      expect(changes.last, lessThan(3));
    });

    /// Not the nearest tab — the tab it was heading for. A finger that lets go
    /// halfway across but still moving fast was going somewhere.
    testWidgets('a flick carries past where the finger let go', (tester) async {
      final crawl = await showBar(tester, tag: 'crawl');
      await crawlBy(tester, 100);

      final flick = await showBar(tester, tag: 'flick');
      await flingBy(tester, 100, 3000);

      expect(crawl, isNotEmpty);
      expect(flick, isNotEmpty);
      expect(
        flick.last,
        greaterThan(crawl.last),
        reason: 'the same distance thrown harder has to land further',
      );
    });

    /// Tapping still works, and the lens travels to it rather than appearing
    /// there — which is what the spring is for.
    testWidgets('a tap on a far tab still selects it', (tester) async {
      final changes = await showBar(tester);
      await tester.tap(find.byKey(const Key('tab-我的')));
      await tester.pumpAndSettle();
      expect(changes, [3]);
      expect(lensVelocity(tester), 0);
    });

    /// A vertical drag belongs to whatever is scrolling behind the bar.
    /// Claiming it would make a floating bar a wall across the bottom of every
    /// list.
    testWidgets('a vertical drag is not the bar business', (tester) async {
      final changes = await showBar(tester);
      await tester.drag(bar, const Offset(0, -120));
      await tester.pumpAndSettle();
      expect(changes, isEmpty);
    });
  });

  group('what the core decided', () {
    /// Restated here because it is the difference between a stretch that reads
    /// as momentum and one that reads as a scale animation, and it is the kind
    /// of thing a later edit "simplifies" away.
    testWidgets('the stretch keeps its area', (tester) async {
      for (final v in [-1800.0, -240.0, 240.0, 1800.0]) {
        final l = q.lens(isDark: false, velocity: v);
        expect(l.scaleX * l.scaleY, closeTo(1, 1e-9));
        expect(l.scaleX, greaterThan(1));
      }
    });

    testWidgets('the shadow goes the other way from the travel', (
      tester,
    ) async {
      expect(q.lens(isDark: false, velocity: 900).trail, lessThan(0));
      expect(q.lens(isDark: false, velocity: -900).trail, greaterThan(0));
      expect(q.lens(isDark: false, velocity: 0).trail, 0);
    });
  });
}
