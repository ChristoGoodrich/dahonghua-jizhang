// A category, picked from a sheet of them.
//
// The grid a batch 改分类 and an AI draft's category both opened, and now
// 预算's 添加分类上限 too. It was written out twice, word for word, before the
// third wanted it.

import 'package:flutter/material.dart';

import 'src/rust/api/catalog.dart' as catalog;
import 'tap.dart';
import 'theme.dart';

/// The key of the category picked from `cats`, or null when dismissed.
///
/// Each tile is keyed `'$keyPrefix-<key>'`, so a test can press the one it
/// means.
Future<String?> pickCategory(
  BuildContext context, {
  required List<catalog.CategoryView> cats,
  required bool zh,
  required String keyPrefix,
}) => showModalBottomSheet<String>(
  context: context,
  backgroundColor: palette.card,
  builder: (ctx) => SafeArea(
    child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(14, 16, 14, 10),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final c in cats)
            Tap(
              key: Key('$keyPrefix-${c.k}'),
              radius: Rad.md,
              onTap: () => Navigator.pop(ctx, c.k),
              child: Container(
                width: 78,
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: parseHex(
                    c.c,
                  ).withValues(alpha: palette.isDark ? 0.19 : 0.12),
                  borderRadius: BorderRadius.circular(Rad.md),
                ),
                child: Column(
                  children: [
                    Text(c.e, style: const TextStyle(fontSize: 21)),
                    const SizedBox(height: 4),
                    Text(
                      catalog.catName(cat: c, zh: zh),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11.5, color: palette.ink),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
  ),
);
