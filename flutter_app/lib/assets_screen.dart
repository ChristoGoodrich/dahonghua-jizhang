// 资产 — everything you hold, and everything you owe.
//
// Three lists on one screen because they answer one question between them:
// accounts hold money that moves, assets hold money that does not, and loans
// are money in someone else's hands. Net worth is the sum, and the split into
// two cards has one rule the screen does not get to re-decide: a credit account
// **in debt** is a liability, and every other account — an overpaid card
// included — is an asset.
//
// Managing accounts lives one level down. Reading a balance is the frequent
// thing; creating and deleting accounts is not.

import 'package:flutter/material.dart';

import 'accounts_screen.dart';
import 'amounts.dart';
import 'src/rust/api/accounts.dart' as accounts;
import 'src/rust/api/networth.dart' as nw;
import 'src/rust/api/privacy.dart' as privacy;
import 'tap.dart';
import 'glass.dart';
import 'theme.dart';

class AssetsScreen extends StatefulWidget {
  const AssetsScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;

  /// Assets, loans or the ledger changed.
  final VoidCallback? onChanged;

  @override
  State<AssetsScreen> createState() => _AssetsScreenState();
}

class _AssetsScreenState extends State<AssetsScreen> {
  late nw.NetWorthView _net;
  List<accounts.AccountBalance> _accounts = const [];
  List<nw.AssetView> _assets = const [];
  List<nw.LoanView> _loans = const [];

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    setState(() {
      _net = nw.netWorth();
      _accounts = accounts.balances().where((a) => !a.archived).toList();
      _assets = nw.assets();
      _loans = nw.loans();
    });
  }

  void _changed() {
    widget.onChanged?.call();
    _reload();
  }

  String _m(double v) => shownAmount(v, baseSymbol());

  Future<void> _manageAccounts() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            AccountsScreen(zh: widget.zh, onChanged: widget.onChanged),
      ),
    );
    _reload();
  }

  Future<void> _addAsset() async {
    final made = await showDialog<bool>(
      context: context,
      builder: (_) => _NewAssetDialog(zh: widget.zh),
    );
    if (made == true) _changed();
  }

  Future<void> _addLoan() async {
    final made = await showDialog<bool>(
      context: context,
      builder: (_) => _NewLoanDialog(zh: widget.zh),
    );
    if (made == true) _changed();
  }

  Future<void> _repay(nw.LoanView l) async {
    final amount = await showDialog<double>(
      context: context,
      builder: (_) => _RepayDialog(zh: widget.zh, loan: l),
    );
    if (amount == null) return;
    nw.repayLoan(id: l.id, amount: amount);
    _changed();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return TitledScaffold(
      title: zh ? '资产' : 'Net worth',
      // The same eye as 明细's: one setting, and 资产 is the other screen
      // whose totals someone might not want read over their shoulder.
      actions: [
        IconButton(
          key: const Key('assets-hide-amounts'),
          tooltip: privacy.hideAmounts()
              ? (zh ? '显示金额' : 'Show amounts')
              : (zh ? '隐藏金额' : 'Hide amounts'),
          icon: Icon(
            privacy.hideAmounts()
                ? Icons.visibility_off_outlined
                : Icons.visibility_outlined,
            color: palette.ink,
          ),
          onPressed: () {
            privacy.setHideAmounts(hidden: !privacy.hideAmounts());
            _changed();
          },
        ),
      ],
      body: (context, b) => ListView(
        controller: b.controller,
        padding: EdgeInsets.fromLTRB(22, b.top, 22, 120),
        children: [
          b.header,
          _netCard(zh),
          const SizedBox(height: 22),
          _section(
            zh ? '账户' : 'Accounts',
            action: zh ? '管理' : 'Manage',
            onAction: _manageAccounts,
            actionKey: 'manage-accounts',
          ),
          // One card, like a day in 明细: they are one list, and a card each
          // made the section look longer than the four rows it is.
          if (_accounts.isNotEmpty)
            _group([for (final a in _accounts) _acctLine(a, zh)]),
          const SizedBox(height: 22),
          _section(
            zh ? '其他资产' : 'Other assets',
            action: zh ? '添加' : 'Add',
            onAction: _addAsset,
            actionKey: 'add-asset',
          ),
          if (_assets.isEmpty)
            _empty(
              zh ? '房子、车、公积金…' : 'A flat, a car, a pension…',
              'no-assets',
              icon: Icons.home_work_outlined,
              onTap: _addAsset,
            ),
          for (final a in _assets) _assetLine(a, zh),
          const SizedBox(height: 22),
          _section(
            zh ? '借贷' : 'Loans',
            action: zh ? '添加' : 'Add',
            onAction: _addLoan,
            actionKey: 'add-loan',
          ),
          if (_loans.isEmpty)
            _empty(
              zh ? '借出去的、借进来的' : 'Lent out, or borrowed',
              'no-loans',
              icon: Icons.handshake_outlined,
              onTap: _addLoan,
            ),
          for (final l in _loans) _loanLine(l, zh),
        ],
      ),
    );
  }

  /// The two halves and the difference.
  ///
  /// Dark, because it is the one number on the screen that is a conclusion
  /// rather than an item — the shipping app makes the same move.
  /// The hero slab, and what it is painted on.
  ///
  /// It used to be `palette.ink` with the text hardcoded white. Ink is the
  /// DARK colour in a lit room and the LIGHT one in a dark room, so in 夜间模式
  /// the card turned cream and its white text disappeared into it — 总资产 and
  /// 总负债 were not dim, they were invisible. Nothing here had been looked at
  /// in the dark.
  ///
  /// So the slab and its text are chosen together. Lit, it stays the ink slab
  /// with paper-coloured type. Dark, it is the card surface warmed a touch
  /// toward the flower, so it still reads as the one heavy object on the
  /// screen without becoming a lamp in a dark room.
  Color get _slab => palette.isDark
      ? Color.alphaBlend(palette.hibiscus.withValues(alpha: 0.14), palette.card)
      : palette.ink;
  Color get _onSlab => palette.isDark ? palette.ink : palette.paper;

  Widget _netCard(bool zh) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
    decoration: BoxDecoration(
      color: _slab,
      borderRadius: BorderRadius.circular(Rad.lg),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          zh ? '净资产' : 'Net worth',
          style: TextStyle(
            fontSize: 12,
            color: _onSlab.withValues(alpha: 0.62),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          _m(_net.net),
          key: const Key('net-worth'),
          style: TextStyle(
            fontSize: 30,
            fontWeight: FontWeight.w700,
            fontFeatures: tabular,
            color: _onSlab,
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: _half(zh ? '总资产' : 'Assets', _net.asset, 'nw-asset'),
            ),
            Expanded(
              child: _half(zh ? '总负债' : 'Liabilities', _net.liab, 'nw-liab'),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _half(String label, double v, String key) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: TextStyle(fontSize: 11, color: _onSlab.withValues(alpha: 0.55)),
      ),
      const SizedBox(height: 2),
      Text(
        _m(v),
        key: Key(key),
        style: TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          fontFeatures: tabular,
          color: _onSlab.withValues(alpha: 0.92),
        ),
      ),
    ],
  );

  Widget _section(
    String title, {
    required String action,
    required VoidCallback onAction,
    required String actionKey,
  }) => Padding(
    padding: const EdgeInsets.only(left: 4, bottom: 8),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: palette.inkSoft,
            ),
          ),
        ),
        GestureDetector(
          key: Key(actionKey),
          onTap: onAction,
          child: Text(
            action,
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

  /// An empty section, as the place its first item goes.
  ///
  /// It was a line of grey text under a heading, which read as a section that
  /// had not been finished rather than one with nothing in it yet. Now it is
  /// the shape a row will be, faint, with what goes there — and pressing it
  /// adds one, the same as 添加 beside the heading.
  Widget _empty(
    String text,
    String key, {
    required IconData icon,
    required VoidCallback onTap,
  }) => Tap(
    radius: Rad.md,
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(
        color: palette.card.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(Rad.md),
        border: Border.all(color: palette.line),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: palette.hibiscus.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 19, color: palette.hibiscus),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              key: Key(key),
              style: TextStyle(fontSize: 13, color: palette.inkSoft),
            ),
          ),
          Icon(Icons.add_rounded, size: 20, color: palette.hibiscus),
        ],
      ),
    ),
  );

  /// Rows that are one list, as one card with hairlines between them.
  Widget _group(List<Widget> rows) => Container(
    decoration: BoxDecoration(
      color: palette.card,
      borderRadius: BorderRadius.circular(Rad.md),
      border: Border.all(color: palette.line),
    ),
    child: Column(
      children: [
        for (var i = 0; i < rows.length; i++) ...[
          rows[i],
          if (i != rows.length - 1)
            Divider(
              height: 1,
              thickness: 1 / MediaQuery.devicePixelRatioOf(context),
              color: palette.line,
              // under the name, not under the tile
              indent: 12 + 38 + 12,
            ),
        ],
      ],
    ),
  );

  Widget _acctLine(accounts.AccountBalance a, bool zh) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    child: Row(
      children: [
        AcctTile(kind: a.kind),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            zh ? a.name : (a.nameEn ?? a.name),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w600,
              color: palette.ink,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          _m(a.balance),
          key: Key('nw-acct-${a.id}-val'),
          style: TextStyle(
            fontSize: 14.5,
            fontWeight: FontWeight.w700,
            fontFeatures: tabular,
            color: a.balance < 0 ? palette.warn : palette.ink,
          ),
        ),
      ],
    ),
  );

  Widget _line({
    required String key,
    required String title,
    required double value,
    bool negative = false,
    String? sub,
    Widget? trailing,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: palette.card,
        borderRadius: BorderRadius.circular(Rad.md),
        border: Border.all(color: palette.line),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: palette.ink,
                  ),
                ),
                if (sub != null) ...[
                  const SizedBox(height: 1),
                  Text(
                    sub,
                    style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
                  ),
                ],
              ],
            ),
          ),
          Text(
            _m(value),
            key: Key('$key-val'),
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
              fontFeatures: tabular,
              color: negative ? palette.warn : palette.ink,
            ),
          ),
          ?trailing,
        ],
      ),
    ),
  );

  Widget _assetLine(nw.AssetView a, bool zh) => _line(
    key: 'nw-asset-${a.id}',
    title: a.name,
    // an excluded asset says so, because otherwise it looks like the total
    // is simply wrong
    sub: a.noCount
        ? (zh ? '不计入净资产' : 'Not counted')
        : (a.kind == 'liab' ? (zh ? '负债' : 'Liability') : null),
    value: a.val,
    negative: a.kind == 'liab',
    trailing: Row(
      children: [
        IconButton(
          key: Key('nw-asset-${a.id}-count'),
          tooltip: a.noCount ? (zh ? '计入' : 'Count') : (zh ? '不计入' : 'Exclude'),
          icon: Icon(
            a.noCount
                ? Icons.visibility_off_outlined
                : Icons.visibility_outlined,
            size: 19,
            color: palette.inkSoft,
          ),
          onPressed: () {
            nw.setAssetNoCount(id: a.id, noCount: !a.noCount);
            _changed();
          },
        ),
        IconButton(
          key: Key('nw-asset-${a.id}-delete'),
          tooltip: zh ? '删除' : 'Delete',
          icon: Icon(Icons.delete_outline, size: 19, color: palette.warn),
          onPressed: () {
            nw.removeAsset(id: a.id);
            _changed();
          },
        ),
      ],
    ),
  );

  Widget _loanLine(nw.LoanView l, bool zh) {
    final lent = l.kind == 'lend';
    final settled = l.remaining <= 0;
    return _line(
      key: 'nw-loan-${l.id}',
      title: l.who,
      sub: settled
          ? (zh ? '已结清' : 'Settled')
          : (zh
                ? '${lent ? '借出' : '借入'} · 已还 ${_m(l.repaid)}'
                : '${lent ? 'Lent' : 'Borrowed'} · ${_m(l.repaid)} repaid'),
      value: l.remaining,
      negative: !lent && !settled,
      trailing: Row(
        children: [
          if (!settled)
            IconButton(
              key: Key('nw-loan-${l.id}-repay'),
              tooltip: zh ? '还款' : 'Repay',
              icon: Icon(
                Icons.payments_outlined,
                size: 19,
                color: palette.leafDeep,
              ),
              onPressed: () => _repay(l),
            ),
          IconButton(
            key: Key('nw-loan-${l.id}-delete'),
            tooltip: zh ? '删除' : 'Delete',
            icon: Icon(Icons.delete_outline, size: 19, color: palette.warn),
            onPressed: () {
              nw.removeLoan(id: l.id);
              _changed();
            },
          ),
        ],
      ),
    );
  }
}

