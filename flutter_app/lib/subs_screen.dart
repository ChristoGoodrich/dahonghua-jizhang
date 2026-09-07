// Subscriptions, in Dart over the Rust calendar.
//
// The screen draws two things it does not compute: when each subscription next
// charges, and whether an instalment plan is finished. Both are calendar
// arithmetic with an edge that looks like a bug until you read the shipping
// code — a subscription billed on the 31st charges on **3 March** in a
// non-leap year, because `new Date(y, m, 31)` overflows rather than clamping.
//
// The sweep that posts due charges is two calls, and has to be. Which dates are
// due is arithmetic; turning one of those dates into the timestamp an entry
// carries needs a timezone, which only the platform has. So Rust answers with
// dates, this file converts them, and Rust posts.

import 'package:flutter/material.dart';
// flutter_rust_bridge ships its own Int64List; the one in dart:typed_data is a
// different type with the same name, and passing it here does not typecheck.
import 'package:flutter_rust_bridge/flutter_rust_bridge.dart' show Int64List;

import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/subscriptions.dart' as subs;
import 'tap.dart';
import 'theme.dart';

/// `YYYY-M-D` with a **0-indexed** month, inherited from v7 — the encoding the
/// cursor is written in, so this file speaks it too rather than translating at
/// four call sites.
String encodeDay(DateTime d) => '${d.year}-${d.month - 1}-${d.day}';

DateTime? decodeDay(String s) {
  final p = s.split('-');
  if (p.length != 3) return null;
  final y = int.tryParse(p[0]), m = int.tryParse(p[1]), d = int.tryParse(p[2]);
  if (y == null || m == null || d == null) return null;
  return DateTime(y, m + 1, d);
}

/// Where a subscription's cursor sits: its stored day, or the day it was
/// created when it has never fired.
///
/// The fallback is a conversion from an epoch, which is why Rust asks for it
/// rather than working it out — the same rule as everywhere else.
String startOf(subs.SubView s) => s.lastCharged.isNotEmpty
    ? s.lastCharged
    : encodeDay(DateTime.fromMillisecondsSinceEpoch(s.created));

/// Post every charge that is due. Returns the names that fired.
///
/// Runs at launch and after a subscription is added — the shipping app charges
/// immediately if today is already a due day, and waiting until tomorrow would
/// be a visible difference.
List<String> runDueCharges({DateTime? today}) {
  final now = today ?? DateTime.now();
  final list = subs.subs();
  if (list.isEmpty) return const [];
  final starts = list.map(startOf).toList();
  final day = encodeDay(now);

  final pending = subs.subsPending(starts: starts, today: day);
  // Local midnight of each due date. This is the whole reason the sweep is two
  // calls: a fixed offset would be wrong across a daylight-saving boundary, and
  // the charges being caught up may well span one.
  final epochs = pending.days
      .map((d) => (decodeDay(d) ?? now).millisecondsSinceEpoch)
      .toList();

  return subs.subsCommit(
    starts: starts,
    today: day,
    days: pending.days,
    epochs: Int64List.fromList(epochs),
    now: now.millisecondsSinceEpoch,
  );
}

class SubsScreen extends StatefulWidget {
  const SubsScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;

  /// Subscriptions or the ledger changed — a sweep writes both.
  final VoidCallback? onChanged;

  @override
  State<SubsScreen> createState() => _SubsScreenState();
}

class _SubsScreenState extends State<SubsScreen> {
  List<subs.SubView> _rows = const [];

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() => setState(() => _rows = subs.subs());

  void _changed() {
    widget.onChanged?.call();
    _reload();
  }

  Future<void> _add() async {
    final made = await showDialog<bool>(
      context: context,
      builder: (_) => _NewSubDialog(zh: widget.zh),
    );
    if (made != true) return;
    // charge at once if today is already a due day, as the shipping app does
    runDueCharges();
    _changed();
  }

