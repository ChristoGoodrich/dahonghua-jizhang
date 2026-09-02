// 报销 — money you spent that someone else is meant to give back.
//
// Two totals and one list. The totals do not measure the same thing and that is
// deliberate: 待报销 sums what was SPENT, 已报销 sums what came BACK. A claim
// settled for less than it cost shows the difference between them, which is the
// number the screen exists to show.
//
// Every write goes through the ledger's stamping, including the ones that
// clear. Writing `rb` without a per-field time left it to the merge's content
// tiebreak, so marking something 已报销 on one device could be silently
// reverted by a staler one — and clearing has to beat a device still holding
// `pending`.

import 'package:flutter/material.dart';

import 'src/rust/api/money.dart' as money;
import 'src/rust/api/reimburse.dart' as rb;
import 'theme.dart';

class ReimburseScreen extends StatefulWidget {
  const ReimburseScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;
  final VoidCallback? onChanged;

  @override
  State<ReimburseScreen> createState() => _ReimburseScreenState();
}

class _ReimburseScreenState extends State<ReimburseScreen> {
  late rb.ClaimList _claims;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() => setState(() => _claims = rb.claims(zh: widget.zh));

  void _changed() {
    widget.onChanged?.call();
    _reload();
  }

  String _m(double v) => money.fmt(n: v, symbol: widget.zh ? '￥' : '\$');

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return Scaffold(
      backgroundColor: palette.paper,
      appBar: AppBar(
        backgroundColor: palette.paper,
        surfaceTintColor: Colors.transparent,
        title: Text(zh ? '报销' : 'Reimbursements',
            style: TextStyle(
                color: palette.ink, fontSize: 20, fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 6, 22, 120),
        children: [
          Row(children: [
            Expanded(
                child: _total(zh ? '待报销' : 'Outstanding', _claims.pendingSum,
                    const Color(0xFF9A7B45), 'rb-pending-sum')),
            const SizedBox(width: 10),
            Expanded(
                child: _total(zh ? '已报销' : 'Reimbursed', _claims.doneSum,
                    palette.leafDeep, 'rb-done-sum')),
          ]),
          const SizedBox(height: 20),
          if (_claims.items.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 40),
              child: Text(
                zh
                    ? '在账目里长按一笔,标成待报销'
                    : 'Long-press an entry to mark it for reimbursement',
                key: const Key('no-claims'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13.5, color: palette.inkSoft),
              ),
            ),
          for (final c in _claims.items) _row(c, zh),
        ],
      ),
    );
  }

  Widget _total(String label, double v, Color tone, String key) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        decoration: BoxDecoration(
          color: palette.card,
          borderRadius: BorderRadius.circular(Rad.lg),
          border: Border.all(color: palette.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: TextStyle(fontSize: 12, color: palette.inkSoft)),
            const SizedBox(height: 3),
            Text(_m(v),
                key: Key(key),
                style: TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w700,
                    fontFeatures: tabular,
                    color: tone)),
          ],
        ),
      );

  Widget _row(rb.ClaimView c, bool zh) {
    final pending = c.state == 'pending';
    final date = DateTime.fromMillisecondsSinceEpoch(c.ts);
    // A settled claim that came back for less than it cost says both numbers.
    // One of them alone would be a different fact.
    final shortfall = !pending && c.rbAmt != c.amt;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: palette.card,
          borderRadius: BorderRadius.circular(Rad.md),
          border: Border.all(color: palette.line),
        ),
        child: Row(children: [
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: parseHex(c.color, opacity: 0.13),
              borderRadius: BorderRadius.circular(Rad.sm),
            ),
            child: Text(c.emoji, style: const TextStyle(fontSize: 18)),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Flexible(
                    child: Text(c.note.isEmpty ? c.name : c.note,
                        key: Key('claim-${c.id}-name'),
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w600,
                            color: palette.ink)),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: pending
                          ? const Color(0xFFF2DEC8)
                          : const Color(0xFFD6E8DD),
                      borderRadius: BorderRadius.circular(Rad.pill),
                    ),
                    child: Text(
                      pending ? (zh ? '待报销' : 'Pending') : (zh ? '已报销' : 'Done'),
                      key: Key('claim-${c.id}-state'),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: pending
                            ? const Color(0xFF9A7B45)
                            : palette.leafDeep,
                      ),
                    ),
                  ),
                ]),
                const SizedBox(height: 2),
                Text(
                  shortfall
                      ? (zh
                          ? '${date.month}月${date.day}日 · 花了 ${_m(c.amt)}'
                          : '${date.month}/${date.day} · spent ${_m(c.amt)}')
                      : (zh
                          ? '${date.month}月${date.day}日'
                          : '${date.month}/${date.day}'),
                  key: Key('claim-${c.id}-sub'),
                  style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
                ),
              ],
            ),
          ),
          Text(
            _m(pending ? c.amt : c.rbAmt),
            key: Key('claim-${c.id}-amt'),
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
              fontFeatures: tabular,
              color: palette.ink,
            ),
          ),
          if (pending)
            IconButton(
              key: Key('claim-${c.id}-confirm'),
              tooltip: zh ? '已收到' : 'Settle',
              icon: Icon(Icons.check_circle_outline,
                  size: 20, color: palette.leafDeep),
              onPressed: () {
                rb.confirmReimburse(
                    id: c.id, now: DateTime.now().millisecondsSinceEpoch);
                _changed();
              },
            ),
          IconButton(
            key: Key('claim-${c.id}-unmark'),
            tooltip: zh ? '取消标记' : 'Unmark',
            icon: Icon(Icons.close, size: 19, color: palette.inkSoft),
            onPressed: () {
              rb.unmarkReimburse(
                  id: c.id, now: DateTime.now().millisecondsSinceEpoch);
              _changed();
            },
          ),
        ]),
      ),
    );
  }
}

