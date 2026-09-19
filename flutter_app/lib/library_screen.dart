// 标签 and 模板 — two small screens that share a file because they share a
// shape: a list of named things you add and remove, over `catalog.rs`.
//
// Tags are of two kinds and they behave differently, which is the substance
// here. An ordinary tag is just a label. A **ledger** is a separate book, and
// deleting one would orphan every entry filed under it — so a ledger is
// archived first and only deleted once archived. Two more rules the screens do
// not get to re-decide:
//
//   * removing the ACTIVE ledger clears the filter, so the list does not stay
//     filtered by something that no longer exists;
//   * the archived list is stored as absent rather than as an empty array,
//     because an explicit `[]` survives a sync round-trip as a field that is
//     set.

import 'package:flutter/material.dart';

import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/money.dart' as money;
import 'glass.dart';
import 'empty_note.dart';
import 'theme.dart';

class TagsScreen extends StatefulWidget {
  const TagsScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;
  final VoidCallback? onChanged;

  @override
  State<TagsScreen> createState() => _TagsScreenState();
}

class _TagsScreenState extends State<TagsScreen> {
  List<String> _tags = const [];
  List<String> _active = const [];
  List<String> _archived = const [];

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    setState(() {
      _tags = catalog.tags();
      _active = catalog.pickableLedgers(keep: catalog.currentLedger());
      _archived = catalog.archivedLedgers();
    });
  }

  void _changed() {
    widget.onChanged?.call();
    _reload();
  }

  Future<void> _add(String kind) async {
    final name = await showDialog<String>(
      context: context,
      builder: (_) => _NameDialog(
        zh: widget.zh,
        title: kind == 'ledger'
            ? (widget.zh ? '新建账本' : 'New ledger')
            : (widget.zh ? '新建标签' : 'New tag'),
        label: widget.zh ? '名称' : 'Name',
      ),
    );
    if (name == null) return;
    catalog.addTag(kind: kind, name: name);
    _changed();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return ScrimScaffold(
      title: Text(
        zh ? '标签与账本' : 'Tags and ledgers',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
        children: [
          _head(zh ? '标签' : 'Tags', 'add-tag', () => _add('normal'), zh),
          _chips(
            _tags,
            empty: zh ? '还没有标签' : 'No tags yet',
            emptyKey: 'no-tags',
            builder: (g) => _chip(
              g,
              keyName: 'tag-$g',
              onRemove: () {
                catalog.removeTag(kind: 'normal', name: g);
                _changed();
              },
            ),
          ),
          const SizedBox(height: 24),
          _head(zh ? '账本' : 'Ledgers', 'add-ledger', () => _add('ledger'), zh),
          Padding(
            padding: const EdgeInsets.only(left: 2, bottom: 8),
            child: Text(
              zh
                  ? '账本先归档,归档后才能删除 — 删掉的账本会让它下面的记录无处可归'
                  : 'A ledger archives first and deletes only once archived.',
              style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
            ),
          ),
          _chips(
            _active,
            empty: zh ? '还没有账本' : 'No ledgers yet',
            emptyKey: 'no-ledgers',
            builder: (l) => _chip(
              l,
              keyName: 'ledger-$l',
              icon: Icons.archive_outlined,
              tone: palette.stamen,
              onRemove: () {
                catalog.archiveLedger(name: l, archive: true);
                _changed();
              },
            ),
          ),
          if (_archived.isNotEmpty) ...[
            const SizedBox(height: 18),
            _head(zh ? '已归档' : 'Archived', null, null, zh),
            _chips(
              _archived,
              empty: '',
              emptyKey: 'no-archived',
              builder: (l) => _archivedChip(l, zh),
            ),
          ],
        ],
      ),
    );
  }

  Widget _head(String title, String? key, VoidCallback? onAdd, bool zh) =>
      Padding(
        padding: const EdgeInsets.only(left: 2, bottom: 10, top: 8),
        child: Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: palette.inkSoft,
                ),
              ),
            ),
            if (key != null)
              GestureDetector(
                key: Key(key),
                onTap: onAdd,
                child: Text(
                  zh ? '添加' : 'Add',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: palette.hibiscus,
                  ),
                ),
              ),
          ],
        ),
      );

  Widget _chips(
    List<String> list, {
    required String empty,
    required String emptyKey,
    required Widget Function(String) builder,
  }) => list.isEmpty
      ? Padding(
          padding: const EdgeInsets.only(left: 2),
          child: Text(
            empty,
            key: Key(emptyKey),
            style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
          ),
        )
      : Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [for (final x in list) builder(x)],
        );

  Widget _chip(
    String name, {
    required String keyName,
    required VoidCallback onRemove,
    IconData icon = Icons.close,
    Color? tone,
  }) => Container(
    key: Key(keyName),
    padding: const EdgeInsets.only(left: 12, right: 4, top: 5, bottom: 5),
    decoration: BoxDecoration(
      color: palette.card,
      borderRadius: BorderRadius.circular(Rad.pill),
      border: Border.all(color: palette.line),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          name,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: palette.ink,
          ),
        ),
        IconButton(
          key: Key('$keyName-remove'),
          constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
          padding: EdgeInsets.zero,
          iconSize: 15,
          icon: Icon(icon, color: tone ?? palette.inkSoft),
          onPressed: onRemove,
        ),
      ],
    ),
  );

  /// An archived ledger can be brought back or, only now, deleted.
  Widget _archivedChip(String l, bool zh) => Container(
    key: Key('archived-$l'),
    padding: const EdgeInsets.only(left: 12, right: 2, top: 5, bottom: 5),
    decoration: BoxDecoration(
      color: palette.paperWarm,
      borderRadius: BorderRadius.circular(Rad.pill),
      border: Border.all(color: palette.line),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(l, style: TextStyle(fontSize: 12.5, color: palette.inkSoft)),
        IconButton(
          key: Key('archived-$l-restore'),
          tooltip: zh ? '取消归档' : 'Unarchive',
          constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
          padding: EdgeInsets.zero,
          iconSize: 15,
          icon: Icon(Icons.unarchive_outlined, color: palette.inkSoft),
          onPressed: () {
            catalog.archiveLedger(name: l, archive: false);
            _changed();
          },
        ),
        IconButton(
          key: Key('archived-$l-delete'),
          tooltip: zh ? '删除' : 'Delete',
          constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
          padding: EdgeInsets.zero,
          iconSize: 15,
          icon: Icon(Icons.delete_outline, color: palette.inkSoft),
          onPressed: () {
            catalog.removeTag(kind: 'ledger', name: l);
            _changed();
          },
        ),
      ],
    ),
  );
}

