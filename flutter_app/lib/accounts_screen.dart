// Accounts, in Dart over the Rust balances.
//
// A balance is an opening figure plus every entry that touched the account, and
// a transfer contributes to two of them with four signs — out of one, in to the
// other, minus a fee, plus a discount. None of that is worked out here; this
// asks for the numbers and draws them.
//
// The two destructive actions are the interesting part of the screen, and they
// are destructive in different ways. Archiving hides an account and keeps
// everything. Deleting moves every entry that referenced it to `default`, which
// is why `default` itself cannot be deleted — there would be nowhere to move
// them to.

import 'package:flutter/material.dart';

import 'src/rust/api/accounts.dart' as accounts;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/statement.dart' as statement;
import 'src/rust/api/store.dart' as store;
import 'account_detail_screen.dart';
import 'tap.dart';
import 'glass.dart';
import 'theme.dart';

/// What an account is, as a glyph: a wallet, a card, a top-up, a currency.
IconData acctGlyph(String kind) => switch (kind) {
  'credit' => Icons.credit_card_rounded,
  'prepaid' => Icons.card_giftcard_rounded,
  'fx' => Icons.currency_exchange_rounded,
  _ => Icons.account_balance_wallet_outlined,
};

/// An account's glyph on a tile of its own, the way a category's emoji sits
/// on one in the entry list — so a list of accounts is read down its left
/// edge by kind, the same as a list of entries is read by category.
class AcctTile extends StatelessWidget {
  const AcctTile({super.key, required this.kind});

  final String kind;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    // A credit account is the one that is money owed, so it is the one
    // drawn in the flower's colour; the rest are the ink's.
    final tone = kind == 'credit' ? p.hibiscus : p.inkSoft;
    return Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(
        color: tone.withValues(alpha: p.isDark ? 0.18 : 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Icon(acctGlyph(kind), size: 19, color: tone),
    );
  }
}

