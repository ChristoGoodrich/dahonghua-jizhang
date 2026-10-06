// 备份 — snapshots of the whole store.
//
// They live in the app's own storage, and that is worth being blunt about
// because the word 备份 promises more than the directory delivers: **an
// uninstall takes every one of them**. That is not a hypothetical filing
// cabinet either — installing a properly signed build over a debug-signed one
// requires exactly that uninstall. A snapshot that only exists in the sandbox
// protects against a bad restore and against nothing else.
//
// So every snapshot can be handed out of the app. The note here used to say
// export elsewhere needed "a sharing plugin"; `share_plus` had arrived for the
// sync screen in the meantime and nobody came back. It is the share sheet, so
// where it lands is the user's choice — 文件, a cloud drive, a chat with
// themselves — and this app still sends nothing anywhere on its own.
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
// Sealing is optional. AES-256-GCM over a PBKDF2 key, done in the bridge —
// a cipher is not a decision the ledger needs to own. Empty password on the
// way out means a plain snapshot; on the way back in there is no empty path.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'src/rust/api/backup.dart' as backup;
import 'glass.dart';
import 'empty_note.dart';
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
///
/// `password` seals the document; omit it for a plain JSON snapshot. An empty
/// password is refused on the Rust side rather than writing a file that looks
/// sealed and is not.
Future<File> createBackup({int? keep, String? password}) async {
  final dir = await backupDir();
  final now = DateTime.now().millisecondsSinceEpoch.toDouble();
  var json = backup.buildBackup(ts: now);
  if (json.isEmpty) {
    // The core refuses to assemble a document it cannot read back. Writing
    // the empty string would be a file that looks like a backup and holds
    // nothing — worse than no file at all.
    throw StateError('backup could not be built');
  }
  final sealed = password != null && password.isNotEmpty;
  if (sealed) {
    json = backup.encryptBackup(plaintext: json, password: password);
    if (json.isEmpty) throw StateError('backup could not be sealed');
  }
  final file = File(
    '${dir.path}/${backup.backupName(ts: now, encrypted: sealed)}',
  );
  await file.writeAsString(json);

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
    final zh = widget.zh;
    final password = await showDialog<String?>(
      context: context,
      builder: (ctx) => _PasswordDialog(zh: zh),
    );
    if (!mounted) return;
    // Cancelled: take no snapshot at all, rather than silently writing a
    // plain one the user did not ask for.
    if (password == null) return;
    setState(() => _busy = true);
    try {
      await createBackup(password: password.isEmpty ? null : password);
      await _reload();
      if (mounted) {
        setState(
          () => _flash = password.isEmpty
              ? (zh ? '已备份' : 'Snapshot taken')
              : (zh ? '已加密备份' : 'Encrypted snapshot taken'),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Hand a snapshot out of the app.
  ///
  /// The share sheet rather than a folder this app picks: scoped storage means
  /// an app cannot just write to 下载 any more, and where a backup belongs is
  /// the user's call anyway. What matters is that after this the file exists
  /// somewhere an uninstall cannot reach.
  Future<void> _export(backup.BackupInfoView b) async {
    final dir = await backupDir();
    final file = File('${dir.path}/${b.name}');
    if (!await file.exists()) {
      if (!mounted) return;
      setState(() => _flash = widget.zh ? '这份快照不见了' : 'That snapshot is gone');
      return;
    }
    await SharePlus.instance.share(
      ShareParams(files: [XFile(file.path)], text: b.name),
    );
  }

  Future<void> _restore(backup.BackupInfoView b) async {
    final zh = widget.zh;
    final when = _when(b, zh);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('restore-dialog'),
        backgroundColor: palette.card,
        title: Text(
          zh ? '恢复到 $when?' : 'Restore $when?',
          style: TextStyle(fontSize: 16, color: palette.ink),
        ),
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
    if (!mounted) return;

    final dir = await backupDir();
    var json = await File('${dir.path}/${b.name}').readAsString();
    if (b.encrypted || backup.isEncryptedDoc(json: json)) {
      if (!mounted) return;
      final password = await showDialog<String>(
        context: context,
        builder: (ctx) => _PasswordDialog(zh: zh, unlocking: true),
      );
      if (password == null || !mounted) return;
      final unlocked = backup.decryptBackup(envelope: json, password: password);
      if (!unlocked.ok) {
        setState(
          () => _flash = zh
              ? '口令不对,或者文件坏了 — 没有改动'
              : 'Wrong password, or the file is damaged — nothing changed',
        );
        return;
      }
      json = unlocked.json;
    }
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
    return zh ? '${d.month}月${d.day}日 $hh:$mm' : '${d.month}/${d.day} $hh:$mm';
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return ScrimScaffold(
      title: Text(
        zh ? '备份' : 'Backups',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      actions: [
        IconButton(
          key: const Key('take-backup'),
          icon: Icon(Icons.add, color: palette.ink),
          onPressed: _busy ? null : _create,
        ),
      ],
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
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
            Text(
              _flash!,
              key: const Key('backup-flash'),
              style: TextStyle(fontSize: 12.5, color: palette.leafDeep),
            ),
          ],
          const SizedBox(height: 18),
          if (_rows.isEmpty)
            EmptyNote(
              key: const Key('no-backups'),
              icon: Icons.archive_outlined,
              text: zh ? '还没有备份' : 'No snapshots yet',
              hint: zh ? '点右上角的 + 存一份' : 'Take one with + above',
            ),
          for (final b in _rows) _row(b, zh),
          const SizedBox(height: 24),
          Text(
            zh
                ? '快照在这个 app 的存储里,卸载会一起没有 —— 装正式签名的版本就要先卸载,'
                      '所以换版本前请先「导出」一份。可以给备份设口令;忘了口令就打不开了。'
                : 'Snapshots live in this app storage and an uninstall takes '
                      'them — which is what installing a properly signed build '
                      'needs. Export one first. You can seal a snapshot with a '
                      'password; without it the file cannot be opened.',
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
      child: Row(
        children: [
          Icon(Icons.archive_outlined, size: 20, color: palette.inkSoft),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _when(b, zh),
                  key: Key('backup-${b.name}-when'),
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: palette.ink,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  b.encrypted ? (zh ? '已加密' : 'Encrypted') : b.name,
                  style: TextStyle(fontSize: 11, color: palette.inkSoft),
                ),
              ],
            ),
          ),
          TextButton(
            key: Key('backup-${b.name}-export'),
            onPressed: () => _export(b),
            style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
            child: Text(zh ? '导出' : 'Export'),
          ),
          TextButton(
            key: Key('backup-${b.name}-restore'),
            onPressed: () => _restore(b),
            style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
            child: Text(zh ? '恢复' : 'Restore'),
          ),
        ],
      ),
    ),
  );
}

