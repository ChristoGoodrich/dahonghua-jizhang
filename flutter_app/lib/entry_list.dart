// The entry list, in Dart, over the Rust ledger.
//
// The first real screen of the Flutter build, and the point of it is what is
// *absent*: no sort, no day bucketing, no per-day totals, no "is this today",
// no rounding, no category fallback. Every one of those is a decision the Rust
// core makes and the parity corpus pins. What is here is rows, colours, taps
// and a scroll position.
//
// The division is the same one `list.rs` states: the ordering and the sums are
// decisions; spelling a date is `Intl`, which belongs to the platform, so the
// core answers *which* of three names a day takes and this file writes it.

import 'package:flutter/material.dart';

import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/store.dart' as store;
import 'reimburse_screen.dart';
import 'theme.dart';

/// `y-m-d` for a local calendar day. The timezone is the platform's, so this
/// is where an instant becomes a day — never on the other side of the boundary.
String localDay(DateTime d) => '${d.year}-${d.month}-${d.day}';

/// The day names the core does not spell.
String dayHeading(String label, String ymd, bool zh) {
  if (label == 'today') return zh ? '今天' : 'Today';
  if (label == 'yesterday') return zh ? '昨天' : 'Yesterday';
  final p = ymd.split('-').map(int.parse).toList();
  final d = DateTime(p[0], p[1], p[2]);
  const zhWeek = ['一', '二', '三', '四', '五', '六', '日'];
  const enWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const enMonth = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return zh
      ? '${d.month}月${d.day}日 周${zhWeek[d.weekday - 1]}'
      : '${enWeek[d.weekday - 1]}, ${enMonth[d.month - 1]} ${d.day}';
}

class EntryListScreen extends StatefulWidget {
  const EntryListScreen({
    super.key,
    this.zh = true,
    this.onEdit,
    this.onChanged,
  });

  final bool zh;

  /// Open a row for editing. The shell decides where that happens.
  final void Function(String id)? onEdit;

  /// The ledger changed and should be written. Separate from `onEdit` because
  /// a delete changes it and an edit request does not.
  final VoidCallback? onChanged;

  @override
  State<EntryListScreen> createState() => _EntryListScreenState();
}

class _EntryListScreenState extends State<EntryListScreen> {
  List<store.ListItem> _items = const [];
  Map<String, store.EntryView> _byId = const {};

  @override
  void initState() {
    super.initState();
    _reload();
  }

  /// Ask the store what to draw.
  ///
  /// Two calls, not two hundred: the ids and their local days go over once, and
  /// the grouped, totalled, labelled result comes back. Nothing is cached on
  /// this side beyond one frame's worth, so there is no second copy of the
  /// ledger to fall out of step with.
  void _reload() {
    final live = store.liveEntries();
    final items = store.listItems(
      ids: live.map((e) => e.id).toList(),
      days: live
          .map((e) => localDay(DateTime.fromMillisecondsSinceEpoch(e.ts)))
          .toList(),
      today: localDay(DateTime.now()),
      columns: 1,
    );
    setState(() {
      _byId = {for (final e in live) e.id: e};
      _items = items;
    });
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return Scaffold(
      backgroundColor: palette.paper,
      appBar: AppBar(
        backgroundColor: palette.paper,
        surfaceTintColor: Colors.transparent,
        title: Text(
          zh ? '大红花记账' : 'Red Blossom',
          style: TextStyle(
            color: palette.ink,
            fontSize: 20,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: _items.isEmpty
          ? _empty(zh)
          : ListView.builder(
              padding: const EdgeInsets.only(top: 6, bottom: 140),
              itemCount: _items.length,
              itemBuilder: (context, i) => _row(_items[i], zh),
            ),
    );
  }

  Widget _row(store.ListItem item, bool zh) {
    if (item.kind == 'header') return _header(item, zh);
    // `row` packs several entries for a tablet layout; `entry` is one.
    final entries = item.ids
        .map((id) => _byId[id])
        .whereType<store.EntryView>();
    if (item.kind == 'row') {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22),
        child: Row(
          children: [
            for (final e in entries) Expanded(child: _swipeable(e, zh)),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 22),
      child: Column(children: [for (final e in entries) _swipeable(e, zh)]),
    );
  }

  /// A row that can be swiped away.
  ///
  /// The delete is a tombstone rather than a removal, and the undo goes back
  /// through `unremove_entry` — a fresh stamped write, not a replay of the old
  /// row. Replaying it would restore an `updatedAt` below the push watermark,
  /// so the undo would never reach the cloud and the next pull would delete the
  /// entry again.
  Widget _swipeable(store.EntryView e, bool zh) => Dismissible(
    key: Key('row-${e.id}'),
    direction: DismissDirection.endToStart,
    background: Container(
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.only(right: 20, bottom: 8),
      decoration: BoxDecoration(
        color: palette.hibiscus.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Rad.md),
      ),
      child: Icon(Icons.delete_outline, color: palette.hibiscus),
    ),
    onDismissed: (_) => _delete(e, zh),
    child: _entryCard(e, zh),
  );

  void _delete(store.EntryView e, bool zh) {
    final undo = store.removeEntry(
      id: e.id,
      now: DateTime.now().millisecondsSinceEpoch,
    );
    widget.onChanged?.call();
    _reload();
    if (undo == null || !mounted) return;

    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(zh ? '已删除' : 'Deleted'),
          action: SnackBarAction(
            label: zh ? '撤销' : 'Undo',
            onPressed: () {
              store.unremoveEntry(
                undo: undo,
                now: DateTime.now().millisecondsSinceEpoch,
              );
              widget.onChanged?.call();
              _reload();
            },
          ),
        ),
      );
  }