class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;

  /// Accounts or the ledger changed and both should be written — deleting an
  /// account rewrites the entries that pointed at it.
  final VoidCallback? onChanged;

  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  List<accounts.AccountBalance> _rows = const [];
  double _total = 0;

  /// Per credit card, or absent when it has no cycle configured.
  Map<String, statement.StatementView> _statements = const {};

  /// Cards due inside a week, soonest first. Past-due ones are in here
  /// too, with a negative count — a reminder that disappears once it is
  /// late is a reminder that vanishes when it starts to matter.
  List<statement.DueView> _due = const [];

  bool _showArchived = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    final rows = accounts.balances();
    // The days are Dart's, as everywhere: a statement closes on a calendar day
    // and which day an entry falls on is this device's zone to answer.
    final live = store.liveEntries();
    final ids = live.map((e) => e.id).toList();
    final days = live.map((e) {
      final d = DateTime.fromMillisecondsSinceEpoch(e.ts);
      return '${d.year}-${d.month}-${d.day}';
    }).toList();
    final now = DateTime.now();
    final today = '${now.year}-${now.month}-${now.day}';

    final stmts = <String, statement.StatementView>{};
    for (final a in rows) {
      // Asked per account rather than in one sweep: `statement_of` answers
      // `None` for anything that is not a configured credit card, so the map
      // ends up holding exactly the cards that have a cycle.
      final st = statement.statementOf(
        accountId: a.id,
        ids: ids,
        daysOf: days,
        today: today,
      );
      if (st != null) stmts[a.id] = st;
    }

    setState(() {
      _rows = rows;
      _total = accounts.totalBalance();
      _statements = stmts;
      _due = statement.dueWithin(
        ids: ids,
        daysOf: days,
        today: today,
        withinDays: 7,
      );
    });
  }

  void _changed() {
    widget.onChanged?.call();
    _reload();
  }

  String _name(accounts.AccountBalance a) =>
      widget.zh ? a.name : (a.nameEn ?? a.name);

  Future<void> _add() async {
    final made = await showDialog<bool>(
      context: context,
      builder: (_) => _NewAccountDialog(zh: widget.zh),
    );
    if (made == true) _changed();
  }

  Future<void> _confirmDelete(accounts.AccountBalance a) async {
    final zh = widget.zh;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('delete-dialog'),
        backgroundColor: palette.card,
        title: Text(
          zh ? '删除账户' : 'Delete account',
          style: TextStyle(fontSize: 16, color: palette.ink),
        ),
        content: Text(
          zh
              ? '「${_name(a)}」上的记录会移到默认账户,不会被删除。'
              : 'Entries on "${_name(a)}" move to the default account. Nothing is deleted.',
          style: TextStyle(fontSize: 14, color: palette.inkSoft),
        ),
        actions: [
          TextButton(
            key: const Key('delete-cancel'),
            onPressed: () => Navigator.pop(ctx, false),
            style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
            child: Text(zh ? '取消' : 'Cancel'),
          ),
          TextButton(
            key: const Key('delete-ok'),
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
            child: Text(zh ? '删除' : 'Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    accounts.removeAccount(
      id: a.id,
      now: DateTime.now().millisecondsSinceEpoch,
    );
    _changed();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    final shown = _rows.where((a) => _showArchived || !a.archived).toList();
    final archivedCount = _rows.where((a) => a.archived).length;

    return ScrimScaffold(
      title: Text(
        zh ? '账户' : 'Accounts',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      actions: [
        IconButton(
          key: const Key('add-account'),
          icon: Icon(Icons.add, color: palette.ink),
          onPressed: _add,
        ),
      ],
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
        children: [
          _totalCard(zh),
          if (_due.isNotEmpty) ...[const SizedBox(height: 14), _dueBanner(zh)],
          const SizedBox(height: 16),
          for (final a in shown) _row(context, a, zh),
          if (archivedCount > 0)
            TextButton(
              key: const Key('toggle-archived'),
              onPressed: () => setState(() => _showArchived = !_showArchived),
              style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
              child: Text(
                _showArchived
                    ? (zh ? '隐藏已归档' : 'Hide archived')
                    : (zh
                          ? '显示已归档($archivedCount)'
                          : 'Show archived ($archivedCount)'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _totalCard(bool zh) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    decoration: BoxDecoration(
      color: palette.card,
      borderRadius: BorderRadius.circular(Rad.lg),
      border: Border.all(color: palette.line),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          zh ? '账户合计' : 'Total',
          style: TextStyle(fontSize: 12, color: palette.inkSoft),
        ),
        const SizedBox(height: 3),
        Text(
          money.fmt(n: _total, symbol: zh ? '￥' : '\$'),
          key: const Key('acct-total'),
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w700,
            fontFeatures: tabular,
            // a negative total is a real state — a credit card with a
            // balance owed — so it is coloured rather than hidden
            color: _total < 0 ? palette.hibiscus : palette.ink,
          ),
        ),
      ],
    ),
  );

  /// Where a credit card is in its cycle, under its balance.
  ///
  /// Nothing at all for a card with no statement day: a cycle nobody has
  /// configured has no 出账日 to report, and a row of zeroes would read as a
  /// card that is paid off.
  List<Widget> _statementLine(accounts.AccountBalance a, bool zh) {
    final st = _statements[a.id];
    if (st == null) return const [];
    final sym = zh ? '￥' : '\$';
    final bits = <String>[
      zh
          ? '本期待还 ${money.fmt(n: st.billedDue, symbol: sym)}'
          : 'Billed ${money.fmt(n: st.billedDue, symbol: sym)}',
      if (st.unbilled != 0)
        zh
            ? '未出账 ${money.fmt(n: st.unbilled, symbol: sym)}'
            : 'Unbilled ${money.fmt(n: st.unbilled, symbol: sym)}',
      if (st.overpay > 0)
        zh
            ? '溢缴款 ${money.fmt(n: st.overpay, symbol: sym)}'
            : 'Overpaid ${money.fmt(n: st.overpay, symbol: sym)}',
    ];
    return [
      const SizedBox(height: 4),
      Text(
        bits.join(' · '),
        key: Key('acct-${a.id}-stmt'),
        style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
      ),
      if (st.dueDate != null)
        Text(
          _dueLine(st, zh),
          key: Key('acct-${a.id}-due'),
          style: TextStyle(
            fontSize: 11.5,
            // Overdue is the one state worth a colour. Everything else here is
            // information; this one is a thing to go and do.
            color: (st.daysToDue ?? 1) < 0
                ? palette.hibiscusDeep
                : palette.inkSoft,
          ),
        ),
    ];
  }

  String _dueLine(statement.StatementView st, bool zh) {
    final n = st.daysToDue ?? 0;
    final d = st.dueDate!.split('-');
    final when = zh ? '${d[1]}月${d[2]}日' : '${d[1]}/${d[2]}';
    if (st.billedDue <= 0) {
      return zh ? '还款日 $when · 已结清' : 'Due $when · settled';
    }
    if (n < 0) {
      return zh ? '逾期 ${-n} 天' : '${-n} days overdue';
    }
    if (n == 0) return zh ? '今天还款' : 'Due today';
    return zh ? '还款日 $when · 还有 $n 天' : 'Due $when · $n days';
  }

  /// Cards due inside a week, at the top where they will be seen.
  ///
  /// The same facts are on each card's own row; this is here because a row
  /// halfway down a list is not a reminder. Overdue reads first — it is sorted
  /// by days remaining and a negative count sorts before a positive one.
  Widget _dueBanner(bool zh) => Container(
    key: const Key('due-banner'),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(
      color: palette.hibiscus.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(Rad.md),
      border: Border.all(color: palette.hibiscus.withValues(alpha: 0.35)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          zh ? '要还款了' : 'Payments due',
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
            color: palette.hibiscusDeep,
          ),
        ),
        const SizedBox(height: 4),
        for (final d in _due)
          Padding(
            key: Key('due-${d.accountId}'),
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              _dueBannerLine(d, zh),
              style: TextStyle(fontSize: 12, color: palette.ink),
            ),
          ),
      ],
    ),
  );

  String _dueBannerLine(statement.DueView d, bool zh) {
    final amt = money.fmt(n: d.billedDue, symbol: zh ? '￥' : '\$');
    if (d.daysToDue < 0) {
      return zh
          ? '${d.accountName} $amt · 逾期 ${-d.daysToDue} 天'
          : '${d.accountName} $amt · ${-d.daysToDue} days overdue';
    }
    if (d.daysToDue == 0) {
      return zh
          ? '${d.accountName} $amt · 今天'
          : '${d.accountName} $amt · today';
    }
    return zh
        ? '${d.accountName} $amt · 还有 ${d.daysToDue} 天'
        : '${d.accountName} $amt · in ${d.daysToDue} days';
  }

  Widget _row(BuildContext context, accounts.AccountBalance a, bool zh) {
    final kindLabel = switch (a.kind) {
      'credit' => zh ? '信用' : 'Credit',
      'prepaid' => zh ? '储值' : 'Prepaid',
      'fx' => a.fxCode ?? (zh ? '外币' : 'FX'),
      _ => zh ? '现金' : 'Cash',
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Tap(
        key: Key('acct-${a.id}-open'),
        radius: Rad.md,
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => AccountDetailScreen(id: a.id, zh: zh),
          ),
        ),
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 12, 4, 12),
          decoration: BoxDecoration(
            color: palette.card,
            borderRadius: BorderRadius.circular(Rad.md),
            border: Border.all(color: palette.line),
          ),
          child: Row(
            children: [
              AcctTile(kind: a.kind),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          _name(a),
                          key: Key('acct-${a.id}-name'),
                          style: TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w600,
                            color: palette.ink,
                          ),
                        ),
                        const SizedBox(width: 6),
                        _chip(kindLabel, palette.inkSoft),
                        if (a.archived) ...[
                          const SizedBox(width: 4),
                          _chip(zh ? '已归档' : 'Archived', palette.stamen),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      money.fmt(n: a.balance, symbol: zh ? '￥' : '\$'),
                      key: Key('acct-${a.id}-bal'),
                      style: TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                        fontFeatures: tabular,
                        color: a.balance < 0 ? palette.hibiscus : palette.ink,
                      ),
                    ),
                    ..._statementLine(a, zh),
                  ],
                ),
              ),
              // Not offered for the default account: it is the fallback every
              // orphaned entry migrates to, so the core refuses both archiving
              // and deleting it, and a menu of things that do nothing is worse
              // than no menu.
              //
              // One button rather than two. An archive and a bin on every row
              // made the screen a column of icons, and both are things done to
              // an account once — they do not need to be one tap away forever.
              if (!a.isDefault)
                IconButton(
                  key: Key('acct-${a.id}-more'),
                  tooltip: zh ? '更多' : 'More',
                  icon: Icon(
                    Icons.more_horiz_rounded,
                    size: 22,
                    color: palette.inkSoft,
                  ),
                  onPressed: () => _more(a, zh),
                )
              else
                const SizedBox(width: 12),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _more(accounts.AccountBalance a, bool zh) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: palette.card,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: Key('acct-${a.id}-archive'),
              leading: Icon(
                a.archived ? Icons.unarchive_outlined : Icons.archive_outlined,
                color: palette.ink,
              ),
              title: Text(
                a.archived
                    ? (zh ? '取消归档' : 'Unarchive')
                    : (zh ? '归档' : 'Archive'),
              ),
              subtitle: a.archived
                  ? null
                  : Text(
                      zh
                          ? '不出现在记账里,历史和余额保留'
                          : 'Hidden when recording; history and balance kept',
                    ),
              onTap: () => Navigator.pop(ctx, 'archive'),
            ),
            ListTile(
              key: Key('acct-${a.id}-delete'),
              leading: Icon(Icons.delete_outline, color: palette.hibiscus),
              title: Text(
                zh ? '删除' : 'Delete',
                style: TextStyle(color: palette.hibiscus),
              ),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (choice == 'archive') {
      accounts.archiveAccount(id: a.id, archived: !a.archived);
      _changed();
    } else if (choice == 'delete') {
      await _confirmDelete(a);
    }
  }

  Widget _chip(String text, Color tone) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
    decoration: BoxDecoration(
      color: tone.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(Rad.pill),
    ),
    child: Text(
      text,
      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: tone),
    ),
  );
}

