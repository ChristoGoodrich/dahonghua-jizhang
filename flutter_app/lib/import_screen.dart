// 导入账单 — an Alipay or WeChat CSV export, read and matched against the ledger.
//
// Nothing is written until the user presses the button. The preview is the
// whole point of the screen: an import that silently duplicated a month of
// spending would be discovered a long way from here.
//
// Three things this screen is careful about, all of them things the shipping
// app learned the hard way:
//
//   * The ledger is read at the moment of the pick, not when the screen opened.
//     A row recorded in between is a row the dedup must see.
//   * The wall time in the file becomes an instant HERE, because a zone is the
//     platform's to know. Rust hands over six numbers and no opinion.
//   * Duplicates are shown, not hidden. "18 rows, 12 of them already here" is
//     the sentence a user needs; a list of 6 is not.
//
// The file's encoding is not asked about. 微信 writes UTF-8 with a BOM and
// 支付宝 writes GBK, and `decode_bill_text` tells them apart by looking — which
// is why the GBK table was ported at all.

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
// flutter_rust_bridge ships its own Int64List; the one in dart:typed_data is a
// different type with the same name, and the bridge will not take it.
import 'package:flutter_rust_bridge/flutter_rust_bridge.dart' show Int64List;

import 'src/rust/api/imports.dart' as imports;
import 'src/rust/api/store.dart' as store;
import 'glass.dart';
import 'theme.dart';

/// How many rows the list shows before it stops and says how many are left.
const _previewLimit = 15;

class ImportScreen extends StatefulWidget {
  const ImportScreen({super.key, this.zh = true, this.onImported, this.pick});

  final bool zh;

  /// Rows landed in the ledger; the file needs writing and the lists rebuilding.
  final VoidCallback? onImported;

  /// The file bytes, for a test that has no document picker to drive.
  final Future<List<int>?> Function()? pick;

  @override
  State<ImportScreen> createState() => _ImportScreenState();
}

class _ImportScreenState extends State<ImportScreen> {
  imports.ImportPreview? _preview;
  String? _flash;
  bool _busy = false;

  Future<List<int>?> _pickBytes() async {
    // Bytes, not a path. A picked document on Android is a content URI that
    // this app has a grant for and no filesystem path to, and the whole point
    // of reading it here is that its encoding is not known yet.
    final f = await FilePicker.pickFile();
    return f == null ? null : await f.readAsBytes();
  }