/// Set a password on the way out, or unlock on the way back in.
///
/// Empty is allowed on **create** — it means "plain snapshot" — and never on
/// unlock, because an empty password does not open a sealed file.
class _PasswordDialog extends StatefulWidget {
  const _PasswordDialog({required this.zh, this.unlocking = false});

  final bool zh;

  /// True when restoring: no "leave empty for plain" path, and the wording
  /// says the password is required.
  final bool unlocking;

  @override
  State<_PasswordDialog> createState() => _PasswordDialogState();
}

class _PasswordDialogState extends State<_PasswordDialog> {
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  void _submit() {
    final zh = widget.zh;
    final pw = _password.text;
    if (widget.unlocking) {
      if (pw.isEmpty) {
        setState(() => _error = zh ? '要输入口令' : 'A password is required');
        return;
      }
      Navigator.pop(context, pw);
      return;
    }
    if (pw.isEmpty) {
      // A deliberate plain snapshot, not a forgotten field.
      Navigator.pop(context, '');
      return;
    }
    if (pw != _confirm.text) {
      setState(() => _error = zh ? '两次输入不一致' : 'The two entries differ');
      return;
    }
    Navigator.pop(context, pw);
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('password-dialog'),
      backgroundColor: palette.card,
      title: Text(
        widget.unlocking
            ? (zh ? '输入口令' : 'Enter password')
            : (zh ? '给备份设口令' : 'Seal with a password'),
        style: TextStyle(fontSize: 16, color: palette.ink),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            widget.unlocking
                ? (zh ? '这份快照是加密的。' : 'This snapshot is sealed.')
                : (zh
                      ? '留空就是不加密的普通快照。忘了口令,加密的备份就打不开了。'
                      : 'Leave empty for a plain snapshot. A sealed one cannot '
                            'be opened without its password.'),
            style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('password-field'),
            controller: _password,
            autofocus: true,
            obscureText: true,
            cursorColor: palette.stamen,
            decoration: InputDecoration(
              labelText: zh ? '口令' : 'Password',
              labelStyle: TextStyle(color: palette.inkSoft),
            ),
            onSubmitted: (_) => widget.unlocking ? _submit() : null,
          ),
          if (!widget.unlocking) ...[
            const SizedBox(height: 8),
            TextField(
              key: const Key('password-confirm'),
              controller: _confirm,
              obscureText: true,
              cursorColor: palette.stamen,
              decoration: InputDecoration(
                labelText: zh ? '再输一遍' : 'Again',
                labelStyle: TextStyle(color: palette.inkSoft),
              ),
              onSubmitted: (_) => _submit(),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              key: const Key('password-error'),
              style: TextStyle(fontSize: 12, color: palette.warnDeep),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          key: const Key('password-cancel'),
          onPressed: () => Navigator.pop(context),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('password-ok'),
          onPressed: _submit,
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(widget.unlocking ? (zh ? '解锁' : 'Unlock') : (zh ? '确定' : 'OK')),
        ),
      ],
    );
  }
}