/// The new-account form.
///
/// Its own widget so it owns and disposes its controllers where Flutter expects
/// — the budget screen learned that the hard way, on a device.
class _NewAccountDialog extends StatefulWidget {
  const _NewAccountDialog({required this.zh});

  final bool zh;

  @override
  State<_NewAccountDialog> createState() => _NewAccountDialogState();
}

class _NewAccountDialogState extends State<_NewAccountDialog> {
  final _name = TextEditingController();
  final _balance = TextEditingController();
  String _kind = 'cash';
  int? _statementDay;
  int? _dueDay;

  @override
  void dispose() {
    _name.dispose();
    _balance.dispose();
    super.dispose();
  }

  /// The label colours spelled out rather than inherited.
  ///
  /// Material 3's default focused-label colour is lavender, and on a device
  /// that is what 名称 came out as — against warm paper, in an app whose accent
  /// is amber. The app theme fixes it globally; this fixes it for a dialog
  /// shown under a bare `MaterialApp`, which is how the tests show it.
  InputDecoration _fieldStyle(String label) => InputDecoration(
    labelText: label,
    labelStyle: TextStyle(color: palette.inkSoft),
    floatingLabelStyle: TextStyle(color: palette.stamen),
    focusedBorder: UnderlineInputBorder(
      borderSide: BorderSide(color: palette.stamen, width: 2),
    ),
  );

