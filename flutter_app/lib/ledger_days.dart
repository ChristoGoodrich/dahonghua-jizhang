// Every live entry, its id and its calendar day — read once per change.
//
// Seven screens began the same way: ask Rust for every live row, turn each
// instant into the device's calendar day, and hand the ids and the days back.
// At 3,000 entries that was about 9ms on an emulator before a screen had
// computed anything, a phone is slower, and 统计, 回顾, 预算, 明细's head and
// 我的's streak each paid it on every open — most of the time for a ledger
// nobody had written to since the last one read it.
//
// So it is read once and kept until `store.revision()` moves, which every write
// access does. The day is still the platform's to decide — the timezone is —
// so the offset is part of what the copy is kept against: a phone carried
// across a border reads again.

import 'src/rust/api/store.dart' as store;

/// `y-m-d`, unpadded: the shape every core call that takes a day reads.
String dayKey(DateTime d) => '${d.year}-${d.month}-${d.day}';

class LedgerDays {
  LedgerDays._(this.entries, this.ids, this.days);

  /// Newest first, as `liveEntries` returns them.
  final List<store.EntryView> entries;
  final List<String> ids;

  /// `days[i]` is the day `entries[i]` fell on, in this device's zone.
  final List<String> days;

  static LedgerDays? _kept;
  static int _rev = -1;
  static Duration? _zone;

  /// The ledger as it is now — from the copy when nothing has been written
  /// since it was taken.
  static LedgerDays current() {
    final rev = store.revision();
    final zone = DateTime.now().timeZoneOffset;
    final kept = _kept;
    if (kept != null && rev == _rev && zone == _zone) return kept;
    final live = store.liveEntries();
    final fresh = LedgerDays._(
      List.unmodifiable(live),
      List.unmodifiable([for (final e in live) e.id]),
      List.unmodifiable([
        for (final e in live) dayKey(DateTime.fromMillisecondsSinceEpoch(e.ts)),
      ]),
    );
    _kept = fresh;
    _rev = rev;
    _zone = zone;
    return fresh;
  }
}
