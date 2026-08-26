// The ledger on disk.
//
// Rust owns the state and knows its shape; this owns the file and nothing else.
// The split is the same one the whole migration draws — `snapshot_entries`
// decides what a saved ledger *is*, and everything here is bytes, paths and a
// timer.
//
// Two files rather than one, matching the React Native build's two AsyncStorage
// keys. Renaming an account should not rewrite ten thousand entries, and a
// write that fails halfway should not be able to take both with it.
//
// What this is NOT: a way to open an existing React Native install. That
// build's AsyncStorage is a SQLite database, not a file, so the *shape* is
// shared and the storage is not. Moving an install across is platform work
// that has not been done.

import 'dart:async';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'src/rust/api/store.dart' as store;

class Persistence {
  Persistence._(this._dir, this._debounce);

  final Directory _dir;
  final Duration _debounce;
  Timer? _entriesTimer;
  Timer? _configTimer;

  /// A file that existed and could not be read.
  ///
  /// Saving over it is the step that turns "unreadable" into "gone", so while
  /// this is set the corresponding save is refused. A user who backs the file
  /// up, or an update that can read it, still can.
  bool entriesUnreadable = false;
  bool configUnreadable = false;

  File get _entriesFile => File('${_dir.path}/entries.json');
  File get _configFile => File('${_dir.path}/config.json');

  /// Open the store's files and load whatever is in them.
  ///
  /// A missing file is a first launch, not a failure. A file that exists and
  /// cannot be read is neither: the store is left alone and the save for that
  /// file is refused, because writing over it is what would turn a recoverable
  /// problem into a permanent one.
  static Future<Persistence> open({Directory? dir}) async {
    final d = dir ?? await getApplicationDocumentsDirectory();
    final p = Persistence._(
      d,
      Duration(milliseconds: store.persistDebounceMs()),
    );
    await p._load();
    return p;
  }

  Future<void> _load() async {
    // config first: it carries the accounts an entry's `acct` points at, and a
    // ledger that loaded before them would briefly name accounts that do not
    // exist yet
    if (await _configFile.exists()) {
      configUnreadable = !store.loadConfig(json: await _configFile.readAsString());
    }
    if (await _entriesFile.exists()) {
      entriesUnreadable =
          store.loadEntries(json: await _entriesFile.readAsString()) < 0;
    }
  }

  /// Note that the ledger changed. The write happens after the debounce.
  void touchEntries() {
    _entriesTimer?.cancel();
    _entriesTimer = Timer(_debounce, () => saveEntries());
  }

  void touchConfig() {
    _configTimer?.cancel();
    _configTimer = Timer(_debounce, () => saveConfig());
  }

  /// Write now, whatever the timer was going to do.
  ///
  /// Called when the app is going to the background: a debounce that is still
  /// counting when the process is killed is exactly the work a save debounce
  /// trades away, and the moment the system says "you may be about to stop" is
  /// the moment to stop trading.
  Future<void> flush() async {
    _entriesTimer?.cancel();
    _configTimer?.cancel();
    await saveEntries();
    await saveConfig();
  }

  Future<void> saveEntries() async {
    if (entriesUnreadable) return;
    await _write(_entriesFile, store.snapshotEntries());
  }

  Future<void> saveConfig() async {
    if (configUnreadable) return;
    await _write(_configFile, store.snapshotConfig());
  }

  /// Write through a temporary file and rename over the target.
  ///
  /// A rename is atomic where a write is not. Writing in place means a process
  /// killed mid-write leaves a truncated JSON file, which loads as *nothing* —
  /// so an interrupted save would not lose the last few seconds of entries, it
  /// would lose all of them.
  Future<void> _write(File target, String contents) async {
    final tmp = File('${target.path}.tmp');
    try {
      await tmp.writeAsString(contents, flush: true);
      await tmp.rename(target.path);
    } catch (_) {
      // a failed save is not worth taking the app down for; the next change
      // schedules another one, and the in-memory ledger is still intact
      try {
        if (await tmp.exists()) await tmp.delete();
      } catch (_) {}
    }
  }

  void dispose() {
    _entriesTimer?.cancel();
    _configTimer?.cancel();
  }
}