/// Shared dialog chrome, so the three forms below look like one thing.
InputDecoration fieldStyle(String label) => InputDecoration(
  labelText: label,
  labelStyle: TextStyle(color: palette.inkSoft),
  floatingLabelStyle: TextStyle(color: palette.stamen),
  focusedBorder: UnderlineInputBorder(
    borderSide: BorderSide(color: palette.stamen, width: 2),
  ),
);

Widget pickChip({
  required String key,
  required String label,
  required bool on,
  required VoidCallback onTap,
}) => Tap(
  radius: Rad.pill,
  key: Key(key),
  onTap: onTap,
  child: Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
    decoration: BoxDecoration(
      color: on ? palette.stamen.withValues(alpha: 0.18) : Colors.transparent,
      borderRadius: BorderRadius.circular(Rad.pill),
      border: Border.all(color: on ? palette.stamen : palette.line),
    ),
    child: Text(label, style: TextStyle(fontSize: 12.5, color: palette.ink)),
  ),
);

class _NewAssetDialog extends StatefulWidget {
  const _NewAssetDialog({required this.zh});
  final bool zh;
  @override
  State<_NewAssetDialog> createState() => _NewAssetDialogState();
}

class _NewAssetDialogState extends State<_NewAssetDialog> {
  final _name = TextEditingController();
  final _val = TextEditingController();
  String _kind = 'asset';

