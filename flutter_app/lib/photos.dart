// 小票 — the file behind an entry's photo field.
//
// The ledger stores a **name**; the bytes live here. Same rule as everything
// else that touches a disk: core decides, the platform owns the path.
//
// That includes when a file can go. Nothing used to delete one: a delete, an
// edit that changed the receipt, a sheet closed after a photo was picked —
// each left a file that nothing named, for as long as the app was installed.
// `sweepReceipts` takes them, once a launch, and `core::receipts` says which.

import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

import 'diagnostics.dart';
import 'folders.dart';
import 'persistence.dart';
import 'src/rust/api/backup.dart' as backup;
import 'src/rust/api/receipts.dart' as receipts;

/// Where receipt images live, next to the database.
Future<Directory> attachmentsDir() async {
  final base = await getApplicationDocumentsDirectory();
  final dir = Directory("${base.path}/attachments");
  if (!await dir.exists()) await dir.create(recursive: true);
  return dir;
}

/// Every receipt this run has saved. A sheet that picked one may still be
/// open, and until it saves no row names the file — so the sweep leaves these
/// to the next launch, by which time every sheet of this one is closed.
final _savedThisRun = <String>{};

/// Copy a picked image into the attachments directory under `name`.
/// Returns the name to store on the entry.
Future<String> saveAttachment(XFile picked, String name) async {
  final dir = await attachmentsDir();
  final ext = picked.path.split(".").last.toLowerCase();
  final file = File("${dir.path}/$name.$ext");
  // Before the copy, so there is no moment the file exists and is not held.
  _savedThisRun.add("$name.$ext");
  await File(picked.path).copy(file.path);
  return "$name.$ext";
}

/// Delete the receipts nothing can show or bring back, and answer which went.
///
/// Called once a launch, from `main`: a launch is when no sheet of this run is
/// open and no 撤销 is on the screen, though the core's rule holds either way.
/// Which files those are is `core::receipts`, where every rule — tombstones,
/// snapshots, sync — is written down. This lists, reads and deletes.
///
/// Nothing at all when the ledger did not load. A ledger that could not be
/// read is not an empty one, and to the sweep every receipt would look like
/// one nobody names.
Future<List<String>> sweepReceipts(Persistence store, {int? now}) async {
  if (!store.healthy) return const [];
  final dir = await attachmentsDir();
  // Listed before the ledger is asked: a receipt saved after the listing is
  // not in it, and one saved before it is in the ledger or in hand.
  final files = [
    await for (final f in dir.list())
      if (f is File) f.uri.pathSegments.last,
  ];
  if (files.isEmpty) return const [];

  final shelf = await backupDir();
  final backups = [
    await for (final f in shelf.list())
      if (f is File) f.uri.pathSegments.last,
  ];
  // A list that is missing or will not read is left out, and the core takes
  // a sealed snapshot without one as one that could name anything.
  final lists = <receipts.ReceiptList>[];
  for (final name in backups) {
    final list = backup.receiptsName(name: name);
    if (list == null) continue;
    try {
      final text = await File("${shelf.path}/$list").readAsString();
      lists.add(receipts.ReceiptList(name: list, text: text));
    } on FileSystemException {
      continue;
    }
  }

  // Every snapshot sealed before lists existed has none. The core gives each
  // one the folder as it stands, and why that is safe is on
  // `core::receipts::adopt`. Written before anything is swept; a list that
  // cannot be written means nothing is.
  final adopted = await receipts.adoptLists(
    files: files,
    backups: backups,
    lists: lists,
  );
  for (final list in adopted) {
    try {
      await File(
        "${shelf.path}/${list.name}",
      ).writeAsString(list.text, flush: true);
    } on FileSystemException catch (e) {
      diag.note('receipts: could not write ${list.name}, swept nothing: $e');
      return const [];
    }
    lists
      ..removeWhere((l) => l.name == list.name)
      ..add(list);
  }
  if (adopted.isNotEmpty) {
    diag.note('receipts: wrote lists for ${adopted.length} sealed snapshots');
  }

  final gone = await receipts.sweepReceipts(
    files: files,
    backups: backups,
    lists: lists,
    inUse: _savedThisRun.toList(),
    now: now ?? DateTime.now().millisecondsSinceEpoch,
  );
  final deleted = <String>[];
  for (final name in gone) {
    try {
      await File("${dir.path}/$name").delete();
      deleted.add(name);
    } on FileSystemException {
      // Gone already, or not ours to delete. The next launch asks again.
    }
  }
  if (deleted.isNotEmpty) {
    diag.note('receipts: swept ${deleted.length} of ${files.length}');
  }
  return deleted;
}

/// How many times [attachmentFile] has gone to the disk. Each is a platform
/// call for the directory and two file checks; counted so a test can hold a
/// screen to asking once rather than once a build.
@visibleForTesting
int attachmentLookups = 0;

/// Absolute path of a stored attachment, or null when the name is empty
/// or the file is gone (an uninstall-and-restore leaves names behind).
Future<File?> attachmentFile(String? name) async {
  if (name == null || name.isEmpty) return null;
  attachmentLookups++;
  final dir = await attachmentsDir();
  final f = File("${dir.path}/$name");
  return (await f.exists()) ? f : null;
}

/// A receipt decoded for a thumbnail: its short side at `side` pixels.
///
/// A receipt is kept at up to 1600px, and the record sheet's 56dp thumbnail
/// decoded it whole — about 13MB of pixels for a portrait photo, held while
/// the sheet was open. `cacheWidth` and `cacheHeight` together would squash it
/// to a square, and either alone is right for one orientation and soft for the
/// other: the thumbnail covers its square, so it is the SHORT side that has to
/// fill it. A photo already smaller than that is left as it is.
///
/// Its own cache key, so the full-size view of the same file — 明细's tap on a
/// row's receipt — is a different image and stays sharp.
class ReceiptThumb extends ImageProvider<ReceiptThumb> {
  const ReceiptThumb(this.file, this.side);

  final File file;

  /// In physical pixels: the drawn size times the device pixel ratio.
  final int side;

  @override
  Future<ReceiptThumb> obtainKey(ImageConfiguration configuration) =>
      SynchronousFuture<ReceiptThumb>(this);

  @override
  ImageStreamCompleter loadImage(
    ReceiptThumb key,
    ImageDecoderCallback decode,
  ) => MultiFrameImageStreamCompleter(
    codec: _decode(decode),
    scale: 1,
    debugLabel: file.path,
  );

  Future<ui.Codec> _decode(ImageDecoderCallback decode) async {
    final buffer = await ui.ImmutableBuffer.fromFilePath(file.path);
    if (buffer.length == 0) {
      // What `FileImage` does with a file that was truncated or is still
      // being written: an error, and not a zero-pixel image in the cache.
      buffer.dispose();
      throw StateError('${file.path} is empty and cannot be loaded.');
    }
    return decode(
      buffer,
      getTargetSize: (w, h) {
        if (math.min(w, h) <= side) return const ui.TargetImageSize();
        return w <= h
            ? ui.TargetImageSize(width: side)
            : ui.TargetImageSize(height: side);
      },
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ReceiptThumb && other.file.path == file.path && other.side == side;

  @override
  int get hashCode => Object.hash(file.path, side);
}
