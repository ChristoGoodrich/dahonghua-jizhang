// 自动记账 — the notification listener, and what it caught.
//
// Three states this screen has to tell apart, because they need different
// things from the user and look the same if you conflate them:
//
//   not supported  no Android notification listener here at all
//   not granted    access has to be given by hand in system settings; there is
//                  no in-app dialog for it
//   granted, off   permission and intent are separate decisions, and having
//                  granted access is not the same as asking to be recorded
//
// Below that, what the listener caught. Confident captures are already in the
// ledger. The rest wait here for one tap, shown next to what the notification
// actually said — a user asked to accept a guess deserves to see what it was a
// guess about.

import 'package:flutter/material.dart';

import 'inbox.dart';
import 'notif_capture.dart';
import 'src/rust/api/capture.dart' as capture;
import 'glass.dart';
import 'theme.dart';

class CaptureScreen extends StatefulWidget {
  const CaptureScreen({
    super.key,
    this.zh = true,
    this.onChanged,
    this.inbox,
    this.native,
  });

  final bool zh;

  /// A payment reached the ledger, so the file needs writing and the lists
  /// rebuilding.
  final VoidCallback? onChanged;

  /// Injected by tests, which have no Android service to talk to.
  final Inbox? inbox;
  final NotifCapture? native;

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen> {
  late final NotifCapture _native = widget.native ?? const NotifCapture();
  late final Inbox _inbox = widget.inbox ?? Inbox(native: _native);

  bool _granted = false;
  bool _capturing = false;
  bool _busy = false;
  String? _flash;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload({bool drain = true}) async {
    setState(() => _busy = true);
    if (widget.inbox == null) await _inbox.load();
    final granted = await _native.isEnabled();
    final capturing = await _native.isCapturing();
    DrainResult? r;
    if (drain && granted && capturing) r = await _inbox.drain();
    if (!mounted) return;
    setState(() {
      _granted = granted;
      _capturing = capturing;
      _busy = false;
      if (r != null && !r.isEmpty) _flash = _drainLine(r);
    });
    if (r != null && r.posted > 0) widget.onChanged?.call();
  }

  String _drainLine(DrainResult r) {
    final zh = widget.zh;
    final parts = <String>[
      if (r.posted > 0) zh ? '记了 ${r.posted} 笔' : '${r.posted} recorded',
      if (r.queued > 0) zh ? '${r.queued} 笔待确认' : '${r.queued} to confirm',
      if (r.unparsed > 0)
        zh ? '${r.unparsed} 条没看懂' : "${r.unparsed} not understood",
    ];
    return parts.join(zh ? ',' : ' · ');
  }

  Future<void> _toggle(bool on) async {
    await _native.setCapturing(on);
    if (!mounted) return;
    setState(() => _capturing = on);
    if (on) await _reload();
  }

  Future<void> _accept(capture.PendingView p) async {
    await _inbox.accept(p);
    if (!mounted) return;
    setState(() => _flash = widget.zh ? '已记一笔' : 'Recorded');
    widget.onChanged?.call();
  }

  Future<void> _reject(capture.PendingView p) async {
    await _inbox.reject(p);
    if (mounted) setState(() {});
  }

  String _sourceLabel(String s) {
    final zh = widget.zh;
    return switch (s) {
      'alipay' => zh ? '支付宝' : 'Alipay',
      'wechat' => zh ? '微信支付' : 'WeChat Pay',
      'unionpay' => zh ? '云闪付' : 'UnionPay',
      _ => zh ? '银行卡' : 'Bank card',
    };
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return ScrimScaffold(
      title: Text(
        zh ? '自动记账' : 'Auto-capture',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      body: ListView(
        key: const Key('capture-list'),
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
        children: [
          if (!_native.supported)
            Text(
              zh
                  ? '这台设备没有通知监听,自动记账用不了。账单导入可以做同样的事,晚一点而已。'
                  : 'This device has no notification listener, so auto-capture '
                        'is unavailable. Importing a bill export does the same '
                        'job, just later.',
              key: const Key('capture-unsupported'),
              style: TextStyle(fontSize: 13, color: palette.inkSoft),
            )
          else ...[
            ..._permission(zh),
            const SizedBox(height: 20),
            if (_flash != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Text(
                  _flash!,
                  key: const Key('capture-flash'),
                  style: TextStyle(fontSize: 13, color: palette.leafDeep),
                ),
              ),
            ..._pendingSection(zh),
            ..._unparsedSection(zh),
          ],
        ],
      ),
    );
  }

  List<Widget> _permission(bool zh) => [
    Text(
      zh
          ? '支付通知一到就记下来,不用打开这个 app。只看支付宝、微信和银行的通知,别的一概不存。'
          : 'A payment notification becomes an entry without opening the '
                'app. Only Alipay, WeChat and bank notifications are read; '
                'nothing else is stored.',
      style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
    ),
    const SizedBox(height: 16),
    if (!_granted) ...[
      Text(
        zh
            ? '还没有通知权限。这个权限只能在系统设置里给,app 弹不出来。'
            : 'Notification access has not been granted. It can only be '
                  'given in system settings — no app can ask for it.',
        key: const Key('capture-not-granted'),
        style: TextStyle(fontSize: 13, color: palette.hibiscusDeep),
      ),
      const SizedBox(height: 12),
      FilledButton(
        key: const Key('open-notif-settings'),
        onPressed: () async {
          await _native.openSettings();
          // Coming back is the only signal there is; the system never
          // tells an app its access changed.
          if (mounted) await _reload();
        },
        style: FilledButton.styleFrom(
          backgroundColor: palette.hibiscus,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 14),
        ),
        child: Text(zh ? '去系统设置里打开' : 'Open system settings'),
      ),
    ] else
      SwitchListTile(
        key: const Key('capture-toggle'),
        contentPadding: EdgeInsets.zero,
        value: _capturing,
        onChanged: _busy ? null : _toggle,
        activeThumbColor: palette.hibiscus,
        title: Text(
          zh ? '自动记账' : 'Capture payments',
          style: TextStyle(fontSize: 15, color: palette.ink),
        ),
        subtitle: Text(
          _capturing
              ? (zh ? '开着' : 'On')
              : (zh ? '权限有了,还没开' : 'Granted, but not on'),
          style: TextStyle(fontSize: 12, color: palette.inkSoft),
        ),
      ),
  ];

  List<Widget> _pendingSection(bool zh) {
    if (_inbox.pending.isEmpty) {
      return [
        if (_granted && _capturing)
          Text(
            zh ? '没有待确认的。' : 'Nothing waiting.',
            key: const Key('capture-empty'),
            style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
          ),
      ];
    }
    return [
      Text(
        zh ? '待确认' : 'Waiting for you',
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: palette.ink,
        ),
      ),
      const SizedBox(height: 4),
      Text(
        zh
            ? '这些看懂了金额,没看出商家。记下来的备注会是下面这个。'
            : 'The amount was read but no merchant was. The note would be what '
                  'is shown below.',
        style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
      ),
      const SizedBox(height: 10),
      for (final p in _inbox.pending) _pendingRow(p, zh),
      const SizedBox(height: 20),
    ];
  }