/// The pinned entries the record sheet offers as one-tap chips.
class TemplatesScreen extends StatefulWidget {
  const TemplatesScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;
  final VoidCallback? onChanged;

  @override
  State<TemplatesScreen> createState() => _TemplatesScreenState();
}

class _TemplatesScreenState extends State<TemplatesScreen> {
  List<catalog.TemplateView> _rows = const [];

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() => setState(() => _rows = catalog.templates());

  void _changed() {
    widget.onChanged?.call();
    _reload();
  }

  /// Ask first, the way 订阅 and 账户 already did.
  ///
  /// This one deleted on the tap, with no dialog and no undo. That was
  /// survivable while the icon was red and loud; once every resting delete
  /// icon went grey — red belongs to the moment of decision, not to the list
  /// — a quiet icon that deletes without asking is the easiest thing on the
  /// screen to hit by accident. A template is cheap to make again, but three
  /// screens with one delete gesture should behave one way.
  Future<void> _confirmDelete(catalog.TemplateView t) async {
    final zh = widget.zh;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('tpl-delete-dialog'),
        backgroundColor: palette.card,
        title: Text(
          zh ? '删除模板' : 'Delete template',
          style: TextStyle(fontSize: 16, color: palette.ink),
        ),
        content: Text(
          zh
              ? '「${t.name}」不再出现在记一笔里。已经记下的不受影响。'
              : '"${t.name}" leaves the record sheet. Entries already made '
                    'are kept.',
          style: TextStyle(fontSize: 14, color: palette.inkSoft),
        ),
        actions: [
          TextButton(
            key: const Key('tpl-delete-cancel'),
            onPressed: () => Navigator.pop(ctx, false),
            style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
            child: Text(zh ? '取消' : 'Cancel'),
          ),
          TextButton(
            key: const Key('tpl-delete-ok'),
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
            child: Text(zh ? '删除' : 'Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    catalog.removeTemplate(id: t.id);
    _changed();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return ScrimScaffold(
      title: Text(
        zh ? '模板' : 'Templates',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      body: _rows.isEmpty
          ? ListView(
              padding: EdgeInsets.only(top: headerInset(context)),
              children: [
                EmptyNote(
                  key: const Key('no-templates'),
                  icon: Icons.bolt_outlined,
                  text: zh ? '还没有模板' : 'No templates yet',
                  hint: zh
                      ? '在记一笔里长按「保存」,就能存成模板'
                      : 'Long-press Save on the record sheet to pin one here',
                ),
              ],
            )
          : ListView(
              padding: EdgeInsets.fromLTRB(
                22,
                headerInset(context) + 6,
                22,
                120,
              ),
              children: [for (final t in _rows) _row(t, zh)],
            ),
    );
  }

  Widget _row(catalog.TemplateView t, bool zh) {
    final c = catalog.catOf(io: t.io, key: t.cat, custom: const []);
    final name = t.name.isEmpty ? catalog.catName(cat: c, zh: zh) : t.name;
    final note = t.note ?? '';
    return Padding(
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
            Container(
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: parseHex(c.c, opacity: 0.13),
                borderRadius: BorderRadius.circular(Rad.sm),
              ),
              child: Text(c.e, style: const TextStyle(fontSize: 18)),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    key: Key('tpl-${t.id}-name'),
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: palette.ink,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    note.isEmpty
                        ? catalog.catName(cat: c, zh: zh)
                        : '${catalog.catName(cat: c, zh: zh)} · $note',
                    style: TextStyle(fontSize: 12, color: palette.inkSoft),
                  ),
                ],
              ),
            ),
            Text(
              money.fmtSigned(n: t.amt, io: t.io),
              key: Key('tpl-${t.id}-amt'),
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                fontFeatures: tabular,
                color: t.io == 'exp' ? palette.ink : palette.leafDeep,
              ),
            ),
            IconButton(
              key: Key('tpl-${t.id}-delete'),
              tooltip: zh ? '删除' : 'Delete',
              icon: Icon(
                Icons.delete_outline,
                size: 20,
                color: palette.inkSoft,
              ),
              onPressed: () => _confirmDelete(t),
            ),
          ],
        ),
      ),
    );
  }
}