/// The menu an entry offers on a long press: claim it, or refund it.
///
/// Both are ledger writes rather than form fields, which is why they are here
/// and not on the record sheet — a draft that had already written half of
/// itself would be a confusing thing to cancel.
Future<bool> showEntryActions(
  BuildContext context, {
  required String id,
  required double amt,
  required bool isPending,
  bool zh = true,
  VoidCallback? onDelete,
}) async {
  final action = await showModalBottomSheet<String>(
    context: context,
    backgroundColor: palette.card,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            key: const Key('action-reimburse'),
            leading: Icon(Icons.receipt_long, color: palette.hibiscus),
            title: Text(
              isPending
                  ? (zh ? '取消待报销' : 'Clear the claim')
                  : (zh ? '标为待报销' : 'Mark for reimbursement'),
              style: TextStyle(fontSize: 15, color: palette.ink),
            ),
            onTap: () => Navigator.pop(ctx, 'reimburse'),
          ),
          ListTile(
            key: const Key('action-refund'),
            leading: Icon(Icons.undo, color: palette.hibiscus),
            title: Text(zh ? '退款' : 'Refund',
                style: TextStyle(fontSize: 15, color: palette.ink)),
            subtitle: Text(
              zh ? '退回一部分或全部,并记一笔收入' : 'Log the money coming back',
              style: TextStyle(fontSize: 12, color: palette.inkSoft),
            ),
            onTap: () => Navigator.pop(ctx, 'refund'),
          ),
          if (onDelete != null) ...[
            Divider(height: 1, color: palette.line),
            // Deleting is a swipe as well, which is how the shipping app did
            // it and still works. It is here too because a gesture with no
            // visible affordance is a gesture that has to be known about
            // already, and the menu is where someone looks when it is not.
            ListTile(
              key: const Key('action-delete'),
              leading: Icon(Icons.delete_outline, color: palette.hibiscus),
              title: Text(zh ? '删除' : 'Delete',
                  style: TextStyle(fontSize: 15, color: palette.ink)),
              subtitle: Text(
                zh ? '可以撤销' : 'Can be undone',
                style: TextStyle(fontSize: 12, color: palette.inkSoft),
              ),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
          ],
        ],
      ),
    ),
  );
  if (action == null || !context.mounted) return false;

  if (action == 'delete') {
    // The caller owns the deletion, because it owns the undo: the snackbar has
    // to outlive this sheet, and the list is what can put the row back.
    onDelete?.call();
    return false;
  }

  final now = DateTime.now().millisecondsSinceEpoch;
  if (action == 'reimburse') {
    // Toggling only CLEARS when the claim is pending — a settled one re-opens
    // rather than disappearing. That is the core's rule, not this menu's.
    return rb.toggleReimburse(id: id, now: now);
  }

  final state = rb.refundState(id: id);
  if (state == null || state.remaining <= 0) return false;
  final amount = await showDialog<double>(
    context: context,
    builder: (_) => _RefundDialog(zh: zh, remaining: state.remaining),
  );
  if (amount == null) return false;
  // Not clamped here: the core caps a refund at what is left, and returns zero
  // when there is nothing to refund. Deciding it twice is how the two answers
  // drift apart.
  return rb.refundEntry(
        id: id,
        amount: amount,
        zh: zh,
        newId: 'rf${DateTime.now().millisecondsSinceEpoch}',
        now: now,
      ) >
      0;
}

class _RefundDialog extends StatefulWidget {
  const _RefundDialog({required this.zh, required this.remaining});

  final bool zh;
  final double remaining;

  @override
  State<_RefundDialog> createState() => _RefundDialogState();
}

class _RefundDialogState extends State<_RefundDialog> {
  late final TextEditingController _amt =
      TextEditingController(text: widget.remaining.toStringAsFixed(2));

  @override
  void dispose() {
    _amt.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('refund-dialog'),
      backgroundColor: palette.card,
      title: Text(zh ? '退款' : 'Refund',
          style: TextStyle(fontSize: 16, color: palette.ink)),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(
          key: const Key('refund-amt'),
          controller: _amt,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          cursorColor: palette.stamen,
          decoration: InputDecoration(
            labelText: zh ? '金额' : 'Amount',
            labelStyle: TextStyle(color: palette.inkSoft),
            floatingLabelStyle: TextStyle(color: palette.stamen),
            focusedBorder: UnderlineInputBorder(
              borderSide: BorderSide(color: palette.stamen, width: 2),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          zh
              ? '会记一笔收入,原来那笔不动'
              : 'Logs an income; the original entry is left alone',
          style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
        ),
      ]),
      actions: [
        TextButton(
          key: const Key('refund-cancel'),
          onPressed: () => Navigator.pop(context),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('refund-ok'),
          onPressed: () {
            final v = double.tryParse(_amt.text.replaceAll(',', ''));
            if (v == null) return;
            Navigator.pop(context, v);
          },
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(zh ? '确定' : 'OK'),
        ),
      ],
    );
  }
}