  Future<void> _confirmDelete(subs.SubView s) async {
    final zh = widget.zh;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('sub-delete-dialog'),
        backgroundColor: palette.card,
        title: Text(
          zh ? '删除订阅' : 'Delete subscription',
          style: TextStyle(fontSize: 16, color: palette.ink),
        ),
        content: Text(
          zh
              ? '「${s.name}」以后不再自动记账。已经记下的不受影响。'
              : '"${s.name}" stops charging. Entries already posted are kept.',
          style: TextStyle(fontSize: 14, color: palette.inkSoft),
        ),
        actions: [
          TextButton(
            key: const Key('sub-delete-cancel'),
            onPressed: () => Navigator.pop(ctx, false),
            style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
            child: Text(zh ? '取消' : 'Cancel'),
          ),
          TextButton(
            key: const Key('sub-delete-ok'),
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
            child: Text(zh ? '删除' : 'Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    subs.removeSub(id: s.id);
    _changed();
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
          zh ? '订阅' : 'Subscriptions',
          style: TextStyle(
            color: palette.ink,
            fontSize: 20,
            fontWeight: FontWeight.w700,
          ),
        ),
        actions: [
          IconButton(
            key: const Key('add-sub'),
            icon: Icon(Icons.add, color: palette.ink),
            onPressed: _add,
          ),
        ],
      ),
      body: _rows.isEmpty
          ? Center(
              child: Text(
                zh ? '还没有订阅' : 'No subscriptions yet',
                key: const Key('no-subs'),
                style: TextStyle(fontSize: 14, color: palette.inkSoft),
              ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(22, 6, 22, 120),
              children: [for (final s in _rows) _row(s, zh)],
            ),
    );
  }

  Widget _row(subs.SubView s, bool zh) {
    final today = DateTime.now();
    final due = subs.subNextDue(id: s.id, from: encodeDay(today));
    final dueDate = due == null ? null : decodeDay(due);
    final isToday =
        dueDate != null &&
        dueDate.year == today.year &&
        dueDate.month == today.month &&
        dueDate.day == today.day;
    // `!!periods && charged >= periods` — an open-ended subscription is never
    // done, however many times it has fired
    final done = s.periods != null && s.charged >= s.periods!;

    final freqLabel = s.freq == 'yearly'
        ? (zh ? '每年' : 'Yearly')
        : (zh ? '每月' : 'Monthly');
    final dueLabel = done
        ? (zh ? '已付清' : 'Paid off')
        : isToday
        ? (zh ? '今天扣款' : 'Charges today')
        : dueDate == null
        ? '—'
        : (zh
              ? '下次 ${dueDate.month}月${dueDate.day}日'
              : 'Next ${dueDate.month}/${dueDate.day}');
    final plan = s.periods == null ? '' : '${s.charged}/${s.periods} · ';

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
                color: palette.paperWarm,
                borderRadius: BorderRadius.circular(Rad.sm),
              ),
              child: Text(
                s.emoji.isEmpty ? '🔁' : s.emoji,
                style: const TextStyle(fontSize: 18),
              ),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s.name,
                    key: Key('sub-${s.id}-name'),
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: palette.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$plan$freqLabel · $dueLabel',
                    key: Key('sub-${s.id}-due'),
                    style: TextStyle(
                      fontSize: 12,
                      color: done
                          ? palette.leafDeep
                          : isToday
                          ? palette.hibiscus
                          : palette.inkSoft,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              money.fmtShort(n: s.amt, symbol: zh ? '￥' : '\$'),
              key: Key('sub-${s.id}-amt'),
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                fontFeatures: tabular,
                color: palette.ink,
              ),
            ),
            IconButton(
              key: Key('sub-${s.id}-delete'),
              tooltip: zh ? '删除' : 'Delete',
              icon: Icon(
                Icons.delete_outline,
                size: 20,
                color: palette.hibiscus,
              ),
              onPressed: () => _confirmDelete(s),
            ),
          ],
        ),
      ),
    );
  }
}

/// The new-subscription form.
class _NewSubDialog extends StatefulWidget {
  const _NewSubDialog({required this.zh});

  final bool zh;

  @override
  State<_NewSubDialog> createState() => _NewSubDialogState();
}

