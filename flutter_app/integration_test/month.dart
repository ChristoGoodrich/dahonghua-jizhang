// The month the tour, the profile run and the narrow walk are taken in.
//
// It lived in `tour.dart`, and `perf.dart` imported the tour to get it. Out
// here so `narrow_test.dart` can lay out the same screens with the same
// ledger in them: a row that fits on an empty screen is not a row that fits,
// and the amounts that run widest — 23,650, −3,120, 12,800 — are the ones
// somebody keeps.

import 'dart:typed_data';

import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/subscriptions.dart' as subs;

const day = 86400000;

/// A month somebody actually lived: breakfasts and lunches, a commute, a few
/// bigger purchases, rent, a salary and a bonus, one expense waiting to be
/// claimed back and one partly refunded.
void seed() {
  final now = DateTime.now().millisecondsSinceEpoch;
  accounts.addAccount(id: 'cash', name: '现金', balance: 820, kind: 'cash');
  accounts.addAccount(id: 'card', name: '招商银行', balance: 23650, kind: 'cash');
  accounts.addAccount(
    id: 'credit',
    name: '信用卡',
    balance: -3120,
    kind: 'credit',
    statementDay: 5,
    dueDay: 23,
  );

  final rows = <(String, String, double, String, int)>[
    ('exp', 'food', 18, '早餐 豆浆油条', 0),
    ('exp', 'food', 42.5, '午饭 牛肉面', 0),
    ('exp', 'trans', 4, '地铁', 0),
    ('exp', 'food', 36, '咖啡', 1),
    ('exp', 'shop', 299, '跑鞋', 1),
    ('exp', 'trans', 27.6, '打车回家', 1),
    ('exp', 'food', 128, '和朋友吃火锅', 2),
    ('exp', 'fun', 68, '电影', 2),
    ('inc', 'salary', 12800, '九月工资', 3),
    ('exp', 'home', 2800, '房租', 3),
    ('exp', 'food', 15, '早餐', 4),
    ('exp', 'health', 86, '药店', 5),
    ('exp', 'study', 59, '一本书', 6),
    ('exp', 'food', 23, '便利店', 7),
    ('exp', 'trans', 380, '高铁 出差', 8),
    ('exp', 'food', 188, '出差晚饭', 8),
    ('inc', 'bonus', 2000, '项目奖金', 10),
    ('exp', 'gift', 520, '朋友婚礼', 12),
    ('exp', 'shop', 1299, '耳机', 14),
    ('exp', 'food', 31, '外卖', 15),
    // last month, so 本月 vs 上月同期 has a month to compare with
    ('exp', 'home', 2800, '房租', 34),
    ('exp', 'food', 412, '聚餐', 36),
    ('exp', 'shop', 689, '外套', 40),
    ('exp', 'trans', 96, '打车', 44),
    ('inc', 'salary', 12800, '八月工资', 34),
  ];
  var i = 0;
  for (final (io, cat, amt, note, ago) in rows) {
    store.addEntry(
      entry: store.NewEntry(
        io: io,
        cat: cat,
        amt: amt,
        note: note,
        ts: now - ago * day - i * 3600000,
        acct: i.isEven ? 'card' : 'cash',
      ),
      id: 'tour-$i',
      now: now,
    );
    i++;
  }
  // the trip is claimable, and the headphones came partly back
  store.updateEntry(
    id: 'tour-14',
    patch: const store.EntryPatch(rb: 'pending'),
    now: now,
  );

  budget.setSettings(
    view: budget.SettingsView(
      budget: 6000,
      dailyBudget: 200,
      cycleStart: 1,
      capCats: const ['food'],
      capAmounts: Float64List.fromList([1500]),
    ),
  );
  subs.addSub(
    sub: const subs.NewSub(
      name: '视频会员',
      amt: 25,
      freq: 'monthly',
      day: 12,
      cat: 'fun',
      emoji: '📺',
      isTransfer: false,
    ),
    id: 'sub-video',
    now: now,
  );
  subs.addSub(
    sub: const subs.NewSub(
      name: '云存储',
      amt: 6,
      freq: 'monthly',
      day: 3,
      cat: 'other',
      emoji: '☁️',
      isTransfer: false,
    ),
    id: 'sub-cloud',
    now: now,
  );
  catalog.addTemplate(
    id: 'tpl-coffee',
    io: 'exp',
    cat: 'food',
    amt: 36,
    note: '咖啡',
    name: '咖啡',
  );
  catalog.addTemplate(
    id: 'tpl-metro',
    io: 'exp',
    cat: 'trans',
    amt: 4,
    note: '地铁',
    name: '地铁',
  );
  catalog.addTag(kind: 'normal', name: '出差');
  catalog.addTag(kind: 'normal', name: '聚餐');
  catalog.addTag(kind: 'ledger', name: '装修');
}
