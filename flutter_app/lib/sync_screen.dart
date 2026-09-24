// 同步 — two devices, one file, no server.
//
// The app never talks to anything. It writes a document and reads one back;
// carrying the file between devices is your job, and the folder you already
// sync is a better place for it than anything this app could build.
//
// The merge is the part worth having, and it is not here — it is
// `core::merge`, checked against the TypeScript by 7,043 parity cases. This
// screen picks a file, hands the bytes over, and says what happened.
//
// The order matters and is the whole flow: **merge first, then write back**.
// Writing this device's copy over the file without merging is how the other
// device's entries disappear, and it is the one mistake this screen is
// arranged to make difficult.

import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'src/rust/api/sync.dart' as sync;
import 'glass.dart';
import 'theme.dart';

class SyncScreen extends StatefulWidget {
  const SyncScreen({
    super.key,
    this.zh = true,
    this.pick,
    this.share,
    this.onChanged,
  });

  final bool zh;

  /// The document to merge. A test cannot drive a picker.
  final Future<String?> Function()? pick;

  /// Where the written document goes. A test cannot drive a share sheet.
  final Future<void> Function(String path)? share;

  /// Called after a merge changed something, so the ledger gets saved.
  final void Function()? onChanged;

  @override
  State<SyncScreen> createState() => _SyncScreenState();
}

class _SyncScreenState extends State<SyncScreen> {
  String? _flash;
  bool _bad = false;
  bool _busy = false;
  sync.SyncReport? _last;

  bool get zh => widget.zh;

  Future<String?> _pickDocument() async {
    // Bytes rather than a path, for the reason the import screen gives: a
    // picked document on Android is a content URI with a grant and no
    // filesystem path.
    final f = await FilePicker.pickFile();
    if (f == null) return null;
    return utf8.decode(await f.readAsBytes(), allowMalformed: true);
  }

