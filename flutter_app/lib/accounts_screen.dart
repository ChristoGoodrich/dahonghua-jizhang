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
import 'theme.dart';

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
  bool _showArchived = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    setState(() {
      _rows = accounts.balances();
      _total = accounts.totalBalance();
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
        title: Text(zh ? '删除账户' : 'Delete account',
            style: TextStyle(fontSize: 16, color: palette.ink)),
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
    final shown =
        _rows.where((a) => _showArchived || !a.archived).toList();
    final archivedCount = _rows.where((a) => a.archived).length;

    return Scaffold(
      backgroundColor: palette.paper,
      appBar: AppBar(
        backgroundColor: palette.paper,
        surfaceTintColor: Colors.transparent,
        title: Text(zh ? '账户' : 'Accounts',
            style: TextStyle(
                color: palette.ink, fontSize: 20, fontWeight: FontWeight.w700)),
        actions: [
          IconButton(
            key: const Key('add-account'),
            icon: Icon(Icons.add, color: palette.ink),
            onPressed: _add,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 6, 22, 120),
        children: [
          _totalCard(zh),
          const SizedBox(height: 16),
          for (final a in shown) _row(a, zh),
          if (archivedCount > 0)
            TextButton(
              key: const Key('toggle-archived'),
              onPressed: () => setState(() => _showArchived = !_showArchived),
              style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
              child: Text(_showArchived
                  ? (zh ? '隐藏已归档' : 'Hide archived')
                  : (zh ? '显示已归档($archivedCount)' : 'Show archived ($archivedCount)')),
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
            Text(zh ? '账户合计' : 'Total',
                style: TextStyle(fontSize: 12, color: palette.inkSoft)),
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

  Widget _row(accounts.AccountBalance a, bool zh) {
    final kindLabel = switch (a.kind) {
      'credit' => zh ? '信用' : 'Credit',
      'prepaid' => zh ? '储值' : 'Prepaid',
      'fx' => a.fxCode ?? (zh ? '外币' : 'FX'),
      _ => zh ? '现金' : 'Cash',
    };
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
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Text(_name(a),
                        key: Key('acct-${a.id}-name'),
                        style: TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w600,
                            color: palette.ink)),
                    const SizedBox(width: 6),
                    _chip(kindLabel, palette.inkSoft),
                    if (a.archived) ...[
                      const SizedBox(width: 4),
                      _chip(zh ? '已归档' : 'Archived', palette.stamen),
                    ],
                  ]),
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
                ],
              ),
            ),
            // Neither button is offered for the default account: it is the
            // fallback every orphaned entry migrates to, so the core refuses
            // both, and a button that does nothing when pressed is worse than
            // no button at all.
            if (!a.isDefault) ...[
              IconButton(
                key: Key('acct-${a.id}-archive'),
                tooltip: a.archived
                    ? (zh ? '取消归档' : 'Unarchive')
                    : (zh ? '归档' : 'Archive'),
                icon: Icon(
                  a.archived
                      ? Icons.unarchive_outlined
                      : Icons.archive_outlined,
                  size: 20,
                  color: palette.inkSoft,
                ),
                onPressed: () {
                  accounts.archiveAccount(id: a.id, archived: !a.archived);
                  _changed();
                },
              ),
              IconButton(
                key: Key('acct-${a.id}-delete'),
                tooltip: zh ? '删除' : 'Delete',
                icon: Icon(Icons.delete_outline,
                    size: 20, color: palette.hibiscus),
                onPressed: () => _confirmDelete(a),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _chip(String text, Color tone) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(Rad.pill),
        ),
        child: Text(text,
            style: TextStyle(
                fontSize: 10, fontWeight: FontWeight.w700, color: tone)),
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
      statementDay: null,
      dueDay: null,
      fxCode: null,
    );
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('new-account-dialog'),
      backgroundColor: palette.card,
      title: Text(zh ? '新建账户' : 'New account',
          style: TextStyle(fontSize: 16, color: palette.ink)),
      content: Column(
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
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
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
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: _kind == k
                          ? palette.stamen.withValues(alpha: 0.18)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(Rad.pill),
                      border: Border.all(
                          color: _kind == k ? palette.stamen : palette.line),
                    ),
                    child: Text(
                      switch (k) {
                        'credit' => zh ? '信用' : 'Credit',
                        'prepaid' => zh ? '储值' : 'Prepaid',
                        'fx' => zh ? '外币' : 'FX',
                        _ => zh ? '现金' : 'Cash',
                      },
                      style: TextStyle(fontSize: 12, color: palette.ink),
                    ),
                  ),
                ),
            ],
          ),
        ],
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
