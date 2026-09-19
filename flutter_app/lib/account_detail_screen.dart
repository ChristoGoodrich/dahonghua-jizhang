// 账户明细 — one account's history.
//
// The last screen the React Native app had that this one did not.
//
// What belongs on the list, and the number at the end of each row, is
// `core::acct` — 5,400 parity cases, because the rules are not obvious. A
// transfer appears on both accounts with *different* deltas: the sender pays
// the fee, the recipient receives the discount, so the two rows are not
// negatives of each other. An entry with no account at all belongs to
// `default`, which is what the ledger looked like before accounts existed.
//
// None of that is decided here. This draws it.

import 'package:flutter/material.dart';

import 'src/rust/api/acct.dart' as acct;
import 'src/rust/api/accounts.dart' as accounts;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/statement.dart' as statement;
import 'src/rust/api/store.dart' as store;
import 'glass.dart';
import 'empty_note.dart';
import 'theme.dart';

String _acctEmoji(String kind) => switch (kind) {
  'credit' => '💳',
  'prepaid' => '🎫',
  _ => '👛',
};

class AccountDetailScreen extends StatelessWidget {
  const AccountDetailScreen({super.key, required this.id, this.zh = true});

  final String id;
  final bool zh;

  String _name(accounts.AccountBalance a) => zh ? a.name : (a.nameEn ?? a.name);

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final all = accounts.balances();
    final match = all.where((a) => a.id == id);
    final account = match.isEmpty ? null : match.first;
    final rows = acct.rowsForAccount(id: id);

    final bal = account?.balance ?? 0;
    // A credit card with a negative balance is money owed, and calling that
    // "balance: -1,200" reads as a loss rather than a debt.
    final owed = account?.kind == 'credit' && bal < 0;

    return ScrimScaffold(
      title: Text(
        account == null
            ? (zh ? '账户' : 'Account')
            : '${_acctEmoji(account.kind)} ${_name(account)}',
        key: const Key('acct-detail-title'),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, headerInset(context) + 16, 16, 16),
        children: [
          Container(
            key: const Key('acct-detail-balance'),
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
            decoration: BoxDecoration(
              color: p.ink,
              borderRadius: BorderRadius.circular(Rad.md),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  owed ? (zh ? '欠款' : 'Owed') : (zh ? '余额' : 'Balance'),
                  style: TextStyle(
                    color: p.paper.withValues(alpha: 0.7),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  money.fmt(n: owed ? -bal : bal, symbol: zh ? '￥' : '\$'),
                  key: const Key('acct-detail-balance-value'),
                  style: TextStyle(
                    color: p.paper,
                    fontSize: 26,
                    fontWeight: FontWeight.w700,
                    fontFeatures: tabular,
                  ),
                ),
              ],
            ),
          ),
          if (account != null) ..._statement(account, p),
          const SizedBox(height: 16),
          Text(
            zh ? '这个账户的流水' : 'What moved through it',
            style: TextStyle(color: p.inkSoft, fontSize: 13),
          ),
          const SizedBox(height: 8),
          if (rows.isEmpty)
            EmptyNote(
              key: const Key('acct-detail-empty'),
              icon: Icons.receipt_long_outlined,
              text: zh ? '还没有流水' : 'Nothing here yet',
            )
          else
            ...rows.map((r) => _row(r, p)),
        ],
      ),
    );
  }

  List<Widget> _statement(accounts.AccountBalance a, Palette p) {
    if (a.kind != 'credit') return const [];

    // The days are Dart's, as everywhere: a statement closes on a calendar day
    // and which day an entry falls on is this device's zone to answer. The
    // accounts screen builds these the same way, for the same reason.
    final live = store.liveEntries();
    final now = DateTime.now();
    final s = statement.statementOf(
      accountId: a.id,
      ids: live.map((e) => e.id).toList(),
      daysOf: live.map((e) {
        final d = DateTime.fromMillisecondsSinceEpoch(e.ts);
        return '${d.year}-${d.month}-${d.day}';
      }).toList(),
      today: '${now.year}-${now.month}-${now.day}',
    );
    if (s == null || s.dueDate == null) return const [];

    final days = s.daysToDue;
    final rel = days == null
        ? ''
        : days > 0
        ? (zh ? '还有 $days 天' : '$days days left')
        : days == 0
        ? (zh ? '今天到期' : 'Due today')
        : (zh ? '逾期 ${-days} 天' : '${-days} days overdue');

    return [
      const SizedBox(height: 12),
      Container(
        key: const Key('acct-detail-statement'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: p.card,
          borderRadius: BorderRadius.circular(Rad.md),
          border: Border.all(color: p.line),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              zh ? '本期账单' : 'This statement',
              style: TextStyle(color: p.inkSoft, fontSize: 13),
            ),
            Text(
              rel,
              key: const Key('acct-detail-due'),
              style: TextStyle(color: p.ink, fontSize: 13),
            ),
          ],
        ),
      ),
    ];
  }

  Widget _row(acct.AcctRowView r, Palette p) {
    final e = r.entry;
    // The delta's sign, not the entry's direction. A transfer is an expense on
    // one side and income on the other, and the row is about *this* account.
    final positive = r.delta > 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        key: Key('acct-row-${e.id}'),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: p.card,
          borderRadius: BorderRadius.circular(Rad.md),
          border: Border.all(color: p.line),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    e.io == 'xfer'
                        ? (zh ? '转账' : 'Transfer')
                        : (e.note?.isNotEmpty == true ? e.note! : e.cat),
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: p.ink,
                    ),
                  ),
                  if (e.io != 'xfer' && e.note?.isNotEmpty == true) ...[
                    const SizedBox(height: 2),
                    Text(
                      e.cat,
                      style: TextStyle(fontSize: 12, color: p.inkSoft),
                    ),
                  ],
                ],
              ),
            ),
            Text(
              money.fmt(n: r.delta, symbol: zh ? '￥' : '\$'),
              key: Key('acct-row-${e.id}-delta'),
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                fontFeatures: tabular,
                color: positive ? p.leafDeep : p.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
