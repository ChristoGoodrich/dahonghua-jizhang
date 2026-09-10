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

import 'bloom.dart';
import 'bottom_nav.dart';
import 'glass.dart';
import 'src/rust/api/batch.dart' as batch;
import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/search.dart' as search;
import 'src/rust/api/store.dart' as store;
import 'reimburse_screen.dart';
import 'tap.dart';
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
    this.onSelecting,
  });

  final bool zh;

  /// Open a row for editing. The shell decides where that happens.
  final void Function(String id)? onEdit;

  /// The ledger changed and should be written. Separate from `onEdit` because
  /// a delete changes it and an edit request does not.
  final VoidCallback? onChanged;

  /// 批量处理 started or ended.
  ///
  /// The shell owns the nav bar and this screen owns the selection, so the two
  /// have to agree about which one is drawing a bottom bar. Told rather than
  /// asked: a shell that polled would be a frame behind.
  final ValueChanged<bool>? onSelecting;

  @override
  State<EntryListScreen> createState() => _EntryListScreenState();
}

class _EntryListScreenState extends State<EntryListScreen> {
  List<store.ListItem> _items = const [];
  Map<String, store.EntryView> _byId = const {};

  final _query = TextEditingController();
  bool _searching = false;

  /// 批量处理. Null when the screen is in its ordinary mode; a set — possibly
  /// empty — while rows are being ticked.
  ///
  /// Null rather than a separate `bool` because the two would have to be kept
  /// in step, and "selecting with nothing selected" is a real state: unticking
  /// the last row leaves the bar up so the next tick does not have to start
  /// with another long press.
  Set<String>? _picked;

  bool get _selecting => _picked != null;

  /// What the selection comes to, from the core. Recomputed whenever the set
  /// changes rather than held, so it cannot describe a ledger that has moved.
  batch.BatchTally get _tally =>
      batch.tally(ids: (_picked ?? const <String>{}).toList());

  /// What the box turned out to mean, kept so the row under it can say so.
  /// A query that reads as a date leaves no text behind, and a user who typed
  /// 上周 and saw an empty list deserves to know it was understood.
  search.ParsedQueryView? _parsed;

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
    var ids = live.map((e) => e.id).toList();
    var days = live
        .map((e) => localDay(DateTime.fromMillisecondsSinceEpoch(e.ts)))
        .toList();

    final q = _query.text.trim();
    search.ParsedQueryView? parsed;
    if (q.isNotEmpty) {
      // The query may name a range, and a range is not something Rust can
      // resolve: midnight last Monday is a question about this device's zone.
      parsed = search.parseQuery(query: q, today: localDay(DateTime.now()));
      final keep = search
          .searchIds(
            ids: ids,
            text: parsed.text,
            io: parsed.io,
            fromMs: _msOf(parsed.from),
            toMs: _msOf(parsed.to),
            zh: widget.zh,
          )
          .toSet();
      final kept = [
        for (var i = 0; i < ids.length; i++)
          if (keep.contains(ids[i])) i,
      ];
      ids = [for (final i in kept) ids[i]];
      days = [for (final i in kept) days[i]];
    }

