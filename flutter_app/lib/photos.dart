// 小票 — the file behind an entry's photo field.
//
// The ledger stores a **name**; the bytes live here. Same rule as everything
// else that touches a disk: core decides, the platform owns the path.

import 'dart:io';

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

/// Absolute path of a stored attachment, or null when the name is empty
/// or the file is gone (an uninstall-and-restore leaves names behind).
Future<File?> attachmentFile(String? name) async {
  if (name == null || name.isEmpty) return null;
  final dir = await attachmentsDir();
  final f = File("${dir.path}/$name");
  return (await f.exists()) ? f : null;
}
