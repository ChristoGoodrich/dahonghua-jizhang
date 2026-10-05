// The ledger on disk.
//
// Rust owns the state, the schema and the bytes; this owns the path and a
// timer. That is a smaller job than this file used to have — it used to hold
// the file too, reading and writing JSON — and the shrinking is the point.
// `path_provider` knows where an app is allowed to write, which is genuinely
// platform knowledge; everything after that is storage, and storage belongs
// with the thing that owns the ledger.
//
// What changed underneath: a save used to rewrite every entry. One edited note
// re-serialised ten thousand rows and pushed the whole array back through the
// filesystem. Now a save writes the rows that changed, in one transaction.
//
// The old files are still read once, and then kept. See `_migrate`.

import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'src/rust/api/db.dart' as db;
import 'src/rust/api/store.dart' as store;

class Persistence {
  Persistence._(this._dir, this._debounce);

  final Directory _dir;
  final Duration _debounce;
  Timer? _timer;

  /// What the UI should say about storage right now, or null when all is well.
  ///
  /// `openError` and `lastSaveError` keep the raw strings for tests and for a
  /// screen that wants the detail; this is the one the shell listens to. Set
  /// when the database will not open *or* when a save failed, cleared when a
  /// save lands — a problem the user cannot see is a problem they cannot fix,
  /// and for two releases this file set these and nothing read them.
  final ValueNotifier<String?> storageNotice = ValueNotifier<String?>(null);

  /// Set when the database could not be opened or read.
  ///
  /// While this is set every save is refused, for the reason the JSON version
  /// refused them: writing over something unreadable is the step that turns a
  /// recoverable problem into a permanent one. A user who copies the file
  /// somewhere safe, or an update that can read it, still can.
  String? openError;

  bool get healthy => openError == null;

  File get _dbFile => File('${_dir.path}/ledger.db');
  File get _legacyEntries => File('${_dir.path}/entries.json');
  File get _legacyConfig => File('${_dir.path}/config.json');

  /// The last thing a save said, or null. Shown rather than interpreted: a
  /// full disk and a file from a newer build are both worth reading, and
  /// neither is something the UI can usefully branch on.
  String? lastSaveError;

  static Future<Persistence> open({Directory? dir}) async {
    final d = dir ?? await getApplicationDocumentsDirectory();
    final p = Persistence._(
      d,
      // From Rust, not from a literal here. The React Native build debounces
      // by the same number, and what a save debounce actually decides is how
      // much work a crash is allowed to lose — so both builds have to agree.
      Duration(milliseconds: store.persistDebounceMs()),
    );
    await p._start();
    return p;
  }

  void _failOpen(String message) {
    openError = message;
    storageNotice.value = message;
  }

  Future<void> _start() async {
    final err = db.openStore(path: _dbFile.path);
    if (err.isNotEmpty) {
      _failOpen(err);
      return;
    }

    await _migrate();

    if (db.loadFromStore() < 0) {
      _failOpen('the ledger database could not be read');
    }
  }

  /// Bring the old JSON files across, once.
  ///
  /// Reading them is still Dart's job because they are files, and because the
  /// code that read them was already here and already correct about the thing
  /// that matters: a file that exists and cannot be read is not an empty file.
  ///
  /// The files are **kept**, not deleted. A rename to `.bak` would be tidier
  /// and is not worth it — this is the first run of new storage code against
  /// the only copy of someone's ledger, and the cost of leaving two files
  /// behind is a few hundred kilobytes, while the cost of being wrong about
  /// the import is everything. They can be removed in a later release, once
  /// this one has been run for a while by someone who would notice.
  Future<void> _migrate() async {
    if (db.alreadyMigrated()) return;
    final hasEntries = await _legacyEntries.exists();
    final hasConfig = await _legacyConfig.exists();
    if (!hasEntries && !hasConfig) return;

    String entries = '';
    String config = '';
    try {
      if (hasEntries) entries = await _legacyEntries.readAsString();
      if (hasConfig) config = await _legacyConfig.readAsString();
    } catch (e) {
      _failOpen('the old ledger files could not be read: $e');
      return;
    }

    // A file that exists and is empty is not an empty ledger — it is what a
    // write killed partway leaves behind. Rust cannot tell the difference,
    // because an absent file and an empty one both arrive as "". The
    // distinction is file-shaped, so it is drawn on the side that holds files.
    if (hasEntries && entries.trim().isEmpty) {
      _failOpen(
        'the old ledger file is empty, which is not the same as '
        'having no entries',
      );
      return;
    }
    if (hasConfig && config.trim().isEmpty) {
      _failOpen('the old config file is empty');
      return;
    }

    final err = db.migrateFromJson(entriesJson: entries, configJson: config);
    if (err.isNotEmpty) _failOpen(err);
  }

  /// Note that something changed. The write happens after the debounce.
  ///
  /// One timer now rather than two. The old split existed because a config
  /// change rewrote the whole ledger file otherwise; with row-level writes a
  /// renamed account writes the config row and nothing else, so the two no
  /// longer need separate schedules.
  void touch() {
    _timer?.cancel();
    _timer = Timer(_debounce, save);
  }

  /// Kept so callers that named the old methods keep working; both now mean
  /// the same thing, because the storage no longer cares which changed.
  void touchEntries() => touch();
  void touchConfig() => touch();

  /// Write now, whatever the timer was going to do.
  ///
  /// Called when the app goes to the background: a debounce still counting
  /// when the process is killed is exactly the work a debounce trades away,
  /// and "you may be about to stop" is the moment to stop trading.
  Future<void> flush() async {
    _timer?.cancel();
    save();
  }

  void save() {
    if (!healthy) return;
    final err = db.flushStore();
    lastSaveError = err.isEmpty ? null : err;
    if (lastSaveError != null) {
      storageNotice.value = lastSaveError;
    } else if (openError == null) {
      storageNotice.value = null;
    }
  }

  /// How many rows the next save would write. `-1` means all of them.
  /// Exposed for tests — this number is the whole reason for the change.
  int get pendingRows => db.dirtyEntryCount();

  void dispose() {
    _timer?.cancel();
    db.closeStore();
  }
}
