// 小票 — the file behind an entry's photo field.
//
// The ledger stores a **name**; the bytes live here. Same rule as everything
// else that touches a disk: core decides, the platform owns the path.

import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

/// Where receipt images live, next to the database.
Future<Directory> attachmentsDir() async {
  final base = await getApplicationDocumentsDirectory();
  final dir = Directory("${base.path}/attachments");
  if (!await dir.exists()) await dir.create(recursive: true);
  return dir;
}

/// Copy a picked image into the attachments directory under `name`.
/// Returns the name to store on the entry.
Future<String> saveAttachment(XFile picked, String name) async {
  final dir = await attachmentsDir();
  final ext = picked.path.split(".").last.toLowerCase();
  final file = File("${dir.path}/$name.$ext");
  await File(picked.path).copy(file.path);
  return "$name.$ext";
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