/// One field, one answer. Returns the trimmed name, or null when cancelled.
class _NameDialog extends StatefulWidget {
  const _NameDialog({
    required this.zh,
    required this.title,
    required this.label,
  });

  final bool zh;
  final String title;
  final String label;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _submit() {
    // The shipping form strips angle brackets and caps the length at sixteen.
    // Both are here rather than in the core because they are about what a chip
    // can hold, not about what a tag means.
    final name = _name.text.trim().replaceAll(RegExp('[<>]'), '');
    final capped = name.length > 16 ? name.substring(0, 16) : name;
    if (capped.isEmpty) return;
    Navigator.pop(context, capped);
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('name-dialog'),
      backgroundColor: palette.card,
      title: Text(
        widget.title,
        style: TextStyle(fontSize: 16, color: palette.ink),
      ),
      content: TextField(
        key: const Key('name-field'),
        controller: _name,
        autofocus: true,
        cursorColor: palette.stamen,
        decoration: InputDecoration(
          labelText: widget.label,
          labelStyle: TextStyle(color: palette.inkSoft),
          floatingLabelStyle: TextStyle(color: palette.stamen),
          focusedBorder: UnderlineInputBorder(
            borderSide: BorderSide(color: palette.stamen, width: 2),
          ),
        ),
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        TextButton(
          key: const Key('name-cancel'),
          onPressed: () => Navigator.pop(context),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('name-ok'),
          onPressed: _submit,
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(zh ? '确定' : 'OK'),
        ),
      ],
    );
  }
}