  Future<void> _pick() async {
    setState(() {
      _flash = null;
      _busy = true;
    });
    try {
      final bytes = await (widget.pick ?? _pickBytes)();
      if (bytes == null) return; // cancelled — not a failure, and says nothing
      // Read the ledger now rather than in initState: the dedup's answer is
      // only as good as the entries it was given.
      final live = store.liveEntries();
      final p = imports.previewBills(
        bytes: bytes,
        ids: live.map((e) => e.id).toList(),
        daysOf: live
            .map((e) => _day(DateTime.fromMillisecondsSinceEpoch(e.ts)))
            .toList(),
      );
      if (mounted) setState(() => _preview = p);
    } catch (_) {
      if (mounted) {
        setState(() {
          _preview = null;
          _flash = widget.zh ? '这个文件读不了' : 'That file could not be read';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  static String _day(DateTime d) => '${d.year}-${d.month}-${d.day}';

  void _confirm() {
    final p = _preview;
    if (p == null) return;
    final fresh = p.candidates.where((c) => !c.dup).toList();
    if (fresh.isEmpty) return;

    final now = DateTime.now().millisecondsSinceEpoch;
    // Six numbers into an instant. `DateTime` is local, which is the point —
    // a bill's 12:30 is 12:30 where the phone is, not where the core is.
    final ts = [
      for (final c in fresh)
        DateTime(c.y, c.mo, c.d, c.h, c.mi, c.s).millisecondsSinceEpoch,
    ];
    final n = store.importBills(
      io: fresh.map((c) => c.io).toList(),
      cat: fresh.map((c) => c.cat).toList(),
      amt: fresh.map((c) => c.amt).toList(),
      note: fresh.map((c) => c.note).toList(),
      ts: Int64List.fromList(ts),
      ids: [for (var i = 0; i < fresh.length; i++) 'b${now}i$i'],
      now: now,
    );

    setState(() {
      _preview = null;
      _flash = widget.zh ? '已导入 $n 条' : 'Imported $n';
    });
    if (n > 0) widget.onImported?.call();
  }

  String _sourceLabel(String src) {
    final zh = widget.zh;
    return switch (src) {
      'alipay' => zh ? '支付宝' : 'Alipay',
      'wechat' => zh ? '微信支付' : 'WeChat Pay',
      _ => zh ? '通用 CSV' : 'Generic CSV',
    };
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    final p = _preview;
    return ScrimScaffold(
      title: Text(
        zh ? '导入账单' : 'Import bills',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
        children: [
          Text(
            zh
                ? '支付宝或微信导出的账单 CSV。编码不用管,认得出来。'
                : 'A bill export from Alipay or WeChat. The encoding sorts '
                      'itself out.',
            style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            key: const Key('pick-bill-file'),
            onPressed: _busy ? null : _pick,
            icon: const Icon(Icons.upload_file_outlined, size: 18),
            label: Text(zh ? '选择文件' : 'Choose a file'),
          ),
          if (_busy) ...[
            const SizedBox(height: 18),
            const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          ],
          if (_flash != null) ...[
            const SizedBox(height: 14),
            Text(
              _flash!,
              key: const Key('import-flash'),
              style: TextStyle(fontSize: 13, color: palette.leafDeep),
            ),
          ],
          if (p != null) ...[
            const SizedBox(height: 18),
            if (!p.ok)
              Text(
                zh
                    ? '没找到表头。这份文件不像支付宝或微信导出的账单。'
                    : 'No header row. This does not look like a bill export.',
                key: const Key('import-no-header'),
                style: TextStyle(fontSize: 13, color: palette.hibiscusDeep),
              )
            else
              ..._summary(p, zh),
          ],
        ],
      ),
    );
  }

  List<Widget> _summary(imports.ImportPreview p, bool zh) {
    final fresh = p.candidates.where((c) => !c.dup).toList();
    return [
      Row(
        children: [
          Text(
            zh ? '来源' : 'Source',
            style: TextStyle(fontSize: 12, color: palette.inkSoft),
          ),
          const SizedBox(width: 8),
          Container(
            key: const Key('import-source'),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: palette.hibiscus.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              _sourceLabel(p.source),
              style: TextStyle(fontSize: 12, color: palette.hibiscus),
            ),
          ),
        ],
      ),
      const SizedBox(height: 14),
      Row(
        children: [
          Expanded(
            child: _stat(
              zh ? '支出' : 'Expense',
              p.expCount,
              p.expSum,
              palette.ink,
              'import-exp',
            ),
          ),
          Expanded(
            child: _stat(
              zh ? '收入' : 'Income',
              p.incCount,
              p.incSum,
              palette.leafDeep,
              'import-inc',
            ),
          ),
        ],
      ),
      const SizedBox(height: 10),
      Text(
        key: const Key('import-meta'),
        zh
            ? '${p.candidates.length} 行,其中 ${p.dupCount} 行已经记过'
                  '${p.skipped > 0 ? ",${p.skipped} 行读不了" : ""}'
            : '${p.candidates.length} rows · ${p.dupCount} already recorded'
                  '${p.skipped > 0 ? " · ${p.skipped} unreadable" : ""}',
        style: TextStyle(fontSize: 12, color: palette.inkSoft),
      ),
      if (p.errors.isNotEmpty) ...[
        const SizedBox(height: 12),
        Text(
          zh ? '读不了的行' : 'Rows that would not read',
          style: TextStyle(fontSize: 12, color: palette.hibiscusDeep),
        ),
        for (final e in p.errors.take(5))
          Text(
            '${zh ? '第' : 'line '}${e.row}${zh ? ' 行' : ''} · ${e.reason}',
            style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
          ),
        if (p.errors.length > 5)
          Text(
            zh ? '还有 ${p.errors.length - 5} 行' : '${p.errors.length - 5} more',
            style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
          ),
      ],
      const SizedBox(height: 16),
      // Every row, duplicates included and marked. A list that quietly dropped
      // them would leave the count in the meta line unexplained.
      for (final c in p.candidates.take(_previewLimit)) _row(c, zh),
      if (p.candidates.length > _previewLimit)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            zh
                ? '还有 ${p.candidates.length - _previewLimit} 行'
                : '${p.candidates.length - _previewLimit} more',
            style: TextStyle(fontSize: 12, color: palette.inkSoft),
          ),
        ),
      const SizedBox(height: 18),
      FilledButton(
        key: const Key('confirm-import'),
        onPressed: fresh.isEmpty ? null : _confirm,
        child: Text(
          fresh.isEmpty
              ? (zh ? '没有新的一笔' : 'Nothing new')
              : (zh ? '导入 ${fresh.length} 条' : 'Import ${fresh.length}'),
        ),
      ),
    ];
  }

  Widget _stat(String label, int n, double sum, Color tint, String k) => Column(
    key: Key(k),
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        '$n',
        style: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          color: tint,
        ),
      ),
      Text(label, style: TextStyle(fontSize: 12, color: palette.inkSoft)),
      Text(sum.toStringAsFixed(2), style: TextStyle(fontSize: 13, color: tint)),
    ],
  );

  Widget _row(imports.CandidateView c, bool zh) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                c.note.isEmpty ? (zh ? '(无备注)' : '(no note)') : c.note,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13.5,
                  color: c.dup ? palette.inkSoft : palette.ink,
                ),
              ),
              Text(
                '${c.mo}/${c.d} · ${c.cat}'
                '${c.dup ? (zh ? " · 已记过" : " · already here") : ""}',
                style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
              ),
            ],
          ),
        ),
        Text(
          c.amt.toStringAsFixed(2),
          style: TextStyle(
            fontSize: 14,
            color: c.dup
                ? palette.inkSoft
                : (c.io == 'inc' ? palette.leafDeep : palette.ink),
          ),
        ),
      ],
    ),
  );
}
