// 锁屏 — the app behind the device's own authentication.
//
// Every rule about when to prompt and what an answer means is in the core's
// `lock` module. This file is the three things it cannot do: ask the device,
// watch the lifecycle, and draw a cover.
//
// The cover is drawn OVER the app rather than instead of it. Replacing the
// content would tear down the navigator and lose wherever the user was; a
// stack with an opaque layer on top keeps the app exactly where it was for
// when the gate opens.
//
// One rule worth naming here because the platform-side reflex is the opposite:
// an authentication that ERRORS leaves the gate shut. The device saying "I
// could not ask" is the moment a lock matters most, and some Android devices
// throw after repeated failures — treating that as "let them in" turns the
// lock into a formality.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';

import 'bloom.dart';
import 'src/rust/api/lock.dart' as lock;
import 'theme.dart';

/// What the device can do, and what it says when asked.
///
/// An interface so a test can answer for it: a real biometric prompt cannot be
/// driven from a test, and the part worth testing is what the app does with
/// each answer.
abstract class Authenticator {
  Future<bool> hasHardware();
  Future<bool> isEnrolled();

  /// True for a success, false for a refusal or a cancel. Throwing means the
  /// question could not be asked, which is a third thing.
  Future<bool> authenticate(String reason);

  Future<void> cancel();
}

class DeviceAuthenticator implements Authenticator {
  const DeviceAuthenticator();

  static final _auth = LocalAuthentication();

  @override
  Future<bool> hasHardware() => _auth.isDeviceSupported();

  @override
  Future<bool> isEnrolled() async =>
      await _auth.canCheckBiometrics || await _auth.isDeviceSupported();

  @override
  Future<bool> authenticate(String reason) => _auth.authenticate(
    localizedReason: reason,
    // The device passcode counts. Requiring biometrics would lock out a
    // user whose fingerprint sensor has stopped reading, which is a
    // support problem rather than a security gain.
    biometricOnly: false,
    // The prompt survives the app going to the background, which is what
    // the OS does to us while its own dialog is up.
    persistAcrossBackgrounding: true,
  );

  @override
  Future<void> cancel() => _auth.stopAuthentication();
}

class LockGate extends StatefulWidget {
  const LockGate({super.key, required this.child, this.zh = true, this.auth});

  final Widget child;
  final bool zh;

  /// Injected by tests.
  final Authenticator? auth;

  @override
  State<LockGate> createState() => _LockGateState();
}

class _LockGateState extends State<LockGate> with WidgetsBindingObserver {
  late final Authenticator _auth = widget.auth ?? const DeviceAuthenticator();

  bool _gated = lock.lockGated();
  String? _notice = lock.lockNotice();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _apply(lock.lockMounted());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        _apply(lock.lockResumed());
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        _apply(lock.lockBackgrounded());
      case AppLifecycleState.inactive:
        // Not a departure. This is what the system's own auth dialog looks
        // like from here, and the core needs the two told apart.
        _apply(lock.lockInactive());
    }
  }

  void _apply(List<lock.LockAction> actions) {
    for (final a in actions) {
      switch (a.kind) {
        case 'runAuth':
          unawaited(_run(a.attempt.toInt()));
        case 'cancelAuth':
          unawaited(_auth.cancel().catchError((_) {}));
        case 'unlock':
        case 'relock':
          break; // the state below is read back wholesale
        case 'notice':
          break;
      }
    }
    if (!mounted) return;
    setState(() {
      _gated = lock.lockGated();
      _notice = lock.lockNotice();
    });
  }

  /// Ask the device, and report every answer back with the attempt it belongs
  /// to. A stale answer is the core's to discard, not this file's.
  Future<void> _run(int attempt) async {
    try {
      final has = await _auth.hasHardware();
      final enrolled = await _auth.isEnrolled();
      final next = lock.lockCapability(
        attempt: BigInt.from(attempt),
        hasHardware: has,
        enrolled: enrolled,
      );
      if (!mounted) return;
      _apply(next);
      if (!has || !enrolled) return; // the core already opened the gate

      final ok = await _auth.authenticate(
        widget.zh ? '解锁大红花记账' : 'Unlock Red Blossom',
      );
      if (!mounted) return;
      _apply(
        lock.lockSettled(
          attempt: BigInt.from(attempt),
          outcome: ok ? 'success' : 'rejected',
        ),
      );
    } catch (_) {
      // Could not ask. NOT the same as a refusal, and not a reason to open.
      if (!mounted) return;
      _apply(
        lock.lockSettled(attempt: BigInt.from(attempt), outcome: 'errored'),
      );
    }
  }

  String _noticeText(String n, bool zh) => switch (n) {
    'failed' => zh ? '没通过,再试一次' : 'Not recognised — try again',
    _ => zh ? '现在没法验证' : 'Cannot verify right now',
  };

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return Stack(
      children: [
        widget.child,
        if (_gated)
          Positioned.fill(
            child: Container(
              key: const Key('lock-cover'),
              color: palette.paper,
              alignment: Alignment.center,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // The app's own mark, not 🌺. That emoji is somebody
                  // else's drawing on every phone that renders it, and it
                  // was not the flower on the launcher icon the user had
                  // just left. Same reason 明细's empty state uses `Bloom`.
                  const Bloom(size: 56),
                  const SizedBox(height: 16),
                  Text(
                    zh ? '大红花记账已锁定' : 'Red Blossom is locked',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: palette.ink,
                    ),
                  ),
                  if (_notice != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _noticeText(_notice!, zh),
                      key: const Key('lock-notice'),
                      style: TextStyle(fontSize: 13, color: palette.warnDeep),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    key: const Key('lock-unlock'),
                    onPressed: () => _apply(lock.lockUnlockPressed()),
                    child: Text(
                      _notice != null
                          ? (zh ? '重试' : 'Try again')
                          : (zh ? '解锁' : 'Unlock'),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
