// 快捷指令 — what the iPhone's Shortcuts asked for, into the ledger.
//
// iOS lets no app read another's notifications, so Android's 自动记账 has no
// iPhone side. What iOS has is Shortcuts — Siri, the Action button, Spotlight,
// and the Wallet automation that runs after an Apple Pay payment — and each of
// those runs one of this app's App Intents (`ShortcutIntents.swift`). An
// intent may run with the app closed, where no Dart is running, so it only
// writes the request down in a queue the Swift side keeps.
//
// This file reads that queue, the same way `inbox.dart` reads Android's: what
// a request means is the core's (`core::shortcut`), and what is left here is
// the order. The time goes on each entry here, because composing an instant
// is the timezone's job; the rows are written, the ledger is saved, and only
// then is the queue told to forget them. A crash before that hands the same
// requests over again, and the core recognises them by their ids.

import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/services.dart';

import 'ledger_days.dart';
import 'src/rust/api/shortcut.dart' as sc;

/// One request as the iPhone wrote it down.
class ShortcutRequest {
  const ShortcutRequest({
    required this.id,
    required this.at,
    this.sentence,
    this.amount,
    this.merchant,
  });

  final String id;

  /// When the shortcut ran, in ms since the epoch: the moment of a payment,
  /// and the day 昨天 in a sentence counts from.
  final int at;
  final String? sentence;
  final double? amount;
  final String? merchant;

  static ShortcutRequest fromMap(Map<Object?, Object?> m) => ShortcutRequest(
    id: m['id'] as String? ?? '',
    at: (m['at'] as num?)?.toInt() ?? 0,
    sentence: m['sentence'] as String?,
    amount: (m['amount'] as num?)?.toDouble(),
    merchant: m['merchant'] as String?,
  );
}

/// The Swift side's queue. A class so a test can put a fake in its place.
class ShortcutQueue {
  const ShortcutQueue();

  static const _channel = MethodChannel('com.dahonghua/shortcuts');

  /// Whether this phone has Shortcuts to run the app's intents. A channel
  /// call, so it asks `Platform`: the queue is the iPhone's real one.
  bool get supported => Platform.isIOS;

  Future<List<ShortcutRequest>> pending() async {
    final rows = await _channel.invokeListMethod<Object?>('pending') ?? [];
    return [
      for (final r in rows)
        if (r is Map<Object?, Object?>) ShortcutRequest.fromMap(r),
    ];
  }

  /// Forget these requests. Only after their entries are on disk.
  Future<void> consume(List<String> ids) =>
      _channel.invokeMethod<void>('consume', ids);

  /// The Shortcuts app, where an automation is made.
  Future<void> openShortcuts() => _channel.invokeMethod<void>('openShortcuts');

  /// Call [onQueued] when an intent wrote a request down while the app was
  /// open — Siri asked over it, or a payment was made with it showing.
  void listen(void Function() onQueued) {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'queued') onQueued();
    });
  }
}

/// Noon of a `y-m-d` day, local: the middle of the day, where no change of
/// zone moves it to another, as 补记这天 and 一句话记账 record a day.
int _noonOf(String day) {
  final p = day.split('-').map(int.parse).toList();
  return DateTime(p[0], p[1], p[2], 12).millisecondsSinceEpoch;
}

/// Read the queue into the ledger. Returns the ids of the entries written,
/// for 撤销.
///
/// [persist] saves the ledger; the queue is acknowledged after it. Every
/// request read is acknowledged, the ones that asked for nothing or were
/// already recorded too, or they would be read again on every launch.
Future<List<String>> drainShortcuts(
  ShortcutQueue queue, {
  required Future<void> Function() persist,
  DateTime Function() clock = DateTime.now,
}) async {
  if (!queue.supported) return const [];
  final List<ShortcutRequest> rows;
  try {
    rows = await queue.pending();
  } on PlatformException {
    return const [];
  } on MissingPluginException {
    return const [];
  }
  if (rows.isEmpty) return const [];

  final at = {for (final r in rows) r.id: r.at};
  final drafts = sc.shortcutDrafts(
    requests: [
      for (final r in rows)
        sc.ShortcutRequestView(
          id: r.id,
          sentence: r.sentence,
          amount: r.amount,
          merchant: r.merchant,
          today: dayKey(DateTime.fromMillisecondsSinceEpoch(r.at)),
        ),
    ],
  );
  final entries = [
    for (final d in drafts)
      sc.ShortcutEntryView(
        id: d.id,
        io: d.io,
        cat: d.cat,
        amt: d.amt,
        note: d.note,
        // a day the words named, unless it is the day the shortcut ran
        ts:
            d.day == null ||
                d.day ==
                    dayKey(
                      DateTime.fromMillisecondsSinceEpoch(at[d.requestId]!),
                    )
            ? at[d.requestId]!
            : _noonOf(d.day!),
        captured: d.captured,
      ),
  ];
  final landed = entries.isEmpty
      ? const <String>[]
      : sc.postShortcutEntries(
          entries: entries,
          now: clock().millisecondsSinceEpoch,
        );
  if (landed.isNotEmpty) await persist();

  try {
    await queue.consume([for (final r in rows) r.id]);
  } on PlatformException {
    // They come back on the next drain, and are recognised then.
  }
  return landed;
}
