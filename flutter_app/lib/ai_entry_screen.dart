// 一句话记账 — a sentence, or a picture, into entries you look over first.
//
// The shipping app filled the record sheet from one sentence. This reads every
// entry in it — 午饭35 打车12，昨天超市买菜128 is three — shows them as a
// list to tick and correct, and writes the ticked ones through the same form
// the sheet uses. A picture of a receipt or a payment screenshot goes the same
// way, when AI is on.
//
// The reading is `core::ai`'s: on the phone always, by the model when the user
// turned it on and gave it a key. Which one read it is said under the list, so
// nobody has to wonder whether their sentence left the phone.

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'ai.dart';
import 'date_field.dart';
import 'glass.dart';
import 'prompt.dart';
import 'src/rust/api/ai.dart' as ai;
import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/money.dart' as money;
import 'tap.dart';
import 'theme.dart';

/// Where a picture comes from. The camera or the gallery by default; a test
/// hands one over.
typedef PickPicture = Future<Uint8List?> Function(ImageSource source);

Future<Uint8List?> _pick(ImageSource source) async {
  final f = await ImagePicker().pickImage(
    source: source,
    // Enough to read a receipt, small enough to send over mobile data: a
    // phone photo is several megabytes and the words on it are not.
    maxWidth: 1600,
    maxHeight: 1600,
    imageQuality: 80,
  );
  return f?.readAsBytes();
}

class AiEntryScreen extends StatefulWidget {
  const AiEntryScreen({
    super.key,
    this.zh = true,
    this.onSaved,
    this.pick,
    this.initialText,
  });

  final bool zh;

  /// Rows were written — their ids, so the shell can offer 撤销.
  final ValueChanged<List<String>>? onSaved;

  final PickPicture? pick;
  final String? initialText;

  @override
  State<AiEntryScreen> createState() => _AiEntryScreenState();
}

class _Row {
  _Row(this.d);
  ai.DraftView d;
  bool on = true;
}

class _AiEntryScreenState extends State<AiEntryScreen> {
  late final _text = TextEditingController(text: widget.initialText ?? '');
  final _rows = <_Row>[];
  bool _busy = false;
  bool _ready = false;

  /// Said under the list: who read it, or why the model did not.
  String? _notice;
  bool _noticeBad = false;

  bool get _zh => widget.zh;

