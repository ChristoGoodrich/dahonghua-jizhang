// 快捷指令记账 — how to have Siri, the Action button and Apple Pay record.
//
// The iPhone's half of what 自动记账 is on Android. Nothing here can be
// switched on from inside the app: an automation is the user's own, made in
// the Shortcuts app, and iOS gives an app no way to create one. So this
// screen says exactly what to tap, and opens Shortcuts.

import 'package:flutter/material.dart';

import 'glass.dart';
import 'shortcuts.dart';
import 'theme.dart';

class ShortcutsScreen extends StatelessWidget {
  const ShortcutsScreen({
    super.key,
    required this.zh,
    this.queue = const ShortcutQueue(),
  });

  final bool zh;
  final ShortcutQueue queue;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return ScrimScaffold(
      title: Text(zh ? '快捷指令记账' : 'Shortcuts'),
      body: ListView(
        key: const Key('shortcuts-list'),
        padding: EdgeInsets.fromLTRB(16, headerInset(context) + 16, 16, 24),
        children: [
          Text(
            zh
                ? 'iPhone 不让一个 App 读另一个 App 的通知，所以安卓上的“自动记账”在这里做不到。'
                      '能做的是让 Siri、操作按钮和 Apple Pay 付款后的自动化替你记。'
                      '它们只是把要记的先写下来，下次打开大红花时才记进账本。'
                : 'An iPhone lets no app read another\'s notifications, so '
                      'Android\'s auto-capture cannot exist here. What can is '
                      'Siri, the Action button and an automation after each '
                      'Apple Pay payment. They write down what to record, and '
                      'it reaches the ledger the next time this app opens.',
            key: const Key('shortcuts-note'),
            style: TextStyle(color: p.inkSoft, height: 1.5),
          ),
          const SizedBox(height: 20),
          _Card(
            key: const Key('shortcuts-siri'),
            icon: Icons.mic_none,
            title: zh ? '说一句就记' : 'Say it',
            body: zh
                ? '对 Siri 说“用大红花记账记一笔”，再说花了什么，比如“午饭35，打车12”。'
                      '一句话里的几笔、“昨天”这样的日子，和 App 里的一句话记账读法一样。'
                      '也可以在“快捷指令”App 里找“大红花记账 › 记一笔”，放到主屏幕上。'
                : 'Tell Siri “Record an entry in Big Red Flower”, then what '
                      'you spent: “lunch 35, taxi 12”. Several in one sentence, '
                      'and days like “yesterday”, are read as the app\'s '
                      'one-sentence entry reads them. It is also in the '
                      'Shortcuts app under Big Red Flower › Record an entry.',
          ),
          const SizedBox(height: 12),
          _Card(
            key: const Key('shortcuts-action'),
            icon: Icons.touch_app_outlined,
            title: zh ? '操作按钮' : 'The Action button',
            body: zh
                ? '有操作按钮的 iPhone：设置 › 操作按钮 › 快捷指令，选“大红花记账 › 记一笔”。'
                      '按住它，说花了什么。'
                : 'On an iPhone with an Action button: Settings › Action '
                      'Button › Shortcut, then Big Red Flower › Record an '
                      'entry. Hold it and say what you spent.',
          ),
          const SizedBox(height: 12),
          _Card(
            key: const Key('shortcuts-pay'),
            icon: Icons.contactless_outlined,
            title: zh ? 'Apple Pay 付款后自动记' : 'After every Apple Pay payment',
            body: zh
                ? '1. 打开“快捷指令”App，点“自动化”，再点右上角的 ＋。\n'
                      '2. 选“钱包”（较早的系统叫“交易”），选要记的卡，选“立即运行”，点“下一步”。\n'
                      '3. 新建空白自动化，添加操作，搜“大红花记账”，选“记一笔付款”。\n'
                      '4. 点“金额”，选快捷指令输入里的金额；点“商户”，选快捷指令输入里的商户。完成。\n'
                      '之后每刷一次，下次打开大红花就记上一笔支出，分类按商户猜，和你以前怎么记过它一致。'
                : '1. Open the Shortcuts app, tap Automation, then ＋.\n'
                      '2. Choose Wallet (Transaction on older systems), the '
                      'cards to record, and Run Immediately; tap Next.\n'
                      '3. New Blank Automation, Add Action, search for Big '
                      'Red Flower and choose Record a payment.\n'
                      '4. Tap Amount and pick the Shortcut Input\'s amount; '
                      'tap Merchant and pick its merchant. Done.\n'
                      'Every payment then becomes an expense the next time '
                      'this app opens, its category guessed from the merchant '
                      'and from how you filed it before.',
          ),
          const SizedBox(height: 20),
          FilledButton.tonal(
            key: const Key('open-shortcuts'),
            onPressed: () => queue.openShortcuts(),
            child: Text(zh ? '打开“快捷指令”' : 'Open Shortcuts'),
          ),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({
    super.key,
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(Rad.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: p.hibiscus),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(fontWeight: FontWeight.w700, color: p.ink),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(body, style: TextStyle(color: p.inkSoft, height: 1.5)),
        ],
      ),
    );
  }
}
