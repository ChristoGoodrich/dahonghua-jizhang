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

import 'src/rust/api/accounts.dart' as accounts;
import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/store.dart' as store;
import 'src/rust/api/subscriptions.dart' as subs;
import 'tap.dart';
import 'glass.dart';
import 'empty_note.dart';
import 'amounts.dart';
import 'cats.dart';
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
/// Runs at launch, on every return to the foreground, and after a
/// subscription is added — the shipping app charges immediately if today is
/// already a due day, and waiting until tomorrow would be a visible
/// difference. The foreground is not the launch on Android: a backgrounded
/// process lives for days, and a charge used to wait for it to be killed.
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
            style: TextButton.styleFrom(foregroundColor: palette.warn),
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
    return ScrimScaffold(
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
      body: _rows.isEmpty
          ? ListView(
              padding: EdgeInsets.only(top: headerInset(context)),
              children: [
                EmptyNote(
                  key: const Key('no-subs'),
                  icon: Icons.autorenew_outlined,
                  text: zh ? '还没有订阅' : 'No subscriptions yet',
                  hint: zh
                      ? '会员、房租、话费 —— 到期那天自动记一笔'
                      : 'Memberships, rent, a phone plan — logged on the day',
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
    // A transfer says where it moves the money, as the shipping row did.
    final route = s.isTransfer && s.from != null && s.to != null
        ? () {
            final names = {
              for (final a in accounts.accountNames(zh: zh)) a.id: a.name,
            };
            return '${names[s.from] ?? s.from} → ${names[s.to] ?? s.to} · ';
          }()
        : '';

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
                    '$route$plan$freqLabel · $dueLabel',
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
              money.fmtShort(n: s.amt, symbol: baseSymbol()),
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
                color: palette.inkSoft,
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

  /// 支出 or 转账. A transfer moves money between two of the user's accounts
  /// each period — a savings plan, a card's repayment — and the sweep could
  /// always post one; only the form could not make one.
  bool _transfer = false;
  late final List<store.AccountView> _accounts = accounts.pickable(
    selected: '',
  );
  late String _from = _accounts.isEmpty ? '' : _accounts.first.id;
  late String _to = _accounts.length < 2 ? '' : _accounts[1].id;

  /// The month a yearly one charges in. It was stamped with the month the
  /// subscription was made in, so a renewal due in March, set up in
  /// November, charged in November.
  int _month = DateTime.now().month;

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

    final cat = catOf(io: 'exp', key: _cat);
    final id = subs.addSub(
      sub: _transfer
          // the shipping form's transfer: its own mark and category, and
          // no instalments — a plan pays off a debt, not a move
          ? subs.NewSub(
              name: name,
              amt: amt,
              freq: _freq,
              day: int.tryParse(_day.text) ?? 1,
              month: _month,
              cat: 'transfer',
              emoji: '🔄',
              isTransfer: true,
              from: _from,
              to: _to,
            )
          : subs.NewSub(
              name: name,
              amt: amt,
              freq: _freq,
              day: int.tryParse(_day.text) ?? 1,
              month: _month,
              cat: _cat,
              emoji: cat.e.isEmpty ? '🔁' : cat.e,
              isTransfer: false,
              periods: int.tryParse(_periods.text),
            ),
      id: 's${DateTime.now().millisecondsSinceEpoch}',
      now: DateTime.now().millisecondsSinceEpoch,
    );
    // refused: a transfer with no second account, or one to itself
    if (id.isEmpty) return;
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
    final cats = catsOf('exp');
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
            // 转账 needs two accounts to be one, so with fewer it is not
            // offered, as the shipping form did not offer it.
            if (_accounts.length >= 2) ...[
              const SizedBox(height: 14),
              Wrap(
                spacing: 6,
                children: [
                  _chip(
                    key: 'sub-kind-exp',
                    label: zh ? '支出' : 'Expense',
                    on: !_transfer,
                    onTap: () => setState(() => _transfer = false),
                  ),
                  _chip(
                    key: 'sub-kind-xfer',
                    label: zh ? '转账' : 'Transfer',
                    on: _transfer,
                    onTap: () => setState(() => _transfer = true),
                  ),
                ],
              ),
            ],
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
            if (_freq == 'yearly') ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: [
                  for (var m = 1; m <= 12; m++)
                    _chip(
                      key: 'sub-month-$m',
                      label: zh ? '$m月' : '$m',
                      on: _month == m,
                      onTap: () => setState(() => _month = m),
                    ),
                ],
              ),
            ],
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
                if (!_transfer) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      key: const Key('sub-periods'),
                      controller: _periods,
                      keyboardType: TextInputType.number,
                      cursorColor: palette.stamen,
                      decoration: _field(zh ? '分期数（可空）' : 'Instalments'),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 14),
            if (_transfer) ...[
              _accountRow(zh ? '转出' : 'From', 'sub-from', _from, zh, (id) {
                _from = id;
                // never to where it comes from: the other end moves aside
                if (_to == id) {
                  _to = _accounts.firstWhere((a) => a.id != id).id;
                }
              }),
              const SizedBox(height: 10),
              _accountRow(
                zh ? '转入' : 'To',
                'sub-to',
                _to,
                zh,
                (id) => _to = id,
                except: _from,
              ),
            ] else
              // Every category, the user's own included: the first six left
              // out 医疗, 学习 and every custom one.
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final c in cats)
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

  Widget _accountRow(
    String label,
    String keyPrefix,
    String selected,
    bool zh,
    ValueChanged<String> pick, {
    String? except,
  }) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: TextStyle(fontSize: 12, color: palette.inkSoft)),
      const SizedBox(height: 6),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final a in _accounts)
            if (a.id != except)
              _chip(
                key: '$keyPrefix-${a.id}',
                label: zh ? a.name : (a.nameEn ?? a.name),
                on: selected == a.id,
                onTap: () => setState(() => pick(a.id)),
              ),
        ],
      ),
    ],
  );

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
