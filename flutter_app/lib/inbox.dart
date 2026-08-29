// The capture inbox — drains the native queue into the ledger.
//
// Two lists live here, and neither is part of the store's config blob. Raw
// notification text is device-local by nature; it belongs in its own file, not
// in something a backup carries to another phone.
//
//   pending   parsed payments that were not confident enough to post on their
//             own, waiting for one tap
//   unparsed  captures from a watched app that no rule understood, kept so the
//             real strings on a real phone can be read — there is no way to
//             write rules for text nobody has seen
//
// The decisions are all Rust's: `planDrain` says what posts, what waits and
// what nothing understood. This file is the order of operations around it, and
// the order is the part that matters — the native queue is acknowledged only
// after the results are in the ledger, so a crash mid-drain replays instead of
// losing payments.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart' show MissingPluginException, PlatformException;
// flutter_rust_bridge ships its own Int64List; the one in dart:typed_data is a
// different type with the same name, and the bridge will not take it.
import 'package:flutter_rust_bridge/flutter_rust_bridge.dart' show Int64List;
import 'package:path_provider/path_provider.dart';

import 'notif_capture.dart';
import 'src/rust/api/capture.dart' as capture;

/// A parsed payment waiting for one tap.
class PendingItem {
  const PendingItem({
    required this.id,
    required this.source,
    required this.raw,
    required this.io,
    required this.cat,
    required this.amt,
    required this.note,
    required this.ts,
  });

  final String id;
  final String source;

  /// What the notification actually said. A user asked to accept a guess
  /// deserves to see what it was a guess about.
  final String raw;

  final String io;
  final String cat;
  final double amt;
  final String note;
  final int ts;

  static PendingItem fromRust(capture.PendingView p) => PendingItem(
        id: p.id,
        source: p.source,
        raw: p.raw,
        io: p.draft.io,
        cat: p.draft.cat,
        amt: p.draft.amt,
        note: p.draft.note,
        ts: p.draft.ts,
      );

  Map<String, Object?> toJson() => {
        'id': id,
        'source': source,
        'raw': raw,
        'io': io,
        'cat': cat,
        'amt': amt,
        'note': note,
        'ts': ts,
      };

  static PendingItem? fromJson(Object? o) {
    if (o is! Map) return null;
    final amt = (o['amt'] as num?)?.toDouble();
    final ts = (o['ts'] as num?)?.toInt();
    if (amt == null || ts == null) return null;
    return PendingItem(
      id: o['id'] as String? ?? '',
      source: o['source'] as String? ?? '',
      raw: o['raw'] as String? ?? '',
      io: o['io'] as String? ?? 'exp',
      cat: o['cat'] as String? ?? 'other',
      amt: amt,
      note: o['note'] as String? ?? '',
      ts: ts,
    );
  }
}

/// A capture nothing understood.
class UnparsedItem {
  const UnparsedItem({
    required this.id,
    required this.pkg,
    required this.raw,
    required this.postedAt,
  });

  final String id;
  final String pkg;
  final String raw;
  final int postedAt;

  Map<String, Object?> toJson() =>
      {'id': id, 'pkg': pkg, 'raw': raw, 'postedAt': postedAt};

  static UnparsedItem? fromJson(Object? o) {
    if (o is! Map) return null;
    return UnparsedItem(
      id: o['id'] as String? ?? '',
      pkg: o['pkg'] as String? ?? '',
      raw: o['raw'] as String? ?? '',
      postedAt: (o['postedAt'] as num?)?.toInt() ?? 0,
    );
  }
}

/// What one drain did.
class DrainResult {
  const DrainResult({this.posted = 0, this.queued = 0, this.unparsed = 0});

  /// Added to the ledger outright.
  final int posted;

  /// Parsed, but waiting for a tap.
  final int queued;
  final int unparsed;

  bool get isEmpty => posted == 0 && queued == 0 && unparsed == 0;
}

/// The inbox and the drain around it.
class Inbox {
  Inbox({NotifCapture? native, this.dir}) : _native = native ?? const NotifCapture();

  final NotifCapture _native;

  /// Where `inbox.json` lives. A test passes a temporary one; the app lets it
  /// resolve to its own storage on first use.
  Directory? dir;

  /// A capture nobody understood is a clue, not a record. Bounded so an app
  /// left alone for months cannot grow this file without limit.
  static const maxUnparsed = 30;

  List<PendingItem> pending = const [];
  List<UnparsedItem> unparsed = const [];

