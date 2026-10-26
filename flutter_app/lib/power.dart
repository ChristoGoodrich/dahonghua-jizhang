// 省电模式 — whether the phone is saving battery, as the glass needs to know.
//
// A backdrop blur is the most expensive thing this app draws. On a phone's GPU
// each one is a break in the render pass, and a tab has a bar, a lens and two
// scrims of six bands sharing a capture each. Battery saver is the user asking
// the phone to spend less, and the glass used to ignore it: it dropped its blur
// only for 移除动画, which is a different request from a different person.
//
// What the glass does about it is `core::glass::resolve_tier`'s. This file
// only carries the phone's answer to the widgets that ask.

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Whether the phone is in battery saver.
///
/// False until the platform says otherwise, and false where there is no
/// platform side to say — a host test, or a phone that never answers. Being
/// wrong in that direction costs a blur; being wrong the other way would take
/// the material away from everybody.
final powerSaving = ValueNotifier<bool>(false);

StreamSubscription<Object?>? _watching;

/// Start following the phone. Once, at launch; later calls do nothing.
///
/// One stream rather than a read and a stream: the Kotlin side sends the
/// current state first and then every change, so a change cannot land in the
/// gap between reading the value and starting to listen.
void watchPowerSaving() {
  _watching ??= const EventChannel('com.dahonghua/power')
      .receiveBroadcastStream()
      .listen(
        (saving) => powerSaving.value = saving == true,
        // No platform side: stays false, which is the answer above.
        onError: (Object _) {},
      );
}

/// The phone's answer, where the widgets below can depend on it.
///
/// An inherited widget rather than each surface listening to [powerSaving] on
/// its own: a change rebuilds the glass that asked and nothing else, the same
/// way a change of 移除动画 does through `MediaQuery`.
class PowerSaving extends InheritedWidget {
  const PowerSaving({super.key, required this.saving, required super.child});

  final bool saving;

  /// False when nothing above says — a screen pumped on its own in a test.
  static bool of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<PowerSaving>()?.saving ?? false;

  @override
  bool updateShouldNotify(PowerSaving old) => old.saving != saving;
}

/// [PowerSaving], following [powerSaving]. The app's root puts this above
/// everything, so every route sees it.
class FollowPowerSaving extends StatelessWidget {
  const FollowPowerSaving({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
    valueListenable: powerSaving,
    builder: (context, saving, child) =>
        PowerSaving(saving: saving, child: child!),
    child: child,
  );
}
