// Scrolling in a test, now that content runs under the header.
//
// `scrollUntilVisible` stops the moment its target is inside the viewport, and
// since `ScrimScaffold` extends the body behind the app bar the viewport now
// reaches the top of the screen. So "visible" has come to include "tucked
// under the title bar" — where the bar takes the tap and the widget never sees
// it. Four tests found this the hard way, with a `tap()` that refused because
// the offset it derived would not hit the widget it was aiming at.
//
// **That is not a bug in the bar.** A header is chrome, and chrome absorbs:
// the same tap fails the same way under a real finger, and it should — a row
// dissolving under the title is a row you scroll clear before pressing, in
// this app and in every other one on the phone. What it means is that a test
// driving the app has to scroll the way a person would, far enough that the
// thing it wants to press is actually out in the open.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pop the route under test.
///
/// `tester.pageBack` looks for an English `Back` tooltip and then a Cupertino
/// back button. That is right for a stock `MaterialApp` and wrong the moment
/// this one is told it speaks Chinese — the tooltip becomes 返回, and the
/// finder asserts "one back button expected" at a screen that has one.
Future<void> goBack(WidgetTester tester) async {
  final candidates = <Finder>[
    find.byTooltip('Back'),
    find.byTooltip('返回'),
    find.byType(BackButton),
    find.byIcon(Icons.arrow_back),
    find.byIcon(Icons.arrow_back_ios),
    find.byIcon(Icons.arrow_back_ios_new),
  ];
  for (final f in candidates) {
    if (f.evaluate().isNotEmpty) {
      await tester.tap(f.first);
      await tester.pumpAndSettle();
      return;
    }
  }
  fail('no back button on screen');
}

/// The screen's own vertical list: the largest one a finger can reach, which
/// leaves out the tabs and routes underneath and the chip rows across it.
Finder? pageList(WidgetTester tester) {
  final all = find
      .byWidgetPredicate(
        (w) =>
            w is Scrollable &&
            axisDirectionToAxis(w.axisDirection) == Axis.vertical,
      )
      .hitTestable();
  final n = all.evaluate().length;
  if (n == 0) return null;
  var best = 0;
  for (var i = 1; i < n; i++) {
    final a = tester.getSize(all.at(i));
    final b = tester.getSize(all.at(best));
    if (a.width * a.height > b.width * b.height) best = i;
  }
  return all.at(best);
}

/// Bring `target` into view *and* out from under the header, then settle.
///
/// The header's own rectangle is the boundary rather than a computed inset:
/// the app bar knows how tall it is, including the status bar it sits behind,
/// and a test that recomputed that would be a second implementation of it.
Future<void> scrollTo(
  WidgetTester tester,
  Finder target, {
  double delta = 300,
  Finder? scrollable,
}) async {
  await tester.scrollUntilVisible(target, delta, scrollable: scrollable);
  await tester.pumpAndSettle();

  // The target's OWN header, not the first app bar in the tree. All four tabs
  // stay alive in an `IndexedStack` and all four have an app bar now that
  // they share one large-title scaffold, so a bare `find.byType(AppBar)`
  // matches four and `getRect` refuses — or, worse, measures a tab nobody is
  // looking at.
  final screen = find.ancestor(of: target, matching: find.byType(Scaffold));
  if (screen.evaluate().isEmpty) return;
  final bar = find.descendant(of: screen.first, matching: find.byType(AppBar));
  if (bar.evaluate().isEmpty) return;

  final floor = tester.getRect(bar.first).bottom + 4;
  final top = tester.getRect(target).top;
  if (top >= floor) return;

  // Not another `scrollUntilVisible`: that one would stop immediately, the
  // target being in the viewport already. And not a drag, which this was: a
  // drag shorter than the touch slop barely moves a list, and iOS's bouncing
  // physics hold back a few points more before they move at all. On an
  // iPhone a 23-point drag moved the list four, and 资产's 管理 stayed under
  // the bar it was meant to clear. The position is moved by exactly what is
  // needed instead, the same on every phone.
  final list = find
      .ancestor(of: target, matching: find.byType(Scrollable))
      .first;
  final position = tester.state<ScrollableState>(list).position;
  position.jumpTo(
    (position.pixels - (floor - top)).clamp(
      position.minScrollExtent,
      position.maxScrollExtent,
    ),
  );
  await tester.pumpAndSettle();
}

/// Put the phone's keyboard away, as a tap outside the field would.
///
/// For a form whose choices sit under a field the test has just typed into.
/// A focused field keeps its dialog scrolled to its caret: with a keyboard up,
/// `ensureVisible` on a chip below it scrolled the dialog to its end and the
/// next frames pulled it back to the field (132, then 59), so the tap landed
/// on the dialog. A finger's scroll is not pulled back — but a person picking
/// from the chips usually puts the keyboard away first, and so does this. The
/// Android emulator in CI never raises a keyboard; the iPhone simulator does.
Future<void> putKeyboardAway(WidgetTester tester) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
}

/// [scrollTo], then press it.
Future<void> scrollAndTap(
  WidgetTester tester,
  Finder target, {
  double delta = 300,
  Finder? scrollable,
}) async {
  await scrollTo(tester, target, delta: delta, scrollable: scrollable);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

/// Frame by frame until [done], or fail saying [what] never happened.
///
/// For what is on the screen for only a few seconds of real time, which a
/// notice is: four seconds with 撤销 in it. On a device `pumpAndSettle` after
/// a route closes can take longer than that — the route's exit, the notice's
/// entrance, and the shell refreshing its tabs a frame at a time — and on
/// CI's emulator it did, so a test that settled first found the notice
/// already gone. Looked for as it comes up instead, the way burst_test and
/// motion_test look for theirs.
Future<void> pumpUntil(
  WidgetTester tester,
  bool Function() done,
  String what,
) async {
  for (var i = 0; i < 300; i++) {
    if (done()) return;
    await tester.pump(const Duration(milliseconds: 16));
  }
  fail('never: $what');
}
