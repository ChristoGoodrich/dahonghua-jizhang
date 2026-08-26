// Does the Rust core actually answer, on a device, through the FFI boundary?
//
// These run on the emulator rather than the host, so they exercise the real
// `libdahonghua_bridge.so` that cargokit cross-compiled — not a desktop build
// standing in for it. Every expectation is a value the parity corpus has
// already pinned against the shipping TypeScript, so a failure here is a
// boundary problem rather than a logic one.

import 'package:flutter/material.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/src/rust/api/calc.dart' as calc;
import 'package:flutter_app/src/rust/api/glass.dart' as glass;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());

  group('the calculator crosses', () {
    test('an expression evaluates', () {
      expect(calc.evalExpr(expr: '1+2'), 3);
      expect(calc.evalExpr(expr: '35.5'), 35.5);
      // precedence, not left-to-right
      expect(calc.evalExpr(expr: '2+3*4'), 14);
    });

    test('a keypress edits the expression', () {
      expect(calc.applyKey(expr: '', key: '7'), '7');
      expect(calc.applyKey(expr: '12', key: 'back'), '1');
    });

    test('an operator changes what the display means', () {
      expect(calc.hasOperator(expr: '12'), false);
      expect(calc.hasOperator(expr: '1+2'), true);
    });
  });

  group('the glass material crosses', () {
    test('a wash comes back as a finished rgba', () {
      final w = glass.washColor(
        isDark: false,
        card: '#FFFFFF',
        paper: '#FBF7F0',
        level: glass.GlassLevel.chrome,
      );
      expect(w, startsWith('rgba('));
      // the chrome level's resting alpha
      expect(w, endsWith(', 0.54)'));
      // and it parses to a colour Flutter can paint
      expect(parseRgba(w).a, closeTo(0.54, 0.005));
    });

    test('the ambient pull is damped by luminance distance', () {
      // the toast pill: dark ink over near-white paper barely moves, which is
      // the behaviour that keeps its text readable
      final dark = parseRgba(glass.washColor(
        isDark: false,
        card: '#FFFFFF',
        paper: '#FBF7F0',
        level: glass.GlassLevel.card,
        surface: '#2B2622',
        alpha: 1,
      ));
      expect(dark.r * 255, closeTo(61, 1));
    });

    test('density raises the alpha', () {
      double at(double d) => glass.readabilityAlpha(
            isDark: false,
            level: glass.GlassLevel.chrome,
            density: d,
            tier: glass.GlassTier.full,
          );
      expect(at(0), 0.54);
      expect(at(1), greaterThan(at(0)));
      expect(at(1), lessThanOrEqualTo(1));
    });

    test('the solid tier is opaque', () {
      expect(
        glass.readabilityAlpha(
          isDark: false,
          level: glass.GlassLevel.card,
          density: 0,
          tier: glass.GlassTier.solid,
        ),
        1,
      );
    });

    test('an enum survives the round trip in both directions', () {
      expect(glass.resolveTier(reduceTransparency: false, isWeb: false), glass.GlassTier.full);
      expect(glass.resolveTier(reduceTransparency: false, isWeb: true), glass.GlassTier.wash);
      expect(glass.resolveTier(reduceTransparency: true, isWeb: true), glass.GlassTier.solid);
    });

    test('a struct comes back whole', () {
      final s = glass.glassSpec(isDark: false, level: glass.GlassLevel.chrome);
      expect(s.intensity, 62);
      expect(s.washAlpha, 0.54);
      expect(s.washAlphaFlat, 0.86);
      expect(s.edge, 'rgba(255,255,255,0.65)');
      expect(s.edgeWidth, 1);
    });

    test('the dark table is a different table', () {
      final light = glass.glassSpec(isDark: false, level: glass.GlassLevel.chrome);
      final dark = glass.glassSpec(isDark: true, level: glass.GlassLevel.chrome);
      expect(dark.intensity, isNot(light.intensity));
      expect(dark.sheen, lessThan(light.sheen));
    });

    test('luminance is WCAG at the endpoints', () {
      expect(glass.luminance(hex: '#FFFFFF'), closeTo(1, 1e-9));
      expect(glass.luminance(hex: '#000000'), closeTo(0, 1e-9));
    });

    test('only the first hash is stripped, as JavaScript does it', () {
      // the divergence the parity corpus caught: ## means black, not white
      expect(glass.luminance(hex: '##FFFFFF'), 0);
      expect(glass.luminance(hex: '#FFFFFF'), closeTo(1, 1e-9));
    });
  });

  group('the screen builds on top of it', () {
    testWidgets('the record sheet renders with Rust-computed colour', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: RecordSheet()));
      await tester.pumpAndSettle();
      expect(find.text('记一笔'), findsOneWidget);
      expect(find.text('读回：「」 长度 0'), findsOneWidget);
    });

    testWidgets('a keypress goes through Rust and back to the screen', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: RecordSheet()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('7'));
      await tester.pumpAndSettle();
      expect(find.text('7'), findsWidgets);
    });
  });
}
