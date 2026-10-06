// 分类查表 — the lookups, with the user's own categories always in.
//
// `catalog.allCats` and friends take the custom list as an argument, which is
// how the core stays pure and how a test can hand in a fixture. Every screen
// wants the same answer — built-ins plus whatever this phone has added — and
// half of them were passing `const []`, so a custom category existed in the
// config and appeared in no picker. These three are the call sites' spelling
// of "the categories this app actually has".

import 'src/rust/api/catalog.dart' as catalog;

export 'src/rust/api/catalog.dart'
    show CatLabel, CategoryView, SubcatView, TemplateView;

/// Every category for one direction, in picker order: built-ins then custom.
List<catalog.CategoryView> catsOf(String io) =>
    catalog.allCats(io: io, custom: catalog.customCats(io: io));

/// One category by key. Falls back to the last rather than failing.
catalog.CategoryView catOf({required String io, required String key}) =>
    catalog.catOf(
      io: io,
      key: key,
      custom: catalog.customCats(io: io),
    );

/// One category's label — name, emoji and accent.
catalog.CatLabel catLabelOf({
  required String io,
  required String key,
  required bool zh,
}) => catalog.catLabel(
  io: io,
  key: key,
  zh: zh,
  custom: catalog.customCats(io: io),
);