  @override
  void dispose() {
    _name.dispose();
    _val.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _name.text.trim();
    final v = double.tryParse(_val.text.replaceAll(',', '')) ?? 0;
    // the shipping form refuses both by doing nothing
    if (name.isEmpty || v <= 0) return;
    nw.addAsset(
      id: 'as${DateTime.now().millisecondsSinceEpoch}',
      name: name,
      kind: _kind,
      val: v,
    );
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('new-asset-dialog'),
      backgroundColor: palette.card,
      title: Text(
        zh ? '添加资产' : 'Add asset',
        style: TextStyle(fontSize: 16, color: palette.ink),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            key: const Key('asset-name'),
            controller: _name,
            autofocus: true,
            cursorColor: palette.stamen,
            decoration: fieldStyle(zh ? '名称' : 'Name'),
          ),
          TextField(
            key: const Key('asset-val'),
            controller: _val,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            cursorColor: palette.stamen,
            decoration: fieldStyle(zh ? '价值' : 'Value'),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            children: [
              pickChip(
                key: 'asset-kind-asset',
                label: zh ? '资产' : 'Asset',
                on: _kind == 'asset',
                onTap: () => setState(() => _kind = 'asset'),
              ),
              pickChip(
                key: 'asset-kind-liab',
                label: zh ? '负债' : 'Liability',
                on: _kind == 'liab',
                onTap: () => setState(() => _kind = 'liab'),
              ),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(
          key: const Key('asset-cancel'),
          onPressed: () => Navigator.pop(context, false),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('asset-ok'),
          onPressed: _submit,
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(zh ? '添加' : 'Add'),
        ),
      ],
    );
  }
}

