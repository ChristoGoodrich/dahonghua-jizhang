// The segmented control's thumb, pushed by a finger.
//
// 记一笔's 支出/收入/转账 and 统计's windows slid when pressed and did nothing
// when dragged. Now the thumb is the tab bar's kind of object: it follows the
// finger, lights the segment it is over, and the choice is made when it is let
// go of — once, not once per segment it crossed.

import 'package:flutter/material.dart';
import 'package:flutter_app/segmented.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

const items = [('exp', '支出'), ('inc', '收入'), ('xfer', '转账')];

/// The control on its own, 300 wide so each segment is a round 100 less the
/// track's padding and border.
Future<List<String>> show(WidgetTester tester, {String value = 'exp'}) async {
  final changes = <String>[];
  var current = value;
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 300,
            child: StatefulBuilder(
              builder: (context, setState) => Segmented(
                items: items,
                value: current,
                keyPrefix: 'seg',
                onChanged: (v) => setState(() {
                  changes.add(v);
                  current = v;
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return changes;
}

Finder get track => find.byKey(const Key('seg-drag'));
Finder get thumb => find.byKey(const Key('seg-thumb'));

FontWeight weightOf(WidgetTester tester, String label) =>
    tester.widget<Text>(find.text(label)).style!.fontWeight!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);

  testWidgets('a tap still chooses', (tester) async {
    final changes = await show(tester);
    await tester.tap(find.byKey(const Key('seg-inc')));
    await tester.pumpAndSettle();
    expect(changes, ['inc']);
    expect(
      tester.getCenter(thumb).dx,
      closeTo(tester.getCenter(find.text('收入')).dx, 1),
    );
  });

  /// The thumb goes with the finger, the segment under it lights up, and
  /// nothing is chosen until the finger lifts.
  testWidgets('a drag carries the thumb and chooses on release', (
    tester,
  ) async {
    final changes = await show(tester);
    final start = tester.getCenter(thumb).dx;
    final g = await tester.startGesture(tester.getCenter(thumb));
    // past the slop, then most of two segments
    await g.moveBy(const Offset(30, 0));
    await tester.pump();
    await g.moveBy(const Offset(150, 0));
    await tester.pump();

    expect(tester.getCenter(thumb).dx, greaterThan(start + 100));
    expect(weightOf(tester, '转账'), FontWeight.w700, reason: 'lit under it');
    expect(weightOf(tester, '支出'), FontWeight.w500);
    expect(changes, isEmpty, reason: 'nothing is chosen mid-drag');

    await g.up();
    await tester.pumpAndSettle();
    expect(changes, ['xfer'], reason: 'once, not once per segment crossed');
    expect(
      tester.getCenter(thumb).dx,
      closeTo(tester.getCenter(find.text('转账')).dx, 1),
    );
  });

  testWidgets('a short drag that goes nowhere chooses nothing', (tester) async {
    final changes = await show(tester, value: 'inc');
    await tester.drag(track, const Offset(20, 0));
    await tester.pumpAndSettle();
    expect(changes, isEmpty);
    expect(
      tester.getCenter(thumb).dx,
      closeTo(tester.getCenter(find.text('收入')).dx, 1),
      reason: 'it springs back to where it was',
    );
  });

  /// A flick lands where it was heading, not on the segment it left from.
  testWidgets('a flick lands where it was heading', (tester) async {
    final changes = await show(tester);
    await tester.fling(track, const Offset(60, 0), 1500);
    await tester.pumpAndSettle();
    expect(changes, isNotEmpty);
    expect(changes.last, isNot('exp'));
  });

  testWidgets('it cannot be dragged off either end', (tester) async {
    final changes = await show(tester);
    await tester.drag(track, const Offset(-400, 0));
    await tester.pumpAndSettle();
    expect(changes, isEmpty);
    final left = tester.getTopLeft(track).dx;
    expect(tester.getTopLeft(thumb).dx, greaterThanOrEqualTo(left));
  });
}
