// The native notification listener, as Dart sees it.
//
// This file is transport and nothing else. It carries the permission state, the
// capture toggle and the queue across a MethodChannel; what a notification
// MEANS is decided in Rust, where a 1,284-case parity corpus holds the rules to
// the shipping app's behaviour.
//
// Android only. There is no equivalent on iOS — a third-party app cannot read
// other apps' notifications — and rather than pretend, `supported` says so and
// the screen explains it.

import 'dart:io' show Platform;

import 'package:flutter/services.dart';

import 'src/rust/api/capture.dart' as capture;

/// One row out of the native queue, before anything has interpreted it.
class CapturedNotif {
  const CapturedNotif({
    required this.id,
    required this.pkg,
    this.title,
    this.text,
    this.bigText,
    required this.postedAt,
  });

  final String id;
  final String pkg;
  final String? title;
  final String? text;
  final String? bigText;
  final int postedAt;

  static CapturedNotif fromMap(Map<Object?, Object?> m) => CapturedNotif(
        id: m['id'] as String? ?? '',
        pkg: m['pkg'] as String? ?? '',
        title: m['title'] as String?,
        text: m['text'] as String?,
        bigText: m['bigText'] as String?,
        postedAt: (m['postedAt'] as num?)?.toInt() ?? 0,
      );

  capture.RawNotifView toRust() => capture.RawNotifView(
        id: id,
        pkg: pkg,
        title: title,
        text: text,
        bigText: bigText,
        postedAt: postedAt,
      );
}

/// The native side of auto-capture.
///
/// A class rather than top-level functions so a test can put a fake in its
/// place — the real one needs an Android service that a test does not have.
class NotifCapture {
  const NotifCapture();

  static const _channel = MethodChannel('com.dahonghua/notif');

  /// Whether this platform has a notification listener at all.
  bool get supported => Platform.isAndroid;

  /// Whether the user has granted notification access to this app.
  ///
  /// Asked every time rather than cached: access can be revoked in system
  /// settings at any moment and the app is never told. A drain that re-checks
  /// is how a silently revoked permission surfaces, instead of looking like a
  /// quiet week.
  Future<bool> isEnabled() async =>
      supported && (await _channel.invokeMethod<bool>('isEnabled') ?? false);

  /// Open the system screen where access is granted. There is no in-app dialog
  /// for this permission.
  Future<void> openSettings() => _channel.invokeMethod<void>('openSettings');

  /// Capture stays off until the user turns it on, even once access has been
  /// granted — permission and intent are separate decisions.
  Future<bool> isCapturing() async =>
      supported && (await _channel.invokeMethod<bool>('isCapturing') ?? false);

  Future<void> setCapturing(bool on) =>
      _channel.invokeMethod<void>('setCapturing', on);

  Future<int> pendingCount() async =>
      (await _channel.invokeMethod<int>('pendingCount')) ?? 0;

  Future<List<CapturedNotif>> getPending({int limit = 200}) async {
    final rows = await _channel.invokeMethod<List<Object?>>('getPending', limit);
    return (rows ?? [])
        .whereType<Map<Object?, Object?>>()
        .map(CapturedNotif.fromMap)
        .toList();
  }

  /// Acknowledge rows the app has taken responsibility for. Called only after
  /// the results are in the ledger, so a crash mid-drain replays.
  Future<void> markConsumed(List<String> ids) =>
      _channel.invokeMethod<void>('markConsumed', ids);

  Future<void> clearPending() => _channel.invokeMethod<void>('clearPending');

  Future<List<String>> watchedPackages() async =>
      (await _channel.invokeMethod<List<Object?>>('getWatchedPackages') ?? [])
          .whereType<String>()
          .toList();
}
