// Folders in the app's own storage that more than one part of the app reads.
//
// The snapshot folder used to live in backup_screen.dart, which was fine while
// only 备份 used it. The receipt sweep reads the lists beside the snapshots
// too, and photos.dart importing a screen that already imports photos.dart was
// a cycle.

import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Where snapshots live: a subdirectory of the app's own storage.
///
/// The same place the ledger is written, for the same reason — Dart alone
/// cannot find the Android app-private directory and a hardcoded path is not
/// one.
Future<Directory> backupDir() async {
  final base = await getApplicationDocumentsDirectory();
  final dir = Directory('${base.path}/backups');
  if (!await dir.exists()) await dir.create(recursive: true);
  return dir;
}