    final items = store.listItems(
      ids: ids,
      days: days,
      today: localDay(DateTime.now()),
      columns: 1,
    );
    setState(() {
      _byId = {for (final e in live) e.id: e};
      _items = items;
      _parsed = parsed;
    });
  }

  static int? _msOf(search.WallTime? t) => t == null
      ? null
      : DateTime(t.y, t.mo, t.d, t.h, t.mi, t.s).millisecondsSinceEpoch;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    // Where the content has to start so the first row is not born under the
    // header. The list runs the full height and pads instead, which is the
    // whole point: a row that stops at the header cannot dissolve into it.
    final topInset = MediaQuery.paddingOf(context).top + kToolbarHeight;
    final readback = _selecting ? null : _readbackText(zh);

    return PopScope(
      // Back leaves the selection before it leaves the screen, which is what
      // every Xiaomi app does and what a user who ticked eleven rows by
      // accident is reaching for.
      canPop: !_selecting,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _endSelecting();
      },
      child: Scaffold(
        backgroundColor: palette.paper,
        // The content runs under both bars rather than between them. Without
        // this the scrim has nothing to blur, and a blur of a flat colour is a
        // flat colour.
        extendBodyBehindAppBar: true,
        extendBody: true,
        appBar: _selecting ? _selectionHeader(zh) : _titleHeader(zh),
        // The shell's nav bar is hidden while selecting — see `onSelecting` —
        // so the two never both draw. Same slot, same height, same material.
        bottomNavigationBar: _selecting
            ? SelectionBar(actions: _batchActions(zh))
            : null,
        body: Stack(
          fit: StackFit.expand,
          children: [
            if (_items.isEmpty)
              _empty(zh)
            else
              ListView.builder(
                padding: EdgeInsets.only(
                  top: topInset + (readback == null ? 6 : 26),
                  bottom: navBottomInset(context),
                ),
                itemCount: _items.length,
                itemBuilder: (context, i) => _row(_items[i], zh),
              ),
            // The scrim is exactly the header's own extent, so the ramp
            // completes AT its bottom edge: the first row is crisp at rest and
            // dissolves as it slides underneath. Made it `topInset + fade`
            // first, which put the transition 72dp below the bar and blurred
            // the day header nobody had scrolled anywhere near. A dissolve is
            // anchored to the chrome it dissolves into.
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: topInset,
              child: const GlassScrim(flipped: true),
            ),
            // Over the scrim so it stays legible through it, and pinned rather
            // than scrolled: it describes the list, and a caption that scrolls
            // away from what it captions is a caption for nothing.
            if (readback != null)
              Positioned(
                top: topInset - 2,
                left: 0,
                right: 0,
                child: Padding(
                  key: const Key('search-readback'),
                  padding: const EdgeInsets.symmetric(horizontal: 22),
                  child: Text(
                    readback,
                    style: TextStyle(fontSize: 12, color: palette.hibiscus),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// The ordinary header: the app's name, or the search box in its place.
  ///
  /// Transparent, because it stands on the scrim now rather than on a block of
  /// paper. `scrolledUnderElevation` too — Material 3 tints an app bar the
  /// moment content passes under it, and content passing under it is the whole
  /// arrangement.
  PreferredSizeWidget _titleHeader(bool zh) => AppBar(
    backgroundColor: Colors.transparent,
    surfaceTintColor: Colors.transparent,
    scrolledUnderElevation: 0,
    elevation: 0,
    title: _searching
        ? TextField(
            key: const Key('search-field'),
            controller: _query,
            autofocus: true,
            style: TextStyle(fontSize: 16, color: palette.ink),
            cursorColor: palette.hibiscus,
            decoration: InputDecoration(
              border: InputBorder.none,
              isDense: true,
              hintText: zh ? '找一笔:上周、支出、星巴克' : 'last week · income · coffee',
              hintStyle: TextStyle(fontSize: 15, color: palette.inkSoft),
            ),
            onChanged: (_) => _reload(),
          )
        : Text(
            zh ? '大红花记账' : 'Red Blossom',
            style: TextStyle(
              color: palette.ink,
              fontSize: 20,
              fontWeight: FontWeight.w700,
            ),
          ),
    actions: [
      // Long-pressing a row starts a selection too, and that is the gesture
      // people actually use. This is here because a gesture with no visible
      // affordance is a gesture you have to already know about — the same
      // argument that put 删除 in the long-press sheet next to the swipe.
      IconButton(
        key: const Key('select-toggle'),
        tooltip: zh ? '批量处理' : 'Select',
        icon: Icon(Icons.checklist_rtl, color: palette.ink),
        onPressed: _items.isEmpty ? null : _beginSelecting,
      ),
      IconButton(
        key: const Key('search-toggle'),
        icon: Icon(_searching ? Icons.close : Icons.search, color: palette.ink),
        onPressed: () {
          setState(() {
            _searching = !_searching;
            if (!_searching) _query.clear();
          });
          _reload();
        },
      ),
    ],
  );

  /// The header while rows are ticked: how many, what they come to, and the
  /// two ways out — close, and take everything.
  PreferredSizeWidget _selectionHeader(bool zh) {
    final t = _tally;
    final sums = <String>[
      if (t.exp > 0)
        '${zh ? '支出' : 'Exp'} ${money.fmt(n: t.exp, symbol: zh ? '￥' : '\$')}',
      if (t.inc > 0)
        '${zh ? '收入' : 'Inc'} ${money.fmt(n: t.inc, symbol: zh ? '￥' : '\$')}',
    ];
    final all = _visibleIds();
    final everything = all.isNotEmpty && _picked!.length == all.length;

    return AppBar(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      leading: IconButton(
        key: const Key('select-close'),
        icon: Icon(Icons.close, color: palette.ink),
        onPressed: _endSelecting,
      ),
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            zh ? '已选中 ${t.count} 项' : '${t.count} selected',
            key: const Key('select-count'),
            style: TextStyle(
              color: palette.ink,
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
          // The sums are the core's, not a fold written here. They are the
          // same arithmetic the day headers show, and two implementations of
          // one sum is how they come to disagree.
          if (sums.isNotEmpty)
            Text(
              sums.join(' · '),
              style: TextStyle(
                color: palette.inkSoft,
                fontSize: 11.5,
                fontFeatures: tabular,
              ),
            ),
        ],
      ),
      actions: [
        IconButton(
          key: const Key('select-all'),
          tooltip: everything
              ? (zh ? '取消全选' : 'Select none')
              : (zh ? '全选' : 'Select all'),
          icon: Icon(
            everything ? Icons.deselect : Icons.select_all,
            color: everything ? palette.hibiscus : palette.ink,
          ),
          onPressed: () =>
              setState(() => _picked = everything ? <String>{} : all.toSet()),
        ),
      ],
    );
  }

  /// The ids the list is currently showing, in the order it shows them.
  ///
  /// 全选 takes what is on screen, not what is in the ledger: a search for 上周
  /// that turned up four rows and then selected nine hundred would be the
  /// worst kind of surprise.
  List<String> _visibleIds() => [
    for (final item in _items)
      if (item.kind != 'header') ...item.ids,
  ];

  void _beginSelecting([String? first]) {
    setState(() => _picked = {?first});
    widget.onSelecting?.call(true);
  }

  void _endSelecting() {
    if (!_selecting) return;
    setState(() => _picked = null);
    widget.onSelecting?.call(false);
  }

  void _toggle(String id) => setState(() {
    // `remove` answers whether it was there, so this is one lookup rather than
    // a contains-then-branch that could disagree with itself.
    if (!_picked!.remove(id)) _picked!.add(id);
  });

  /// What the search box turned out to mean, as a sentence — or nothing.
  ///
  /// Worth its space because the query language is invisible otherwise: a user
  /// who types 上周 and gets four rows has no way to tell whether the word was
  /// read as a date or matched as text against a note.
  String? _readbackText(bool zh) {
    final p = _parsed;
    if (!_searching || p == null) return null;
    final bits = <String>[
      if (p.from != null)
        zh
            ? '${p.from!.mo}月${p.from!.d}日 到 ${p.to!.mo}月${p.to!.d}日'
            : '${p.from!.mo}/${p.from!.d} – ${p.to!.mo}/${p.to!.d}',
      if (p.io != null)
        p.io == 'inc'
            ? (zh ? '只看收入' : 'income only')
            : (zh ? '只看支出' : 'expense only'),
    ];
    return bits.isEmpty ? null : bits.join(' · ');
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
    // Not while ticking. A drag across a row is how a finger scrolls a list it
    // is also selecting from, and a swipe that deleted one mid-selection would
    // be the most expensive gesture in the app.
    direction: _selecting ? DismissDirection.none : DismissDirection.endToStart,
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
    final picked = _picked?.contains(e.id) ?? false;
    // One node saying one sentence, which is what the React Native row does:
    // an `accessibilityLabel` on a touchable *replaces* the subtree's text.
    // Flutter instead merges sibling text into the node's label, so without
    // ExcludeSemantics a screen reader would hear the category, the amount and
    // the note twice over — once as the sentence and once as the widgets.
    return Semantics(
      button: true,
      container: true,
      selected: picked,
      label:
          '${label.name}, ${money.fmtSigned(n: e.amt, io: e.io)}'
          '${e.note != null ? ', ${e.note}' : ''}',
      // The row's gap is a Padding outside the Tap rather than a margin on the
      // Container inside it: the press veil fills the Tap, and a margin within
      // it would let the veil paint the gap between rows as well.
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Tap(
          radius: Rad.md,
          onTap: () => _selecting ? _toggle(e.id) : widget.onEdit?.call(e.id),
          // Long-press starts a selection with this row in it, which is what
          // 小米笔记 and 相册 do and therefore what a finger on this phone
          // already expects. It used to open the single-row sheet; that sheet
          // is now 更多 on the selection bar, reachable whenever exactly one
          // row is ticked. 退款 went from two taps to three and the gesture
          // stopped being this app's own invention, which is the better
          // trade.
          onLongPress: _selecting ? null : () => _beginSelecting(e.id),
          child: ExcludeSemantics(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
              decoration: BoxDecoration(
                // A ticked row is tinted rather than outlined. The list is
                // read down its left edge — emoji, name, note — and an outline
                // competes with the card's own hairline at exactly the size
                // that makes both hard to see.
                color: picked
                    ? Color.alphaBlend(
                        palette.hibiscus.withValues(alpha: 0.10),
                        palette.card,
                      )
                    : palette.card,
                borderRadius: BorderRadius.circular(Rad.md),
                border: Border.all(
                  color: picked
                      ? palette.hibiscus.withValues(alpha: 0.35)
                      : palette.line,
                  width: 1 / MediaQuery.devicePixelRatioOf(context),
                ),
              ),
              child: Row(
                children: [
                  if (_selecting) ...[
                    _Tick(picked: picked),
                    const SizedBox(width: 11),
                  ],
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
                              _badge(
                                zh ? '待报销' : 'Claim',
                                palette.stamen,
                                0.18,
                              ),
                            if (e.rb == 'done')
                              _badge(
                                zh ? '已报销' : 'Claimed',
                                palette.leaf,
                                0.19,
                              ),
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
        // The app's own mark, not an emoji. 🌺 was somebody else's drawing —
        // Noto's on one phone, Samsung's on another, a fallback box on a third
        // — and it was not the flower on the launcher icon the user had just
        // tapped. `Bloom` is that icon's geometry, in the theme's colour.
        Container(
          width: 108,
          height: 108,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: palette.paperWarm,
            shape: BoxShape.circle,
            border: Border.all(
              color: palette.hibiscus.withValues(alpha: 0.10),
              width: 1,
            ),
          ),
          child: const Bloom(size: 56),
        ),
        const SizedBox(height: 14),
        // An empty ledger and an empty search look the same and are not the
        // same thing. Telling a user who is searching that they have never
        // recorded anything is worse than saying nothing.
        Text(
          _query.text.trim().isEmpty
              ? (zh ? '还没有记账' : 'Nothing recorded yet')
              : (zh ? '没有找到' : 'Nothing matched'),
          key: const Key('list-empty'),
          style: TextStyle(fontSize: 13, color: palette.inkSoft),
        ),
      ],
    ),
  );

  // ---- 批量处理 ----------------------------------------------------------

  /// The buttons on the selection bar, and which of them are live.
  ///
  /// Every one of those decisions is the core's. 改分类 needs the selection to
  /// be on one side of the ledger, because a category belongs to a side;
  /// 报销 needs an expense in it, because there is no such thing as claiming
  /// income back. Both answers arrive on the tally rather than being worked
  /// out from `io` strings here, which is the same rule the rest of the screen
  /// follows.
  List<SelectionAction> _batchActions(bool zh) {
    final t = _tally;
    final any = t.count > 0;
    return [
      SelectionAction(
        id: 'cat',
        icon: Icons.sell_outlined,
        label: zh ? '改分类' : 'Category',
        onTap: any && t.sharedIo != null
            ? () => _batchCategory(t.sharedIo!, zh)
            : null,
      ),
      SelectionAction(
        id: 'claim',
        icon: Icons.receipt_long,
        label: zh ? '报销' : 'Claim',
        onTap: t.claimable > 0 ? () => _batchClaim(zh) : null,
      ),
      SelectionAction(
        id: 'more',
        icon: Icons.more_horiz,
        label: zh ? '更多' : 'More',
        // 退款 needs an amount, so it is a single-row act and always will be.
        // This is where the old long-press sheet went.
        onTap: t.count == 1 ? () => _batchMore(zh) : null,
      ),
      SelectionAction(
        id: 'delete',
        icon: Icons.delete_outline,
        label: zh ? '删除' : 'Delete',
        onTap: any ? () => _batchDelete(zh) : null,
      ),
    ];
  }

  /// Deleting the lot, undoably.
  ///
  /// One token per row, kept in the order they were taken, because that is the
  /// order they have to go back in: deleting an expense tombstones the refund
  /// incomes that point at it, and restoring an income first would restore it
  /// pointing at a row that is still deleted.
  Future<void> _batchDelete(bool zh) async {
    final ids = _picked!.toList();
    final undo = batch.removeAll(
      ids: ids,
      now: DateTime.now().millisecondsSinceEpoch,
    );
    _endSelecting();
    widget.onChanged?.call();
    _reload();
    if (undo.isEmpty || !mounted) return;

    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(zh ? '已删除 ${undo.length} 项' : 'Deleted ${undo.length}'),
          action: SnackBarAction(
            label: zh ? '撤销' : 'Undo',
            onPressed: () {
              batch.unremoveAll(
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

  /// Move the lot into one category.
  ///
  /// The grid is whichever side the selection is on — `sharedIo` already
  /// answered that — so an expense selection is never offered 工资.
  Future<void> _batchCategory(String io, bool zh) async {
    final cats = catalog.allCats(io: io, custom: const []);
    final key = await showModalBottomSheet<String>(
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
                  key: Key('batch-cat-${c.k}'),
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
                          catalog.catName(cat: c, zh: zh),
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
    if (key == null) return;

    final n = batch.categorize(
      ids: _picked!.toList(),
      io: io,
      cat: key,
      now: DateTime.now().millisecondsSinceEpoch,
    );
    _afterBatch(n, zh);
  }

  /// Where the claims are going. Three states, spelled out rather than cycled:
  /// a batch that toggled would leave a mixed selection more mixed.
  Future<void> _batchClaim(bool zh) async {
    final to = await showModalBottomSheet<batch.ClaimTo>(
      context: context,
      backgroundColor: palette.card,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (id, state, text) in [
              ('pending', batch.ClaimTo.pending, zh ? '标为待报销' : 'Mark pending'),
              ('done', batch.ClaimTo.done, zh ? '标为已报销' : 'Mark settled'),
              ('clear', batch.ClaimTo.cleared, zh ? '取消报销' : 'Clear the claim'),
            ])
              ListTile(
                key: Key('batch-claim-$id'),
                leading: Icon(Icons.receipt_long, color: palette.hibiscus),
                title: Text(
                  text,
                  style: TextStyle(fontSize: 15, color: palette.ink),
                ),
                onTap: () => Navigator.pop(ctx, state),
              ),
          ],
        ),
      ),
    );
    if (to == null) return;

    final n = batch.setClaim(
      ids: _picked!.toList(),
      to: to,
      now: DateTime.now().millisecondsSinceEpoch,
    );
    _afterBatch(n, zh);
  }

  /// The single-row sheet, for the one row that is ticked.
  Future<void> _batchMore(bool zh) async {
    final id = _picked!.single;
    final e = _byId[id];
    if (e == null) return;
    final changed = await showEntryActions(
      context,
      id: e.id,
      amt: e.amt,
      isPending: e.rb == 'pending',
      zh: zh,
      onDelete: () => _delete(e, zh),
    );
    _endSelecting();
    if (changed) widget.onChanged?.call();
    _reload();
  }

  /// What a batch says when it is done.
  ///
  /// It reports what was **written**, not what was selected, and those differ
  /// on purpose: rows already in the state are left alone so their stamp does
  /// not jump ahead of another device's real edit. Saying "3 selected" when
  /// two were written would hide exactly the thing worth knowing.
  void _afterBatch(int written, bool zh) {
    _endSelecting();
    widget.onChanged?.call();
    _reload();
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(
            written == 0
                ? (zh ? '没有需要修改的' : 'Nothing to change')
                : (zh ? '已修改 $written 项' : 'Changed $written'),
          ),
        ),
      );
  }
}

/// The tick on a row that can be ticked.
///
/// Filled when it is, a hollow ring when it is not — never absent, because a
/// row with no ring in a list where other rows have one reads as a row that
/// cannot be selected rather than as one that is not.
class _Tick extends StatelessWidget {
  const _Tick({required this.picked});

  final bool picked;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 140),
      curve: Curves.easeOut,
      width: 22,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: picked ? p.hibiscus : Colors.transparent,
        border: Border.all(
          color: picked ? p.hibiscus : p.inkSoft.withValues(alpha: 0.45),
          width: 1.5,
        ),
      ),
      child: picked
          ? const Icon(Icons.check, size: 14, color: Colors.white)
          : null,
    );
  }
}