  @override
  void initState() {
    super.initState();
    Ai.ready().then((r) {
      if (mounted) setState(() => _ready = r);
    });
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _show(List<ai.DraftView> drafts, {String? notice, bool bad = false}) {
    setState(() {
      _rows
        ..clear()
        ..addAll(drafts.map(_Row.new));
      final hint = _zh
          ? '没读到金额。试试这样写：午饭35 打车12'
          : 'No amount found. Try: lunch 35, taxi 12';
      // Nothing read: how to write it is the useful thing to say — after
      // the failure, when there was one, and instead of who read it.
      _notice = drafts.isEmpty
          ? (bad && notice != null ? '$notice\n$hint' : hint)
          : notice;
      _noticeBad = bad || drafts.isEmpty;
    });
  }

  Future<void> _read() async {
    final text = _text.text.trim();
    if (text.isEmpty || _busy) return;
    FocusScope.of(context).unfocus();
    setState(() => _busy = true);
    final r = await Ai.read(text, zh: _zh);
    if (!mounted) return;
    setState(() => _busy = false);
    final f = r.failure;
    _show(
      r.drafts,
      notice: f != null
          ? (_zh
                ? '${failureText(f, true)}，这次用本机读的'
                : '${failureText(f, false)} — read on the phone instead')
          : r.byAi
          ? (_zh ? 'AI 读的，记下之前看一眼' : 'Read by AI — look it over')
          : (_zh ? '本机读的，没有联网' : 'Read on the phone, offline'),
      bad: f != null,
    );
  }

  Future<void> _picture(ImageSource source) async {
    if (_busy) return;
    if (!_ready) {
      setState(() {
        _notice = _zh
            ? '看图要用 AI，先在 设置 › AI 助手 里开启并填好 Key'
            : 'Reading a picture needs AI — turn it on in Settings';
        _noticeBad = true;
      });
      return;
    }
    final bytes = await (widget.pick ?? _pick)(source);
    if (bytes == null || !mounted) return;
    setState(() => _busy = true);
    final r = await Ai.readPicture(bytes, zh: _zh);
    if (!mounted) return;
    setState(() => _busy = false);
    final f = r.failure;
    _show(
      r.drafts,
      notice: f != null
          ? failureText(f, _zh)
          : r.drafts.isEmpty
          ? (_zh ? '这张图里没找到能记的账' : 'Nothing to record in that picture')
          : (_zh ? 'AI 从图里读的，记下之前看一眼' : 'Read from the picture — look it over'),
      bad: f != null,
    );
  }

  void _save() {
    final chosen = [
      for (final r in _rows)
        if (r.on) r.d,
    ];
    if (chosen.isEmpty) return;
    final ids = saveDrafts(chosen);
    widget.onSaved?.call(ids);
    Navigator.of(context).pop(ids);
  }

  Future<void> _editAmount(_Row r) async {
    final t = await prompt(
      context,
      title: _zh ? '金额' : 'Amount',
      ok: _zh ? '好' : 'OK',
      cancel: _zh ? '取消' : 'Cancel',
      initial: money.fmt(n: r.d.amt, symbol: ''),
      keyboard: const TextInputType.numberWithOptions(decimal: true),
      fieldKey: const Key('draft-amt-field'),
      okKey: const Key('draft-amt-ok'),
    );
    final v = double.tryParse((t ?? '').replaceAll(',', ''));
    if (v == null || v <= 0 || !mounted) return;
    setState(() => r.d = _with(r.d, amt: v));
  }

  Future<void> _editCategory(_Row r) async {
    final cats = catalog.allCats(io: r.d.io, custom: const []);
    final k = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: palette.card,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(14, 16, 14, 10),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final c in cats)
                Tap(
                  key: Key('draft-cat-${c.k}'),
                  radius: Rad.md,
                  onTap: () => Navigator.pop(ctx, c.k),
                  child: Container(
                    width: 78,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    decoration: BoxDecoration(
                      color: parseHex(
                        c.c,
                      ).withValues(alpha: palette.isDark ? 0.19 : 0.12),
                      borderRadius: BorderRadius.circular(Rad.md),
                    ),
                    child: Column(
                      children: [
                        Text(c.e, style: const TextStyle(fontSize: 21)),
                        const SizedBox(height: 4),
                        Text(
                          catalog.catName(cat: c, zh: _zh),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 11.5, color: palette.ink),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
    if (k == null || !mounted) return;
    final c = cats.firstWhere((c) => c.k == k);
    setState(
      () => r.d = _with(
        r.d,
        cat: k,
        emoji: c.e,
        name: catalog.catName(cat: c, zh: _zh),
        color: c.c,
      ),
    );
  }

  static ai.DraftView _with(
    ai.DraftView d, {
    double? amt,
    String? cat,
    String? emoji,
    String? name,
    String? color,
  }) => ai.DraftView(
    io: d.io,
    cat: cat ?? d.cat,
    amt: amt ?? d.amt,
    note: d.note,
    day: d.day,
    emoji: emoji ?? d.emoji,
    name: name ?? d.name,
    color: color ?? d.color,
  );

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final zh = _zh;
    final chosen = _rows.where((r) => r.on).length;
    return ScrimScaffold(
      title: Text(
        zh ? '一句话记账' : 'Quick entry',
        style: TextStyle(
          color: p.ink,
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
      ),
      bottomNavigationBar: _rows.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(22, 8, 22, 12),
                child: FilledButton(
                  key: const Key('ai-save'),
                  onPressed: chosen == 0 ? null : _save,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(50),
                  ),
                  child: Text(
                    zh ? '记下 $chosen 笔' : 'Record $chosen',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 40),
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(16, 10, 10, 10),
            decoration: BoxDecoration(
              color: p.card,
              borderRadius: BorderRadius.circular(Rad.lg),
              border: Border.all(color: p.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  key: const Key('ai-text'),
                  controller: _text,
                  minLines: 2,
                  maxLines: 5,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _read(),
                  style: TextStyle(fontSize: 16, height: 1.45, color: p.ink),
                  decoration: InputDecoration(
                    border: InputBorder.none,
                    hintText: zh
                        ? '午饭35 打车12，昨天超市买菜128\n也可以用输入法的语音说'
                        : 'lunch 35, taxi 12, groceries yesterday 128',
                    hintStyle: TextStyle(color: p.inkSoft, height: 1.45),
                  ),
                ),
                Row(
                  children: [
                    _tool(
                      'ai-camera',
                      Icons.photo_camera_outlined,
                      zh ? '拍小票' : 'Camera',
                      () => _picture(ImageSource.camera),
                    ),
                    _tool(
                      'ai-gallery',
                      Icons.photo_outlined,
                      zh ? '截图/相册' : 'Gallery',
                      () => _picture(ImageSource.gallery),
                    ),
                    const Spacer(),
                    FilledButton.icon(
                      key: const Key('ai-read'),
                      onPressed: _busy ? null : _read,
                      icon: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.auto_awesome, size: 18),
                      label: Text(zh ? '识别' : 'Read'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              _ready
                  ? (zh
                        ? 'AI 已开启：只发送你输入的这句话或选的这张图'
                        : 'AI is on: only this sentence or picture is sent')
                  : (zh
                        ? '在本机识别，不联网。开启 AI 后能读得更准、还能看图'
                        : 'Read on the phone, offline. Turn AI on to read pictures too'),
              key: const Key('ai-mode'),
              style: TextStyle(fontSize: 12, color: p.inkSoft),
            ),
          ),
          if (_notice != null) ...[
            const SizedBox(height: 14),
            Text(
              _notice!,
              key: const Key('ai-notice'),
              style: TextStyle(
                fontSize: 13,
                color: _noticeBad ? p.warnDeep : p.inkSoft,
              ),
            ),
          ],
          if (_rows.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              decoration: BoxDecoration(
                color: p.card,
                borderRadius: BorderRadius.circular(Rad.lg),
                border: Border.all(color: p.line),
              ),
              child: Column(
                children: [
                  for (final (i, r) in _rows.indexed) ...[
                    if (i > 0) Divider(height: 1, color: p.line, indent: 60),
                    _draft(i, r),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _tool(String key, IconData icon, String label, VoidCallback onTap) =>
      Tap(
        key: Key(key),
        filled: false,
        radius: Rad.pill,
        onTap: onTap,
        semanticLabel: label,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Row(
            children: [
              Icon(icon, size: 18, color: palette.inkSoft),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
              ),
            ],
          ),
        ),
      );

  Widget _draft(int i, _Row r) {
    final p = palette;
    final d = r.d;
    final day = d.day == null
        ? (_zh ? '今天' : 'Today')
        : () {
            final x = d.day!.split('-').map(int.parse).toList();
            return dayLabel(DateTime(x[0], x[1], x[2]), _zh);
          }();
    final tone = parseHex(d.color);
    return Opacity(
      opacity: r.on ? 1 : 0.45,
      child: Padding(
        key: Key('draft-$i'),
        padding: const EdgeInsets.fromLTRB(4, 8, 14, 8),
        child: Row(
          children: [
            Checkbox(
              key: Key('draft-$i-on'),
              value: r.on,
              onChanged: (v) => setState(() => r.on = v ?? false),
            ),
            Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: tone.withValues(alpha: p.isDark ? 0.19 : 0.12),
                borderRadius: BorderRadius.circular(11),
              ),
              child: Text(d.emoji, style: const TextStyle(fontSize: 18)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Tap(
                key: Key('draft-$i-cat'),
                filled: false,
                onTap: () => _editCategory(r),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          d.name,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: p.ink,
                          ),
                        ),
                        Icon(Icons.expand_more, size: 16, color: p.inkSoft),
                      ],
                    ),
                    Text(
                      [if (d.note.isNotEmpty) d.note, day].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: p.inkSoft),
                    ),
                  ],
                ),
              ),
            ),
            Tap(
              key: Key('draft-$i-amt'),
              filled: false,
              onTap: () => _editAmount(r),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Text(
                  money.fmtSigned(n: d.amt, io: d.io),
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    fontFeatures: tabular,
                    color: d.io == 'inc' ? p.leafDeep : p.ink,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