  Widget _header(store.ListItem item, bool zh) {
    // Which total the header shows is the shipping rule, kept: the expense
    // unless there was none and there was income.
    final showsExp = item.exp > 0 || item.inc == 0;
    final amount = money.fmt(
      n: showsExp ? item.exp : item.inc,
      symbol: zh ? '￥' : '\$',
    );
    final side =
        '${showsExp ? (zh ? '支出' : 'Exp') : (zh ? '收入' : 'Inc')} $amount';
    final style = TextStyle(
      fontSize: 12,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.3,
      color: palette.inkSoft,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(26, 8, 26, 7),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(dayHeading(item.label, item.day, zh), style: style),
          Text(side, style: style.copyWith(fontFeatures: tabular)),
        ],
      ),
    );
  }

  Widget _entryCard(store.EntryView e, bool zh) {
    // One call for the emoji, the name and the accent — the lookup has a
    // fallback rule (the *last* category, not a generic "other") that is not
    // worth a second implementation.
    final label = catalog.catLabel(
      io: e.io,
      key: e.cat,
      zh: zh,
      custom: const [],
    );
    final accent = parseHex(label.color);
    // One node saying one sentence, which is what the React Native row does:
    // an `accessibilityLabel` on a touchable *replaces* the subtree's text.
    // Flutter instead merges sibling text into the node's label, so without
    // ExcludeSemantics a screen reader would hear the category, the amount and
    // the note twice over — once as the sentence and once as the widgets.
    return Semantics(
      button: true,
      container: true,
      label:
          '${label.name}, ${money.fmtSigned(n: e.amt, io: e.io)}'
          '${e.note != null ? ', ${e.note}' : ''}',
      child: GestureDetector(
        onTap: () => widget.onEdit?.call(e.id),
        // Claiming and refunding are ledger writes rather than form fields, so
        // they live here and not on the record sheet — a draft that had already
        // written half of itself would be a confusing thing to cancel.
        onLongPress: () async {
          final changed = await showEntryActions(
            context,
            id: e.id,
            amt: e.amt,
            isPending: e.rb == 'pending',
            zh: zh,
          );
          if (changed) widget.onChanged?.call();
        },
        child: ExcludeSemantics(
          child: Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
            decoration: BoxDecoration(
              color: palette.card,
              borderRadius: BorderRadius.circular(Rad.md),
              border: Border.all(
                color: palette.line,
                width: 1 / MediaQuery.devicePixelRatioOf(context),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: accent.withValues(
                      alpha: palette.isDark ? 0.19 : 0.12,
                    ),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Text(
                    label.emoji,
                    style: const TextStyle(fontSize: 19),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              label.name,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w600,
                                color: palette.ink,
                              ),
                            ),
                          ),
                          if (e.rb == 'pending')
                            _badge(zh ? '待报销' : 'Claim', palette.stamen, 0.18),
                          if (e.rb == 'done')
                            _badge(zh ? '已报销' : 'Claimed', palette.leaf, 0.19),
                          if ((e.refund ?? 0) != 0)
                            _badge(
                              zh ? '退款' : 'Refund',
                              palette.hibiscus,
                              0.15,
                            ),
                        ],
                      ),
                      if (e.note != null && e.note!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            e.note!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11.5,
                              color: palette.inkSoft,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  money.fmtSigned(n: e.amt, io: e.io),
                  style: TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                    fontFeatures: tabular,
                    color: e.io == 'inc' ? palette.leafDeep : palette.ink,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _badge(String text, Color tone, double bg) => Padding(
    padding: const EdgeInsets.only(left: 6),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: bg),
        borderRadius: BorderRadius.circular(Rad.pill),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: tone,
        ),
      ),
    ),
  );

  Widget _empty(bool zh) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 96,
          height: 96,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: palette.paperWarm,
            shape: BoxShape.circle,
          ),
          child: const Text('🌺', style: TextStyle(fontSize: 44)),
        ),
        const SizedBox(height: 14),
        Text(
          zh ? '还没有记账' : 'Nothing recorded yet',
          style: TextStyle(fontSize: 13, color: palette.inkSoft),
        ),
      ],
    ),
  );
}
