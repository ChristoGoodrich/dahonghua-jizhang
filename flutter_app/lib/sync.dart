// The sync loop, in Dart over the Rust engine.
//
// This file is the clearest test of whether the split held, because sync is the
// one subject that is *entirely* I/O. What is here: two timers, a status
// notifier, and a switch that turns an effect into a call. What is not here:
// any decision at all. Not the order things happen in, not what a failure
// means, not which rows are dirty, not which config sections win, not how long
// to back off. Every one of those is `dahonghua_core::engine`, pinned by a
// 2,600-script corpus against the shipping TypeScript.
//
// The transport is an interface rather than a Supabase client, for a reason
// worth stating plainly: **there is no Supabase project configured on this
// machine**, so a live client could not be exercised here at all. The shipping
// app's own tests fake it at the same boundary for the same reason. What that
// buys is that the loop — the risky part, with its timers and its lifecycle —
// is verifiable on a real device today, and the HTTP is a small separable piece
// that can be dropped in when there is a project to point it at.

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'src/rust/api/sync.dart' as rust;

/// What the platform must be able to do. Five verbs, no judgement.
abstract class SyncTransport {
  /// Every row for this user, as a JSON array. `null` when the read **failed**
  /// — which is not an empty table, and the engine treats them differently.
  Future<String?> pullEntries();

  /// The user's config blob. `ok` false is a failed read; a null body with
  /// `ok` true is an account that has no config yet.
  Future<({bool ok, String? json})> pullConfig();

  /// Upsert rows. Returns false on failure.
  Future<bool> pushEntries(String rowsJson);

  /// Upsert the config blob. Returns false on failure.
  Future<bool> pushConfig(String blobJson);

  /// Open a channel. `name` is `entries` or `config`; deliver messages by
  /// calling [SyncLoop.onRealtimeEntry] / [SyncLoop.onRealtimeConfig].
  Future<void> subscribe(String name);

  Future<void> unsubscribe(String name);
}

/// Where the section stamps live between launches.
///
/// Separate from the ledger and the config for the same reason the app's two
/// files are separate: they change on a different rhythm, and a write that
/// fails halfway should not be able to take the others with it.
abstract class StampStore {
  Future<String?> load();
  Future<void> save(String json);
}

/// Drives the engine: feeds it events, performs what it asks for.
class SyncLoop {
  SyncLoop({required this.transport, this.stamps});

  final SyncTransport transport;
  final StampStore? stamps;

  /// `off` | `syncing` | `synced` | `error`, for the UI to show.
  final status = ValueNotifier<String>('off');

  /// When the last upload succeeded, or null. The clock is the platform's.
  final lastSync = ValueNotifier<DateTime?>(null);

  Timer? _debounce;
  Timer? _retry;
  bool _running = false;

  /// Restore the stamps before any sign-in.
  ///
  /// They track local edits regardless of session, so an edit made offline and
  /// signed out still has to beat a stale cloud section afterwards. Loading
  /// them late would silently lose that.
  Future<void> restore() async {
    final json = await stamps?.load();
    if (json != null && json.isNotEmpty) rust.syncLoadStamps(json: json);
  }

  Future<void> signIn(String userId) => _run(rust.syncSignIn(userId: userId));

  Future<void> signOut() => _run(rust.syncSignOut());

  /// The user changed something. `sections` names the config sections touched;
  /// an entry-only edit passes none.
  ///
  /// Writes made to satisfy an `ApplyConfig` must NOT come through here — the
  /// bridge applies those itself, so there is nothing for a caller to get
  /// wrong. Reporting one would re-stamp the section as a local edit and push
  /// it straight back, which is two devices bouncing one blob forever.
  Future<void> localEdit({List<String> sections = const []}) => _run(
        rust.syncLocalEdit(
          sections: sections,
          now: DateTime.now().millisecondsSinceEpoch,
        ),
      );

  Future<void> retryNow() => _run(rust.syncRetryNow());

  Future<void> onRealtimeEntry(String json) =>
      _run(rust.syncRealtimeEntry(json: json));

  Future<void> onRealtimeConfig(String json) =>
      _run(rust.syncRealtimeConfig(json: json));

  void dispose() {
    _debounce?.cancel();
    _retry?.cancel();
    status.dispose();
    lastSync.dispose();
  }