  void _submit() {
    final name = _name.text.trim();
    if (name.isEmpty) return; // a nameless account is not one
    accounts.addAccount(
      id: 'a${DateTime.now().millisecondsSinceEpoch}',
      name: name,
      balance: double.tryParse(_balance.text.replaceAll(',', '')) ?? 0,
      kind: _kind,
      // Only a credit card has a cycle. The core drops these for any other
      // kind anyway; passing them only where they mean something keeps the
      // two ends saying the same thing.
      statementDay: _kind == 'credit' ? _statementDay : null,
      dueDay: _kind == 'credit' ? _dueDay : null,
      fxCode: null,
    );
    Navigator.pop(context, true);
  }

  /// 1..28 and no further, the same ceiling the cycle start has: a card that
  /// closed on the 31st would skip February entirely.
  Widget _dayPicker({
    required String keyPrefix,
    required String label,
    required int? value,
    required void Function(int?) onPick,
    required bool zh,
  }) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const SizedBox(height: 12),
      Text(label, style: TextStyle(fontSize: 12, color: palette.inkSoft)),
      const SizedBox(height: 6),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final d in const [1, 5, 10, 15, 20, 25, 28])
            GestureDetector(
              key: Key('$keyPrefix-$d'),
              // Tapping the chosen one clears it: a card whose cycle was
              // set by mistake needs a way back to unset, and unset is a
              // real state the core reads as "no cycle configured".
              onTap: () => onPick(value == d ? null : d),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: value == d
                      ? palette.stamen.withValues(alpha: 0.18)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(Rad.pill),
                  border: Border.all(
                    color: value == d ? palette.stamen : palette.line,
                  ),
                ),
                child: Text(
                  '$d',
                  style: TextStyle(fontSize: 12, color: palette.ink),
                ),
              ),
            ),
        ],
      ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('new-account-dialog'),
      backgroundColor: palette.card,
      title: Text(
        zh ? '新建账户' : 'New account',
        style: TextStyle(fontSize: 16, color: palette.ink),
      ),
      // Scrollable because a credit card adds two more rows, and a dialog that
      // overflows on a short screen loses its buttons.
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              key: const Key('new-name'),
              controller: _name,
              autofocus: true,
              cursorColor: palette.stamen,
              decoration: _fieldStyle(zh ? '名称' : 'Name'),
            ),
            TextField(
              key: const Key('new-balance'),
              controller: _balance,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              cursorColor: palette.stamen,
              decoration: _fieldStyle(zh ? '初始余额' : 'Opening balance'),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 6,
              children: [
                for (final k in ['cash', 'credit', 'prepaid', 'fx'])
                  GestureDetector(
                    key: Key('kind-$k'),
                    onTap: () => setState(() => _kind = k),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: _kind == k
                            ? palette.stamen.withValues(alpha: 0.18)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(Rad.pill),
                        border: Border.all(
                          color: _kind == k ? palette.stamen : palette.line,
                        ),
                      ),
                      child: Text(switch (k) {
                        'credit' => zh ? '信用' : 'Credit',
                        'prepaid' => zh ? '储值' : 'Prepaid',
                        'fx' => zh ? '外币' : 'FX',
                        _ => zh ? '现金' : 'Cash',
                      }, style: TextStyle(fontSize: 12, color: palette.ink)),
                    ),
                  ),
              ],
            ),
            if (_kind == 'credit') ...[
              _dayPicker(
                keyPrefix: 'stmt-day',
                label: zh ? '出账日' : 'Statement day',
                value: _statementDay,
                onPick: (d) => setState(() => _statementDay = d),
                zh: zh,
              ),
              _dayPicker(
                keyPrefix: 'due-day',
                label: zh ? '还款日' : 'Due day',
                value: _dueDay,
                onPick: (d) => setState(() => _dueDay = d),
                zh: zh,
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const Key('new-cancel'),
          onPressed: () => Navigator.pop(context, false),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('new-ok'),
          onPressed: _submit,
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(zh ? '创建' : 'Create'),
        ),
      ],
    );
  }
}
