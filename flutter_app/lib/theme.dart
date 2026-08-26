// The app's palette and radii, as the shipping theme defines them.
//
// Colours only — anything *computed* from a colour (the glass wash, the ambient
// pull, the readability curve) is a Rust call, not a Dart one. These are the
// inputs to that, and the ink the material is read against.

import 'package:flutter/material.dart';

/// `rgba(r, g, b, a)` from Rust → a Flutter colour.
///
/// The mix, the ambient pull and the readability curve all happened on the
/// other side of the boundary; this only parses the answer.
Color parseRgba(String s) {
  final n = RegExp(r'[-0-9.eE+]+')
      .allMatches(s)
      .map((m) => double.parse(m.group(0)!))
      .toList();
  if (n.length < 3) return const Color(0xFF000000);
  return Color.fromRGBO(
      n[0].toInt(), n[1].toInt(), n[2].toInt(), n.length > 3 ? n[3] : 1);
}

/// `#RRGGBB` or `#RGB` → a Flutter colour, with an optional alpha override.
Color parseHex(String hex, {double? opacity}) {
  var h = hex.replaceFirst('#', '');
  if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
  if (h.length < 6) return const Color(0xFF000000);
  final v = int.parse(h.substring(0, 6), radix: 16);
  return Color(0xFF000000 | v).withValues(alpha: opacity ?? 1);
}

/// The default theme's tokens. One theme for now; the other six follow the same
/// shape, and which one is active is a settings read that does not exist yet.
class Palette {
  const Palette();

  final String paperHex = '#FBF7F0';
  final String cardHex = '#FFFFFF';

  Color get paper => const Color(0xFFFBF7F0);
  Color get paperWarm => const Color(0xFFF5EDE1);
  Color get card => const Color(0xFFFFFFFF);
  Color get ink => const Color(0xFF2B2622);
  Color get inkSoft => const Color(0xFF8A8178);
  Color get line => const Color(0xFFEADFCF);
  Color get leafDeep => const Color(0xFF4E8A5F);
  Color get leaf => const Color(0xFF7FB88C);
  Color get stamen => const Color(0xFFE0A93C);
  Color get hibiscus => const Color(0xFFB83A48);
  Color get hibiscusDeep => const Color(0xFF8E2A36);

  bool get isDark => false;
}

const palette = Palette();

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
  final scheme = ColorScheme.fromSeed(
    seedColor: palette.hibiscus,
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
