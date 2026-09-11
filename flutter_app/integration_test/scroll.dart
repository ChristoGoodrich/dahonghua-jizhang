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

/// Bring `target` into view *and* out from under the header, then settle.
///
/// The header's own rectangle is the boundary rather than a computed inset:
/// the app bar knows how tall it is, including the status bar it sits behind,
/// and a test that recomputed that would be a second implementation of it.
Future<void> scrollTo(
  WidgetTester tester,
  Finder target, {
  double delta = 300,
}) async {
  await tester.scrollUntilVisible(target, delta);
  await tester.pumpAndSettle();

  final bar = find.byType(AppBar);
  if (bar.evaluate().isEmpty) return;

  final floor = tester.getRect(bar).bottom + 4;
  final top = tester.getRect(target).top;
  if (top >= floor) return;

  // A drag rather than another `scrollUntilVisible`: that one would stop
  // immediately, the target being in the viewport already. Positive dy moves
  // the content down, which is the direction that pushes it clear.
  final scrollable = find
      .ancestor(of: target, matching: find.byType(Scrollable))
      .first;
  await tester.drag(scrollable, Offset(0, floor - top));
  await tester.pumpAndSettle();
}

/// [scrollTo], then press it.
Future<void> scrollAndTap(
  WidgetTester tester,
  Finder target, {
  double delta = 300,
}) async {
  await scrollTo(tester, target, delta: delta);
  await tester.tap(target);
  await tester.pumpAndSettle();
}