  Future<void> _merge() async {
    setState(() {
      _flash = null;
      _busy = true;
    });
    try {
      final json = await (widget.pick ?? _pickDocument)();
      if (json == null) return; // cancelled, which is not a failure

      final r = sync.mergeDocument(json: json);
      if (r.error.isNotEmpty) {
        setState(() {
          _bad = true;
          _flash = r.error;
        });
        return;
      }

      widget.onChanged?.call();
      setState(() {
        _bad = false;
        _last = r;
        _flash = _summary(r);
      });
    } catch (e) {
      setState(() {
        _bad = true;
        _flash = zh ? '读不了这个文件：$e' : 'That file could not be read: $e';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _summary(sync.SyncReport r) {
    if (r.added == 0 && r.updated == 0 && r.accountsAdded == 0) {
      return zh ? '已经是一样的了，没有变化' : 'Already identical — nothing changed';
    }
    final parts = <String>[];
    if (r.added > 0) parts.add(zh ? '新增 ${r.added} 笔' : '${r.added} added');
    if (r.updated > 0) {
      parts.add(zh ? '更新 ${r.updated} 笔' : '${r.updated} updated');
    }
    if (r.accountsAdded > 0) {
      parts.add(
        zh ? '新增 ${r.accountsAdded} 个账户' : '${r.accountsAdded} accounts',
      );
    }
    final head = parts.join('，');
    if (r.conflicts == 0) return head;
    // Conflicts are resolved, not outstanding. Saying "冲突" without saying
    // "已处理" reads as a problem the user has to go and fix.
    return zh
        ? '$head（${r.conflicts} 笔两边都改过，已按最后修改时间取舍）'
        : '$head (${r.conflicts} edited on both sides, resolved by last edit)';
  }

  Future<void> _write() async {
    setState(() {
      _flash = null;
      _busy = true;
    });
    try {
      final doc = sync.syncDocument(now: DateTime.now().millisecondsSinceEpoch);
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/dahonghua-sync.json');
      await file.writeAsString(doc, flush: true);

      if (widget.share != null) {
        await widget.share!(file.path);
      } else {
        await SharePlus.instance.share(
          ShareParams(files: [XFile(file.path)], text: 'dahonghua-sync.json'),
        );
      }
      setState(() {
        _bad = false;
        _flash = zh
            ? '已写出，放进你同步的文件夹里'
            : 'Written — put it in your synced folder';
      });
    } catch (e) {
      setState(() {
        _bad = true;
        _flash = zh ? '写不出来：$e' : 'It could not be written: $e';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return ScrimScaffold(
      title: Text(zh ? '同步' : 'Sync'),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, headerInset(context) + 16, 16, 16),
        children: [
          Text(
            zh
                ? '这个 app 不联网同步。它写出一个文件，你把它放进任何一个会跟着你走的文件夹 —— '
                      '网盘、WebDAV、U 盘都行 —— 另一台设备读它、合并、再写回去。'
                : 'This app does not sync over a network. It writes a file; you '
                      'put it wherever your files already follow you — a cloud '
                      'folder, WebDAV, a USB stick — and the other device reads '
                      'it, merges, and writes it back.',
            key: const Key('sync-note'),
            style: TextStyle(color: p.inkSoft, height: 1.5),
          ),
          const SizedBox(height: 20),

          // Read first, in the layout as well as in the instructions. The
          // damaging order is write-then-read, and a screen that puts "write"
          // at the top is a screen that suggests it.
          _Step(
            n: '1',
            title: zh ? '先读进来' : 'Read it in first',
            body: zh
                ? '合并另一台设备写的文件。两边都改过的同一笔，按最后修改时间取舍；'
                      '这边删掉的不会被它带回来。'
                : 'Merge the file the other device wrote. Where both edited the '
                      'same entry the later edit wins; anything deleted here '
                      'stays deleted.',
            action: FilledButton(
              key: const Key('sync-merge'),
              onPressed: _busy ? null : _merge,
              child: Text(zh ? '选文件合并' : 'Choose a file'),
            ),
          ),
          const SizedBox(height: 16),
          _Step(
            n: '2',
            title: zh ? '再写回去' : 'Then write it back',
            body: zh
                ? '把合并后的账本写成文件。先合并再写，否则对面那台的记录会被这边覆盖掉。'
                : 'Write the merged ledger out. Merge before writing, or this '
                      "device's copy overwrites what the other one had.",
            action: FilledButton.tonal(
              key: const Key('sync-write'),
              onPressed: _busy ? null : _write,
              child: Text(zh ? '写出文件' : 'Write the file'),
            ),
          ),

          if (_flash != null) ...[
            const SizedBox(height: 20),
            Container(
              key: const Key('sync-flash'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                // One background, and the text carries the distinction. The
                // palette has no danger colour of its own — the flower is the
                // accent — and inventing one here would be a seventh theme
                // nobody chose.
                color: p.paperWarm,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                _flash!,
                style: TextStyle(color: _bad ? p.warnDeep : p.ink),
              ),
            ),
          ],

          if (_last != null && _last!.incoming > 0) ...[
            const SizedBox(height: 12),
            Text(
              zh
                  ? '文件里有 ${_last!.incoming} 笔'
                  : '${_last!.incoming} entries in that file',
              key: const Key('sync-incoming'),
              style: TextStyle(color: p.inkSoft, fontSize: 13),
            ),
          ],

          const SizedBox(height: 24),
          Text(
            zh
                ? '不同步的东西：汇率、预算、提醒、主题、锁 —— 这些更像是每台设备自己的设置。'
                      '账户会带过来，但改名不会。'
                : 'Not synced: rates, budgets, reminders, the theme, the lock — '
                      'those are per-device settings. Accounts come across; '
                      'renaming one does not.',
            key: const Key('sync-limits'),
            style: TextStyle(color: p.inkSoft, fontSize: 13, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({
    required this.n,
    required this.title,
    required this.body,
    required this.action,
  });

  final String n;
  final String title;
  final String body;
  final Widget action;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 12,
                backgroundColor: p.paperWarm,
                child: Text(
                  n,
                  style: TextStyle(
                    color: p.hibiscus,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 8),
          Text(body, style: TextStyle(color: p.inkSoft, height: 1.4)),
          const SizedBox(height: 12),
          Align(alignment: Alignment.centerLeft, child: action),
        ],
      ),
    );
  }
}
