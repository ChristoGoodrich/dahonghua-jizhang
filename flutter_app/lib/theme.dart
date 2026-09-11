// The app's palette and radii, as the shipping theme defines them.
//
// Colours only — anything *computed* from a colour (the glass wash, the ambient
// pull, the readability curve) is a Rust call, not a Dart one. These are the
// inputs to that, and the ink the material is read against.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'src/rust/api/theme.dart' as theme;

/// `rgba(r, g, b, a)` from Rust → a Flutter colour.
///
/// The mix, the ambient pull and the readability curve all happened on the
/// other side of the boundary; this only parses the answer.
Color parseRgba(String s) {
  final n = RegExp(
    r'[-0-9.eE+]+',
  ).allMatches(s).map((m) => double.parse(m.group(0)!)).toList();
  if (n.length < 3) return const Color(0xFF000000);
  return Color.fromRGBO(
    n[0].toInt(),
    n[1].toInt(),
    n[2].toInt(),
    n.length > 3 ? n[3] : 1,
  );
}

/// `#RRGGBB` or `#RGB` → a Flutter colour, with an optional alpha override.
Color parseHex(String hex, {double? opacity}) {
  var h = hex.replaceFirst('#', '');
  if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
  if (h.length < 6) return const Color(0xFF000000);
  final v = int.parse(h.substring(0, 6), radix: 16);
  return Color(0xFF000000 | v).withValues(alpha: opacity ?? 1);
}

/// One theme's colours, parsed from the strings the core hands over.
///
/// Every value here is computed in Rust — seven flowers times light and dark,
/// under a 504-case corpus. What is left on this side is `#RRGGBB` to a
/// `Color`, which is the one thing that genuinely cannot cross.
class Palette {
  Palette(this._t);

  final theme.ThemeView _t;

  /// Some tokens want the hex, not the colour: `glass.rs` takes strings.
  String get paperHex => _t.paper;
  String get cardHex => _t.card;

  Color get paper => parseHex(_t.paper);
  Color get paperWarm => parseHex(_t.paperWarm);
  Color get card => parseHex(_t.card);
  Color get ink => parseHex(_t.ink);
  Color get inkSoft => parseHex(_t.inkSoft);
  Color get line => parseHex(_t.line);
  Color get leafDeep => parseHex(_t.leafDeep);
  Color get leaf => parseHex(_t.leaf);
  Color get stamen => parseHex(_t.stamen);
  Color get hibiscus => parseHex(_t.hibiscus);
  Color get hibiscusDeep => parseHex(_t.hibiscusDeep);

  /// The record button's fill. A gradient rather than a flat accent, which is
  /// what keeps it reading as its own object next to the glass bar.
  Color get gradFrom => parseHex(_t.gradFrom);
  Color get gradTo => parseHex(_t.gradTo);

  /// Shadow colours, as the theme states them.
  String get shadowHex => _t.shadow;
  String get glowHex => _t.glow;

  bool get isDark => _t.isDark;
}

Palette? _active;

/// The palette in force.
///
/// A getter rather than a constant, which is what lets four hundred call sites
/// reading `palette.ink` follow a theme change without any of them knowing a
/// theme exists. Cached because it is read once per widget per build, and
/// invalidated by [refreshPalette] when the choice changes.
Palette get palette => _active ??= Palette(theme.currentTheme());

/// Forget the cached palette. Call after changing the theme; the next read
/// rebuilds it from the core.
void refreshPalette() => _active = null;

/// The status and navigation bars' own colours.
///
/// Declared rather than inherited, which it was not. Nothing in this app ever
/// set it, so the icons took whatever the last widget to express an opinion
/// had asked for — and an `AppBar` expresses one automatically, derived from
/// its own background. That was survivable while the bars were paper. Once
/// they went transparent for the scrim, `estimateBrightnessForColor` read
/// `Colors.transparent` as dark and asked for **light** icons, which is white
/// on cream.
///
/// The room knows the answer: a lit room takes dark icons and a dark one takes
/// light. Both bars are transparent because content is meant to run under
/// them — that is the whole point of the scrim.
SystemUiOverlayStyle get systemOverlay {
  final dark = palette.isDark;
  return SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    // The two names are the same question asked by Android and by iOS, and
    // they answer it in opposite directions: `statusBarIconBrightness` is the
    // brightness of the ICONS, `statusBarBrightness` the brightness behind
    // them. Setting one and not the other is how this goes wrong on one
    // platform only.
    statusBarIconBrightness: dark ? Brightness.light : Brightness.dark,
    statusBarBrightness: dark ? Brightness.dark : Brightness.light,
    systemNavigationBarColor: Colors.transparent,
    systemNavigationBarIconBrightness: dark
        ? Brightness.light
        : Brightness.dark,
  );
}

/// Corner radii, matching `theme/tokens.ts`.
class Rad {
  static const double sm = 10;
  static const double md = 16;
  static const double lg = 22;
  static const double pill = 999;
}

/// Tabular figures, so a column of amounts lines up. The shipping app sets
/// `fontVariant: ['tabular-nums']`; this is the same feature by its OpenType
/// name.
const tabular = [FontFeature.tabularFigures()];

/// The palette as a Material theme.
///
/// Material 3 derives its own colour scheme when none is given, and its default
/// is lavender: the navigation bar came out lavender against warm paper, and so
/// did a focused field's label and the text-selection handles. Every one of
/// those was found on a device rather than by a test, because a colour a widget
/// does not set is not a colour a widget test can see.
///
/// The widgets that care still set their own colours explicitly. This is for
/// the ones with no seam to set — selection handles, ripples, a dialog's
/// surface — which would otherwise be a different application's chrome.
ThemeData appTheme() {
  // The brightness is told, not inferred. Without it Material derives light
  // defaults from the seed and a dark room gets black text on a dark card —
  // every widget this app does not paint itself, which is most of the
  // dialogs and every menu.
  final scheme = ColorScheme.fromSeed(
    seedColor: palette.hibiscus,
    brightness: palette.isDark ? Brightness.dark : Brightness.light,
    primary: palette.hibiscus,
    secondary: palette.stamen,
    surface: palette.card,
    onSurface: palette.ink,
  );
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: palette.paper,
    dialogTheme: DialogThemeData(backgroundColor: palette.card),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: palette.stamen,
      selectionColor: palette.stamen.withValues(alpha: 0.28),
      selectionHandleColor: palette.stamen,
    ),
    inputDecorationTheme: InputDecorationTheme(
      labelStyle: TextStyle(color: palette.inkSoft),
      floatingLabelStyle: TextStyle(color: palette.stamen),
      hintStyle: TextStyle(color: palette.inkSoft),
    ),
  );
}
