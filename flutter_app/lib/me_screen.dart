// 我的 — the home for everything that is neither reading the ledger nor
// entering a number.
//
// It exists because a bottom bar runs out of room at about five slots and the
// app has twenty screens. The shipping app solved it the same way: two reading
// views of the ledger, two hubs, and the record button as its own object. Tools
// that shape *how* you record sit on top, data and sync below, and true
// settings one level further down so this list stays short enough to scan.
//
// Rows for screens that do not exist yet are simply absent. A hub listing
// things that go nowhere teaches the reader to stop trusting it.

import 'package:flutter/material.dart';

import 'theme.dart';

/// One destination.
class MeRow {
  const MeRow({
    required this.icon,
    required this.title,
    required this.desc,
    required this.onTap,
    this.id,
  });

  final IconData icon;
  final String title;
  final String desc;
  final VoidCallback onTap;

  /// Test key suffix, when the row needs to be found.
  final String? id;
}

class MeScreen extends StatelessWidget {
  const MeScreen({
    super.key,
    this.zh = true,
    required this.groups,
    this.streak,
  });

  final bool zh;

  /// Titled groups, in order. Empty groups are not drawn.
  final List<(String, List<MeRow>)> groups;

  /// The one habit signal worth a line: entries recorded, days in a row.
  final (int, int)? streak;

  @override
  Widget build(BuildContext context) {
    final shown = groups.where((g) => g.$2.isNotEmpty).toList();
    return Scaffold(
      backgroundColor: palette.paper,
      body: SafeArea(
        bottom: false,
        child: ListView(
          // Named so a test can scroll it. There are four tabs alive in an
          // IndexedStack at once, so `find.byType(Scrollable)` is ambiguous
          // here in a way that is not obvious from the screen.
          key: const Key('me-list'),
          padding: const EdgeInsets.fromLTRB(22, 18, 22, 120),
          children: [
            Text(zh ? '我的' : 'Me',
                style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w700,
                    color: palette.ink)),
            if (streak != null) ...[
              const SizedBox(height: 6),
              _streakLine(zh, streak!.$1, streak!.$2),
            ],
            const SizedBox(height: 18),
            for (final (title, rows) in shown) ...[
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 8),
                child: Text(title,
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: palette.inkSoft)),
              ),
              _group(rows),
              const SizedBox(height: 20),
            ],
          ],
        ),
      ),
    );
  }

  Widget _streakLine(bool zh, int count, int streak) => Row(
        children: [
          Icon(Icons.local_florist, size: 15, color: palette.hibiscus),
          const SizedBox(width: 6),
          Text(
            zh ? '本期 $count 朵 · 连续 $streak 天' : '$count this cycle · $streak day streak',
            key: const Key('me-streak'),
            style: TextStyle(
                fontSize: 12.5, fontFeatures: tabular, color: palette.inkSoft),
          ),
        ],
      );

  /// One card holding several rows, hairline-separated.
  ///
  /// Every row wears the same stroke and the same accent — that uniformity is
  /// what makes a long options list read as one surface rather than a pile.
  Widget _group(List<MeRow> rows) => Container(
        decoration: BoxDecoration(
          color: palette.card,
          borderRadius: BorderRadius.circular(Rad.lg),
          border: Border.all(color: palette.line),
        ),
        child: Column(
          children: [
            for (var i = 0; i < rows.length; i++) ...[
              _row(rows[i]),
              if (i != rows.length - 1)
                Divider(height: 1, thickness: 1, color: palette.line, indent: 54),
            ],
          ],
        ),
      );

  Widget _row(MeRow r) => InkWell(
        key: r.id == null ? null : Key('me-${r.id}'),
        onTap: r.onTap,
        borderRadius: BorderRadius.circular(Rad.lg),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Icon(r.icon, size: 19, color: palette.hibiscus),
              const SizedBox(width: 15),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r.title,
                        style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: palette.ink)),
                    const SizedBox(height: 1),
                    Text(r.desc,
                        style:
                            TextStyle(fontSize: 12, color: palette.inkSoft)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, size: 20, color: palette.inkSoft),
            ],
          ),
        ),
      );
}
