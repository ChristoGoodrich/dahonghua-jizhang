// 省电模式 — battery saver takes the blur away and leaves the glass.
//
// The glass dropped its blur only for 移除动画. Battery saver is the phone
// being asked to spend less, and a backdrop blur is the most expensive thing
// this app draws, so the tier the core resolves now listens to it too: wash,
// no blur. Checked on the surfaces themselves and on the whole shell, both
// ways round — a test that only ever saw battery saver on could pass for an
// app that never blurred at all.
//
// The phone's own switch cannot be thrown from here. What can be is the
// app's half: the value the Kotlin channel feeds, followed from the root.

import 'package:flutter/material.dart';
import 'package:flutter_app/glass.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/power.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

/// A surface and a scrim over something to blur, with battery saver as told.
Future<void> surfaces(WidgetTester tester, {required bool saving}) async {
  await tester.pumpWidget(
    PowerSaving(
      saving: saving,
      child: const MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              Positioned.fill(child: ColoredBox(color: Color(0xFF123456))),
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                height: 120,
                child: GlassScrim(key: Key('probe-scrim'), flipped: true),
              ),
              Center(
                child: Glass(
                  key: Key('probe-glass'),
                  child: SizedBox(width: 100, height: 100),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder blursIn(Key key) => find.descendant(
  of: find.byKey(key),
  matching: find.byType(BackdropFilter),
);

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() {
    store.reset();
    powerSaving.value = false;
  });
  tearDown(() => powerSaving.value = false);

  group('under battery saver', () {
    testWidgets('a surface keeps its wash and loses its blur', (tester) async {
      await surfaces(tester, saving: false);
      expect(blursIn(const Key('probe-glass')), findsOneWidget,
          reason: 'blurs when the phone is not saving');

      await surfaces(tester, saving: true);
      expect(blursIn(const Key('probe-glass')), findsNothing);
      // Still a material: the wash is what is left, not nothing.
      final wash = tester.widget<Container>(find.descendant(
        of: find.byKey(const Key('probe-glass')),
        matching: find.byType(Container),
      ).first);
      expect((wash.decoration! as BoxDecoration).color!.a, greaterThan(0));
    });

    testWidgets('a scrim drops its bands and keeps its fade', (tester) async {
      await surfaces(tester, saving: false);
      expect(blursIn(const Key('probe-scrim')), findsWidgets);

      await surfaces(tester, saving: true);
      expect(blursIn(const Key('probe-scrim')), findsNothing);
      expect(
        find.descendant(
          of: find.byKey(const Key('probe-scrim')),
          matching: find.byType(DecoratedBox),
        ),
        findsWidgets,
        reason: 'the wash still ramps the content into the chrome',
      );
    });

    testWidgets('the whole shell draws no backdrop blur', (tester) async {
      powerSaving.value = true;
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      expect(find.byType(BackdropFilter), findsNothing);
    });

    testWidgets('and follows the phone when it changes', (tester) async {
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      expect(find.byType(BackdropFilter), findsWidgets,
          reason: 'the bar, the lens and the scrims, before saving');

      powerSaving.value = true;
      await tester.pumpAndSettle();
      expect(find.byType(BackdropFilter), findsNothing);

      powerSaving.value = false;
      await tester.pumpAndSettle();
      expect(find.byType(BackdropFilter), findsWidgets,
          reason: 'and back again when the phone stops saving');
    });
  });
}