  /// Perform a batch of effects, feeding each result straight back in.
  ///
  /// Sequential rather than concurrent, and that is the whole shape of the
  /// thing: the engine's start-up is a chain — pull, push what the server
  /// lacked, read the config, write ours, subscribe — where each step's failure
  /// aborts the rest. Running them in parallel would lose exactly that.
  Future<void> _run(List<rust.SyncEffect> effects) async {
    for (final e in effects) {
      switch (e.kind) {
        case 'pullEntries':
          await _run(rust.syncEntriesPulled(json: await transport.pullEntries()));
        case 'pullConfig':
          final r = await transport.pullConfig();
          await _run(rust.syncConfigPulled(ok: r.ok, json: r.json));
        case 'pushPulled':
          // An empty upload is not attempted — and so cannot fail. The engine
          // still expects to hear about it.
          final ok = _isEmpty(e.json) || await transport.pushEntries(e.json);
          await _run(rust.syncPulledPushDone(ok: ok));
        case 'pushConfig':
          final ok = await transport.pushConfig(rust.syncConfigBlob());
          await _run(rust.syncConfigPushDone(ok: ok));
        case 'flush':
          await _run(rust.syncFlushDone(outcome: await _flush(e.json)));
        case 'subscribe':
          await transport.subscribe(e.name);
        case 'unsubscribe':
          await transport.unsubscribe(e.name);
        case 'setTimer':
          _setTimer(e.name, e.ms);
        case 'clearTimer':
          _clearTimer(e.name);
        case 'status':
          status.value = e.name;
        case 'lastSync':
          lastSync.value = DateTime.now();
        case 'saveStamps':
          await stamps?.save(rust.syncStampsJson());
      }
    }
  }

  /// Rows first, then the config — and the distinction between the two failures
  /// is not cosmetic. When the rows land and the config does not, the watermark
  /// still advances past those rows, so the retry does not re-upload what the
  /// server already has.
  Future<String> _flush(String rowsJson) async {
    if (!_isEmpty(rowsJson) && !await transport.pushEntries(rowsJson)) {
      return 'entriesFailed';
    }
    if (!await transport.pushConfig(rust.syncConfigBlob())) return 'configFailed';
    return 'ok';
  }

  static bool _isEmpty(String json) => json.isEmpty || json == '[]';

  /// Setting a timer replaces any pending one of the same kind — the debounce
  /// coalesces a burst of edits into one upload, which it can only do by
  /// pushing its own deadline back.
  void _setTimer(String name, int ms) {
    final d = Duration(milliseconds: ms);
    if (name == 'retry') {
      _retry?.cancel();
      _retry = Timer(d, () => _fire('retry'));
    } else {
      _debounce?.cancel();
      _debounce = Timer(d, () => _fire('debounce'));
    }
  }

  void _clearTimer(String name) {
    if (name == 'retry') {
      _retry?.cancel();
      _retry = null;
    } else {
      _debounce?.cancel();
      _debounce = null;
    }
  }

  /// A fired timer is not re-entrant.
  ///
  /// `_run` awaits network calls, so a second timer landing mid-flight would
  /// interleave two flushes against one watermark. The engine is synchronous
  /// and cannot see that; this is the platform's part of the bargain.
  Future<void> _fire(String name) async {
    if (_running) return;
    _running = true;
    try {
      await _run(rust.syncTimerFired(timer: name));
    } finally {
      _running = false;
    }
  }
}

/// A transport that talks to nothing, and records what it was asked.
///
/// Not a stand-in for the real one so much as the only one that can be
/// exercised here: with no Supabase project configured, this is what makes the
/// loop testable on a device at all. It is also what the shipping app's own
/// engine tests use, at the same boundary.
class FakeTransport implements SyncTransport {
  /// Rows the server holds, by id.
  final Map<String, Map<String, dynamic>> entries = {};
  String? profile;

  bool failPull = false;
  bool failConfigRead = false;
  bool failPush = false;
  bool failConfigPush = false;

  /// Every call, in order — `pullEntries`, `push[a,b]`, `config`, `sub:entries`.
  final List<String> log = [];
  final Set<String> channels = {};

  @override
  Future<String?> pullEntries() async {
    log.add('pullEntries');
    if (failPull) return null;
    return '[${entries.values.map(_encode).join(',')}]';
  }

  @override
  Future<({bool ok, String? json})> pullConfig() async {
    log.add('pullConfig');
    if (failConfigRead) return (ok: false, json: null);
    return (ok: true, json: profile);
  }

  @override
  Future<bool> pushEntries(String rowsJson) async {
    final ids = _idsOf(rowsJson);
    log.add('push[${ids.join(',')}]');
    if (failPush) return false;
    for (final id in ids) {
      entries[id] = {'id': id};
    }
    return true;
  }

  @override
  Future<bool> pushConfig(String blobJson) async {
    log.add('config');
    if (failPush || failConfigPush) return false;
    profile = blobJson;
    return true;
  }

  @override
  Future<void> subscribe(String name) async {
    log.add('sub:$name');
    channels.add(name);
  }

  @override
  Future<void> unsubscribe(String name) async {
    log.add('unsub:$name');
    channels.remove(name);
  }

  static String _encode(Map<String, dynamic> row) =>
      '{"id":"${row['id']}","ts":1000,"io":"exp","cat":"food","amt":1,"updatedAt":${row['updatedAt'] ?? 0}}';

  /// The ids in a rows array, without parsing it properly — the fake never
  /// needs the values, only which rows went up.
  static List<String> _idsOf(String rowsJson) => RegExp(r'"id":"([^"]*)"')
      .allMatches(rowsJson)
      .map((m) => m.group(1)!)
      .toList();
}