  Widget _pendingRow(capture.PendingView p, bool zh) => Container(
    key: Key('pending-${p.id}'),
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: palette.card,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: palette.line),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '${_sourceLabel(p.source)} · ${p.note}',
                style: TextStyle(fontSize: 14, color: palette.ink),
              ),
            ),
            Text(
              p.amt.toStringAsFixed(2),
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: p.io == 'inc' ? palette.leafDeep : palette.ink,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        // What the notification said, verbatim. This is the evidence for
        // the guess above it.
        Text(
          p.raw,
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(
              key: Key('reject-${p.id}'),
              onPressed: () => _reject(p),
              style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
              child: Text(zh ? '不记' : 'Discard'),
            ),
            const SizedBox(width: 4),
            FilledButton(
              key: Key('accept-${p.id}'),
              onPressed: () => _accept(p),
              style: FilledButton.styleFrom(
                backgroundColor: palette.hibiscus,
                foregroundColor: Colors.white,
              ),
              child: Text(zh ? '记一笔' : 'Record'),
            ),
          ],
        ),
      ],
    ),
  );

  List<Widget> _unparsedSection(bool zh) {
    if (_inbox.unparsed.isEmpty) return const [];
    return [
      Row(
        children: [
          Expanded(
            child: Text(
              zh ? '没看懂的' : 'Not understood',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: palette.ink,
              ),
            ),
          ),
          TextButton(
            key: const Key('clear-unparsed'),
            onPressed: () async {
              await _inbox.clearUnparsed();
              if (mounted) setState(() {});
            },
            style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
            child: Text(zh ? '清空' : 'Clear'),
          ),
        ],
      ),
      Text(
        zh
            ? '留着是为了看清真实的通知长什么样,规则才能改对。这些不会变成账。'
            : 'Kept so the real wording can be read and the rules improved. '
                  'None of these become entries.',
        style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
      ),
      const SizedBox(height: 8),
      for (final u in _inbox.unparsed)
        Padding(
          key: Key('unparsed-${u.id}'),
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Text(
            u.raw,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
          ),
        ),
    ];
  }
}
