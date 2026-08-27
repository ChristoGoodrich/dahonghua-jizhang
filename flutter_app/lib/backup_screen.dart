// 备份 — snapshots of the whole store, on this device.
//
// The bytes are Dart's; the naming, the ordering, the pruning and the document
// are Rust's. That split matters more than it looks: pruning keeps the FIRST
// `keep` of the list, so a directory listing in the wrong order would delete
// the wrong files, and which order a listing comes back in is not something a
// filesystem promises.
//
// Restoring REPLACES the ledger. It refuses a document it cannot read rather
// than restoring the half it managed to parse — a ledger half replaced is worse
// than one not replaced.
//
// Encryption is not here. The shipping app encrypts with AES-256-GCM over a
// PBKDF2 key; porting that would cost the core three dependencies against the
// one it has, and a cipher is not a decision the ledger needs to own. The
// screen says so rather than offering a switch that does nothing.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

import 'src/rust/api/backup.dart' as backup;
import 'theme.dart';

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

/// Take a snapshot and prune the old ones. Returns the file written.
Future<File> createBackup({int? keep}) async {
  final dir = await backupDir();
  final now = DateTime.now().millisecondsSinceEpoch.toDouble();
  final file = File(
    '${dir.path}/${backup.backupName(ts: now, encrypted: false)}',
  );
  await file.writeAsString(backup.buildBackup(ts: now));

  final names = await _names(dir);
  for (final gone in backup.pruneBackups(
    names: names,
    keep: keep ?? backup.maxBackups(),
  )) {
    await File('${dir.path}/$gone').delete();
  }
  return file;
}

Future<List<String>> _names(Directory dir) async => dir
    .listSync()
    .whereType<File>()
    .map((f) => f.uri.pathSegments.last)
    .toList();

/// Every snapshot on disk, newest first.
Future<List<backup.BackupInfoView>> listBackups() async {
  final dir = await backupDir();
  return backup.listBackups(names: await _names(dir));
}

class BackupScreen extends StatefulWidget {
  const BackupScreen({super.key, this.zh = true, this.onRestored});

  final bool zh;

  /// A restore replaced the ledger and the config, so both files need writing
  /// and every screen needs rebuilding.
  final VoidCallback? onRestored;

  @override
  State<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends State<BackupScreen> {
  List<backup.BackupInfoView> _rows = const [];
  String? _flash;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final list = await listBackups();
    if (mounted) setState(() => _rows = list);
  }

  Future<void> _create() async {
    setState(() => _busy = true);
    try {
      await createBackup();
      await _reload();
      if (mounted) {
        setState(() => _flash = widget.zh ? '已备份' : 'Snapshot taken');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _restore(backup.BackupInfoView b) async {
    final zh = widget.zh;
    final when = _when(b, zh);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('restore-dialog'),
        backgroundColor: palette.card,
        title: Text(zh ? '恢复到 $when?' : 'Restore $when?',
            style: TextStyle(fontSize: 16, color: palette.ink)),
        content: Text(
          zh
              ? '现在的账目和设置会被这份快照整个替换。这一步没有撤销。'
              : 'Your entries and settings are replaced wholesale by this '
                  'snapshot. There is no undo.',
          style: TextStyle(fontSize: 13.5, color: palette.inkSoft),
        ),
        actions: [
          TextButton(
            key: const Key('restore-cancel'),
            onPressed: () => Navigator.pop(ctx, false),
            style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
            child: Text(zh ? '取消' : 'Cancel'),
          ),
          TextButton(
            key: const Key('restore-ok'),
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
            child: Text(zh ? '恢复' : 'Restore'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    // Take a snapshot of what is about to be replaced. Restoring is the one
    // action here with no undo, and the cheapest undo is another backup.
    await createBackup();

    final dir = await backupDir();
    final json = await File('${dir.path}/${b.name}').readAsString();
    final r = backup.restoreBackup(json: json);
    await _reload();
    if (!mounted) return;
    setState(() {
      _flash = r.ok
          ? (widget.zh ? '已恢复 ${r.entries} 条' : 'Restored ${r.entries} entries')
          : (widget.zh ? '这份文件读不了,没有改动' : 'Unreadable — nothing changed');
    });
    if (r.ok) widget.onRestored?.call();
  }

  String _when(backup.BackupInfoView b, bool zh) {
    if (b.time.isNaN) return b.name;
    final d = DateTime.fromMillisecondsSinceEpoch(b.time.toInt());
    final hh = d.hour.toString().padLeft(2, '0');
    final mm = d.minute.toString().padLeft(2, '0');
    return zh
        ? '${d.month}月${d.day}日 $hh:$mm'
        : '${d.month}/${d.day} $hh:$mm';
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return Scaffold(
      backgroundColor: palette.paper,
      appBar: AppBar(
        backgroundColor: palette.paper,
        surfaceTintColor: Colors.transparent,
        title: Text(zh ? '备份' : 'Backups',
            style: TextStyle(
                color: palette.ink, fontSize: 20, fontWeight: FontWeight.w700)),
        actions: [
          IconButton(
            key: const Key('take-backup'),
            icon: Icon(Icons.add, color: palette.ink),
            onPressed: _busy ? null : _create,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 6, 22, 120),
        children: [
          Text(
            zh
                ? '快照存在这台手机上,最多留 ${backup.maxBackups()} 份,超出的从最旧的开始删。'
                : 'Snapshots live on this phone. The newest '
                    '${backup.maxBackups()} are kept; older ones go first.',
            style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
          ),
          if (_flash != null) ...[
            const SizedBox(height: 10),
            Text(_flash!,
                key: const Key('backup-flash'),
                style: TextStyle(fontSize: 12.5, color: palette.leafDeep)),
          ],
          const SizedBox(height: 18),
          if (_rows.isEmpty)
            Text(zh ? '还没有备份' : 'No snapshots yet',
                key: const Key('no-backups'),
                style: TextStyle(fontSize: 13, color: palette.inkSoft)),
          for (final b in _rows) _row(b, zh),
          const SizedBox(height: 24),
          Text(
            zh
                ? '加密备份和导出到别处还没做 — 前者要一套密码学库,后者要文件分享插件。'
                : 'Encrypted snapshots and export elsewhere are not here yet: '
                    'one needs a crypto library, the other a sharing plugin.',
            key: const Key('backup-note'),
            style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
          ),
        ],
      ),
    );
  }

  Widget _row(backup.BackupInfoView b, bool zh) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: palette.card,
            borderRadius: BorderRadius.circular(Rad.md),
            border: Border.all(color: palette.line),
          ),
          child: Row(children: [
            Icon(Icons.archive_outlined, size: 20, color: palette.inkSoft),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_when(b, zh),
                      key: Key('backup-${b.name}-when'),
                      style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: palette.ink)),
                  const SizedBox(height: 1),
                  Text(b.encrypted ? (zh ? '已加密' : 'Encrypted') : b.name,
                      style:
                          TextStyle(fontSize: 11, color: palette.inkSoft)),
                ],
              ),
            ),
            TextButton(
              key: Key('backup-${b.name}-restore'),
              // Nothing here can read an encrypted snapshot, so the button that
              // would fail is absent rather than disabled.
              onPressed: b.encrypted ? null : () => _restore(b),
              style: TextButton.styleFrom(
                foregroundColor:
                    b.encrypted ? palette.inkSoft : palette.hibiscus,
              ),
              child: Text(zh ? '恢复' : 'Restore'),
            ),
          ]),
        ),
      );
}