class _NewLoanDialog extends StatefulWidget {
  const _NewLoanDialog({required this.zh});
  final bool zh;
  @override
  State<_NewLoanDialog> createState() => _NewLoanDialogState();
}

class _NewLoanDialogState extends State<_NewLoanDialog> {
  final _who = TextEditingController();
  final _amt = TextEditingController();
  String _kind = 'lend';

  @override
  void dispose() {
    _who.dispose();
    _amt.dispose();
    super.dispose();
  }

  void _submit() {
    final who = _who.text.trim();
    final v = double.tryParse(_amt.text.replaceAll(',', '')) ?? 0;
    if (who.isEmpty || v <= 0) return;
    nw.addLoan(
      id: 'ln${DateTime.now().millisecondsSinceEpoch}',
      who: who,
      kind: _kind,
      amt: v,
      ts: DateTime.now().millisecondsSinceEpoch,
    );
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('new-loan-dialog'),
      backgroundColor: palette.card,
      title: Text(
        zh ? '添加借贷' : 'Add loan',
        style: TextStyle(fontSize: 16, color: palette.ink),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            key: const Key('loan-who'),
            controller: _who,
            autofocus: true,
            cursorColor: palette.stamen,
            decoration: fieldStyle(zh ? '谁' : 'Who'),
          ),
          TextField(
            key: const Key('loan-amt'),
            controller: _amt,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            cursorColor: palette.stamen,
            decoration: fieldStyle(zh ? '金额' : 'Amount'),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            children: [
              pickChip(
                key: 'loan-kind-lend',
                label: zh ? '借出' : 'Lent',
                on: _kind == 'lend',
                onTap: () => setState(() => _kind = 'lend'),
              ),
              pickChip(
                key: 'loan-kind-borrow',
                label: zh ? '借入' : 'Borrowed',
                on: _kind == 'borrow',
                onTap: () => setState(() => _kind = 'borrow'),
              ),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(
          key: const Key('loan-cancel'),
          onPressed: () => Navigator.pop(context, false),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('loan-ok'),
          onPressed: _submit,
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(zh ? '添加' : 'Add'),
        ),
      ],
    );
  }
}

