// 辅助功能 — what the phone's settings ask of this app's motion and material.
//
// Android has one switch for both, 移除动画, and Flutter carries it in
// `MediaQuery` as `disableAnimations`. The app answered that and nothing else,
// and on an iPhone that is nothing at all:
//
// - **Reduce Motion** reaches Flutter only as
//   `accessibilityFeatures.reduceMotion`. Flutter's own documentation says
//   iOS does not set `disableAnimations`, so the flowers still burst, the
//   charts still drew themselves in and the lens still stretched for a
//   reader who had asked the phone to stop.
// - **Reduce Transparency** does not reach Flutter at all. The iPhone side
//   reports it (`NativeChannels.swift`), as the Android side reports battery
//   saver.
// - **Increase Contrast** is `MediaQuery.highContrast`. Apple's answer to it
//   is glass that is mostly opaque, which is this app's solid tier.
//
// So two questions, each asked in one place: [lessMotion] and
// [lessTransparency]. A surface that answers either for itself is the one
// that will be missed when a third setting arrives.

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Whether the iPhone has Reduce Transparency on. False until it says
/// otherwise, and on Android, which has no such setting and no channel.
final reduceTransparency = ValueNotifier<bool>(false);

StreamSubscription<Object?>? _watching;

/// Start following the iPhone's Reduce Transparency. Once, at launch.
///
/// The Swift side sends the current setting first and then every change, so
/// a change cannot land between a read and a listen.
void watchReduceTransparency() {
  _watching ??= const EventChannel('com.dahonghua/transparency')
      .receiveBroadcastStream()
      .listen(
        (on) => reduceTransparency.value = on == true,
        // No platform side, which is Android and a host test: stays false.
        onError: (Object _) {},
      );
}

/// The two settings `MediaQuery` does not carry, where widgets can depend on
/// them.
class PhoneAsks extends InheritedWidget {
  const PhoneAsks({
    super.key,
    required this.reduceMotion,
    required this.reduceTransparency,
    required super.child,
  });

  final bool reduceMotion;
  final bool reduceTransparency;

  static PhoneAsks? _of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<PhoneAsks>();

  @override
  bool updateShouldNotify(PhoneAsks old) =>
      old.reduceMotion != reduceMotion ||
      old.reduceTransparency != reduceTransparency;
}

/// [PhoneAsks], following the phone. The root puts this above everything, so
/// every route sees it.
class FollowPhoneAsks extends StatefulWidget {
  const FollowPhoneAsks({super.key, required this.child});

  final Widget child;

  @override
  State<FollowPhoneAsks> createState() => _FollowPhoneAsksState();
}

class _FollowPhoneAsksState extends State<FollowPhoneAsks>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Reduce Motion moved, or any of the others. `MediaQuery` rebuilds for
  /// the ones it carries and not for this one.
  @override
  void didChangeAccessibilityFeatures() => setState(() {});

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
    valueListenable: reduceTransparency,
    builder: (context, clear, child) => PhoneAsks(
      reduceMotion: _reduceMotionNow(),
      reduceTransparency: clear,
      child: child!,
    ),
    child: widget.child,
  );
}

bool _reduceMotionNow() => WidgetsBinding
    .instance
    .platformDispatcher
    .accessibilityFeatures
    .reduceMotion;

/// Whether to keep motion to what is needed: no flowers, charts that arrive
/// drawn, a lens that moves without stretching, a row that opens without
/// sliding. Android's 移除动画 or the iPhone's Reduce Motion.
///
/// Without [FollowPhoneAsks] above — a screen pumped on its own in a test —
/// the phone is asked directly, which is right at the moment of asking and
/// only misses a change made while the screen is up.
bool lessMotion(BuildContext context) =>
    (MediaQuery.maybeDisableAnimationsOf(context) ?? false) ||
    (PhoneAsks._of(context)?.reduceMotion ?? _reduceMotionNow());

/// [lessMotion] where there is no build to depend from: a state's
/// `initState`, which may not depend on an inherited widget. The phone's
/// answer at the moment of asking.
bool lessMotionNow() {
  final f = WidgetsBinding.instance.platformDispatcher.accessibilityFeatures;
  return f.disableAnimations || f.reduceMotion;
}

/// Whether the glass should be solid. Android's 移除动画 asked for this before
/// the iPhone did, and stays a request for it; the iPhone's Reduce
/// Transparency and Increase Contrast ask for it by name.
bool lessTransparency(BuildContext context) =>
    (MediaQuery.maybeDisableAnimationsOf(context) ?? false) ||
    (MediaQuery.maybeHighContrastOf(context) ?? false) ||
    (PhoneAsks._of(context)?.reduceTransparency ?? reduceTransparency.value);