class _NewSubDialogState extends State<_NewSubDialog> {
  final _name = TextEditingController();
  final _amt = TextEditingController();
  final _day = TextEditingController(text: '1');
  final _periods = TextEditingController();
  String _freq = 'monthly';
  String _cat = 'home';

  @override
  void dispose() {
    _name.dispose();
    _amt.dispose();
    _day.dispose();
    _periods.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    final amt = double.tryParse(_amt.text.replaceAll(',', '')) ?? 0;
    // an amount of zero or less is not a subscription, and the shipping form
    // refuses it the same way — by doing nothing
    if (amt <= 0) return;

    final cat = catalog.catOf(io: 'exp', key: _cat, custom: const []);
    subs.addSub(
      sub: subs.NewSub(
        name: name,
        amt: amt,
        freq: _freq,
        day: int.tryParse(_day.text) ?? 1,
        month: DateTime.now().month,
        cat: _cat,
        emoji: cat.e.isEmpty ? '🔁' : cat.e,
        isTransfer: false,
        periods: int.tryParse(_periods.text),
      ),
      id: 's${DateTime.now().millisecondsSinceEpoch}',
      now: DateTime.now().millisecondsSinceEpoch,
    );
    Navigator.pop(context, true);
  }

  InputDecoration _field(String label) => InputDecoration(
    labelText: label,
    labelStyle: TextStyle(color: palette.inkSoft),
    floatingLabelStyle: TextStyle(color: palette.stamen),
    focusedBorder: UnderlineInputBorder(
      borderSide: BorderSide(color: palette.stamen, width: 2),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    final cats = catalog.allCats(io: 'exp', custom: const []);
    return AlertDialog(
      key: const Key('new-sub-dialog'),
      backgroundColor: palette.card,
      title: Text(
        zh ? '新建订阅' : 'New subscription',
        style: TextStyle(fontSize: 16, color: palette.ink),
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              key: const Key('sub-name'),
              controller: _name,
              autofocus: true,
              cursorColor: palette.stamen,
              decoration: _field(zh ? '名称' : 'Name'),
            ),
            TextField(
              key: const Key('sub-amt'),
              controller: _amt,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              cursorColor: palette.stamen,
              decoration: _field(zh ? '金额' : 'Amount'),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 6,
              children: [
                for (final f in ['monthly', 'yearly'])
                  _chip(
                    key: 'freq-$f',
                    label: f == 'yearly'
                        ? (zh ? '每年' : 'Yearly')
                        : (zh ? '每月' : 'Monthly'),
                    on: _freq == f,
                    onTap: () => setState(() => _freq = f),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                SizedBox(
                  width: 70,
                  child: TextField(
                    key: const Key('sub-day'),
                    controller: _day,
                    keyboardType: TextInputType.number,
                    cursorColor: palette.stamen,
                    decoration: _field(zh ? '日' : 'Day'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    key: const Key('sub-periods'),
                    controller: _periods,
                    keyboardType: TextInputType.number,
                    cursorColor: palette.stamen,
                    decoration: _field(zh ? '分期数(可空)' : 'Instalments'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final c in cats.take(6))
                  _chip(
                    key: 'sub-cat-${c.k}',
                    label: '${c.e} ${catalog.catName(cat: c, zh: zh)}',
                    on: _cat == c.k,
                    onTap: () => setState(() => _cat = c.k),
                  ),
              ],
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const Key('sub-cancel'),
          onPressed: () => Navigator.pop(context, false),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('sub-ok'),
          onPressed: _submit,
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(zh ? '创建' : 'Create'),
        ),
      ],
    );
  }

  Widget _chip({
    required String key,
    required String label,
    required bool on,
    required VoidCallback onTap,
  }) => Tap(
    radius: Rad.pill,
    key: Key(key),
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: on ? palette.stamen.withValues(alpha: 0.18) : Colors.transparent,
        borderRadius: BorderRadius.circular(Rad.pill),
        border: Border.all(color: on ? palette.stamen : palette.line),
      ),
      child: Text(label, style: TextStyle(fontSize: 12, color: palette.ink)),
    ),
  );
}
