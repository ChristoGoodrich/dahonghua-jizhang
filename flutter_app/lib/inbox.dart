// The capture inbox, as the platform sees it.
//
// Every decision is Rust's. `inbox.rs` classifies a batch, bounds the unparsed
// pile, and resolves a queued capture, and it is held to `inbox.ts` by a parity
// corpus. What is left here is the three things the core deliberately does not
// do: read the native queue, write the file, and acknowledge the queue.
//
// The order of those three is the design. The native queue is acknowledged
// ONLY after the results are durable, so a crash mid-drain replays instead of
// losing payments. That ordering cannot live in the core — the acknowledgement
// is a channel call — so it lives here, and a test watches it from inside the
// fake's `markConsumed`.
//
// The inbox has its own file rather than a place in the config blob. Raw
// notification text belongs to the phone it was captured on.

import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart'
    show MissingPluginException, PlatformException;
import 'package:path_provider/path_provider.dart';

import 'notif_capture.dart';
import 'src/rust/api/capture.dart' as capture;

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

/// The file, the channel, and the order between them.
class Inbox {
  Inbox({NotifCapture? native, this.dir})
      : _native = native ?? const NotifCapture();

  final NotifCapture _native;

  /// Where `inbox.json` lives. A test passes a temporary one; the app lets it
  /// resolve to its own storage on first use.
  Directory? dir;

  /// What is waiting for a tap, read from the core rather than mirrored here.
  /// A second copy of a list is a second thing that can be wrong.
  List<capture.PendingView> get pending => capture.inboxPending();

  List<capture.UnparsedView> get unparsed => capture.inboxUnparsed();

  Future<File> _file() async {
    final d = dir ??= await getApplicationDocumentsDirectory();
    return File('${d.path}/inbox.json');
  }

  Future<void> load() async {
    try {
      final f = await _file();
      if (!await f.exists()) {
        capture.resetInbox();
        return;
      }
      if (!capture.loadInbox(json: await f.readAsString())) {
        capture.resetInbox();
      }
    } on FileSystemException {
      // Nothing here is irreplaceable — every pending item can be recovered
      // from the wallet's own export, and an unparsed one was never going to
      // become an entry. Starting empty beats refusing to open.
      capture.resetInbox();
    }
  }

  Future<void> save() async =>
      (await _file()).writeAsString(capture.inboxBlob());

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

    final r = capture.drainCaptures(
      raws: raws.map((n) => n.toRust()).toList(),
      now: DateTime.now().millisecondsSinceEpoch,
    );
    await save();

    // Last, and only now. Acknowledging first would lose to any crash in
    // between; a capture handed over twice is recognised by the dedup, which
    // is what `src: notif` on the ledger rows is for.
    try {
      await _native.markConsumed(raws.map((n) => n.id).toList());
    } on PlatformException {
      // It comes back on the next drain, and is recognised then.
    }

    return DrainResult(posted: r.posted, queued: r.queued, unparsed: r.unparsed);
  }

  /// Accept a waiting payment: it becomes an entry and leaves the inbox.
  Future<bool> accept(capture.PendingView p) async {
    final ok = capture.confirmPending(
      id: p.id,
      now: DateTime.now().millisecondsSinceEpoch,
    );
    await save();
    return ok;
  }

  /// Discard a waiting payment without recording it.
  Future<void> reject(capture.PendingView p) async {
    capture.dismissPending(id: p.id);
    await save();
  }

  Future<void> clearUnparsed() async {
    capture.clearUnparsed();
    await save();
  }
}