  Future<File> _file() async {
    final d = dir ??= await getApplicationDocumentsDirectory();
    return File('${d.path}/inbox.json');
  }

  Future<void> load() async {
    try {
      final f = await _file();
      if (!await f.exists()) return;
      final o = jsonDecode(await f.readAsString());
      if (o is! Map) return;
      pending = (o['pending'] as List? ?? [])
          .map(PendingItem.fromJson)
          .whereType<PendingItem>()
          .toList();
      unparsed = (o['unparsed'] as List? ?? [])
          .map(UnparsedItem.fromJson)
          .whereType<UnparsedItem>()
          .toList();
    } catch (_) {
      // Nothing here is irreplaceable — a corrupt file starts empty rather
      // than stopping the app from opening.
      pending = const [];
      unparsed = const [];
    }
  }

  Future<void> save() async {
    final f = await _file();
    await f.writeAsString(jsonEncode({
      'pending': [for (final p in pending) p.toJson()],
      'unparsed': [for (final u in unparsed) u.toJson()],
    }));
  }

  /// Move everything the listener captured into the ledger or the inbox.
  ///
  /// Returns an empty result when capture is off or unavailable, which is the
  /// common case and not a failure.
  Future<DrainResult> drain() async {
    if (!_native.supported) return const DrainResult();
    if (!await _native.isEnabled()) return const DrainResult();
    if (!await _native.isCapturing()) return const DrainResult();

    final List<CapturedNotif> raws;
    try {
      raws = await _native.getPending();
    } on PlatformException {
      return const DrainResult(); // native side unavailable; try next time
    } on MissingPluginException {
      return const DrainResult();
    }
    if (raws.isEmpty) return const DrainResult();

    // What is already waiting counts as already represented: a follow-up push
    // for something not yet confirmed must not queue a second time.
    final plan = capture.planDrain(
      raws: raws.map((r) => r.toRust()).toList(),
      waitingIo: pending.map((p) => p.io).toList(),
      waitingAmt: pending.map((p) => p.amt).toList(),
      waitingTs: Int64List.fromList(pending.map((p) => p.ts).toList()),
    );

    final now = DateTime.now().millisecondsSinceEpoch;
    if (plan.posted.isNotEmpty) {
      capture.postCaptured(
        io: plan.posted.map((d) => d.io).toList(),
        cat: plan.posted.map((d) => d.cat).toList(),
        amt: plan.posted.map((d) => d.amt).toList(),
        note: plan.posted.map((d) => d.note).toList(),
        ts: Int64List.fromList(plan.posted.map((d) => d.ts).toList()),
        ids: [for (var i = 0; i < plan.posted.length; i++) 'n${now}i$i'],
        now: now,
      );
    }
    if (plan.pending.isNotEmpty) {
      pending = [...pending, ...plan.pending.map(PendingItem.fromRust)];
    }
    if (plan.unparsed.isNotEmpty) {
      final all = [
        ...unparsed,
        for (final u in plan.unparsed)
          UnparsedItem(
              id: u.id, pkg: u.pkg, raw: u.raw, postedAt: u.postedAt),
      ];
      unparsed = all.length <= maxUnparsed
          ? all
          : all.sublist(all.length - maxUnparsed);
    }
    await save();

    // Last, and only now: the queue is acknowledged after the results are
    // durable. Doing it first would lose payments to any crash in between.
    try {
      await _native.markConsumed(plan.consumed);
    } on PlatformException {
      // The rows will come back on the next drain, and the dedup will
      // recognise them — that is what `src: notif` on the ledger rows is for.
    }

    return DrainResult(
      posted: plan.posted.length,
      queued: plan.pending.length,
      unparsed: plan.unparsed.length,
    );
  }

  /// Accept a waiting payment: it becomes an entry and leaves the inbox.
  Future<void> accept(PendingItem p) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    capture.postCaptured(
      io: [p.io],
      cat: [p.cat],
      amt: [p.amt],
      note: [p.note],
      ts: Int64List.fromList([p.ts]),
      ids: ['n${now}a'],
      now: now,
    );
    pending = pending.where((x) => x.id != p.id).toList();
    await save();
  }

  /// Discard a waiting payment without recording it.
  Future<void> reject(PendingItem p) async {
    pending = pending.where((x) => x.id != p.id).toList();
    await save();
  }

  Future<void> clearUnparsed() async {
    unparsed = const [];
    await save();
  }
}