class _RepayDialog extends StatefulWidget {
  const _RepayDialog({required this.zh, required this.loan});
  final bool zh;
  final nw.LoanView loan;
  @override
  State<_RepayDialog> createState() => _RepayDialogState();
}

class _RepayDialogState extends State<_RepayDialog> {
  late final TextEditingController _amt = TextEditingController(
    text: widget.loan.remaining.toStringAsFixed(2),
  );

  @override
  void dispose() {
    _amt.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('repay-dialog'),
      backgroundColor: palette.card,
      title: Text(
        zh ? '还款' : 'Repay',
        style: TextStyle(fontSize: 16, color: palette.ink),
      ),
      content: TextField(
        key: const Key('repay-amt'),
        controller: _amt,
        autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        cursorColor: palette.stamen,
        decoration: fieldStyle(zh ? '金额' : 'Amount'),
      ),
      actions: [
        TextButton(
          key: const Key('repay-cancel'),
          onPressed: () => Navigator.pop(context),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('repay-ok'),
          onPressed: () {
            final v = double.tryParse(_amt.text.replaceAll(',', ''));
            if (v == null) return;
            // Not clamped here. The core caps an overpayment at what is still
            // owed and deliberately leaves a negative amount alone, which is
            // how a mis-tap gets undone — re-deciding that on this side would
            // be a second implementation of the same rule.
            Navigator.pop(context, v);
          },
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(zh ? '确定' : 'OK'),
        ),
      ],
    );
  }
}
