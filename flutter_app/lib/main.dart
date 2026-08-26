// The app shell.
//
// Two screens so far. The record sheet is the prototype Slint and Dioxus each
// got a throwaway of, kept because it is what answered the three questions this
// architecture had to settle on a real device — Chinese IME composition,
// 柔光玻璃 rendering, and accessibility labels reaching Android — and because it
// still demonstrates the fourth: every colour and every number on it is
// computed in Rust.
//
// The entry list is the first *real* screen, drawing the ledger that lives on
// the other side of the boundary.

import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'entry_list.dart';
import 'record_sheet.dart' as sheet;
import 'theme.dart';
import 'src/rust/api/calc.dart' as calc;
import 'src/rust/api/glass.dart' as glass;
import 'src/rust/api/store.dart' as store;
import 'src/rust/frb_generated.dart';

Future<void> main() async {
  await RustLib.init();
  _seedIfEmpty();
  runApp(const App());
}

/// A few rows so the list is not empty on first launch, until persistence is
/// wired to a file. Written through the ordinary commands — there is no back
/// door into the store, and this is not one.
void _seedIfEmpty() {
  if (store.entryCount() > 0) return;
  final now = DateTime.now().millisecondsSinceEpoch;
  const day = 86400000;
  final rows = <(String, String, double, String?, int)>[
    ('exp', 'food', 35.5, '午饭', now),
    ('exp', 'trans', 12, '打车', now - 3600 * 1000),
    ('inc', 'salary', 9000, null, now - day),
    ('exp', 'shop', 218.4, '毛衣', now - day),
    ('exp', 'home', 1800, '房租', now - day * 3),
  ];
  for (var i = 0; i < rows.length; i++) {
    final (io, cat, amt, note, ts) = rows[i];
    store.addEntry(
      entry: store.NewEntry(io: io, cat: cat, amt: amt, note: note, ts: ts),
      id: 'seed-$i',
      now: now + i,
    );
  }
}

/// `rgba(r, g, b, a)` from Rust → a Flutter colour.
///
/// The mix, the ambient pull and the readability curve all happened on the
/// other side of the boundary; this only parses the answer.
Color parseRgba(String s) {
  final n = RegExp(r'[-0-9.eE+]+')
      .allMatches(s)
      .map((m) => double.parse(m.group(0)!))
      .toList();
  return Color.fromRGBO(n[0].toInt(), n[1].toInt(), n[2].toInt(), n.length > 3 ? n[3] : 1);
}

const paper = '#FBF7F0';
const card = '#FFFFFF';
const ink = '#2B2622';

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(
        title: '大红花记账',
        debugShowCheckedModeBanner: false,
        home: Home(),
      );
}

/// The two screens, until there is a router worth having.
class Home extends StatefulWidget {
  const Home({super.key});

  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  int _tab = 0;
  int _listVersion = 0;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: IndexedStack(
          index: _tab,
          children: [
            // rebuilt by key when the tab changes, so the list re-reads the
            // ledger a save just added to
            EntryListScreen(key: ValueKey(_listVersion)),
            sheet.RecordSheet(onSaved: ({required staleRate}) {
              setState(() => _listVersion++);
            }),
          ],
        ),
        // Material 3's default NavigationBar paints itself lavender, which
        // against this palette's warm paper reads as a different application's
        // chrome. The colours are the theme's, not the framework's.
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          backgroundColor: palette.card,
          surfaceTintColor: Colors.transparent,
          indicatorColor: palette.stamen.withValues(alpha: 0.18),
          height: 64,
          labelTextStyle: WidgetStatePropertyAll(
            TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: palette.inkSoft),
          ),
          destinations: [
            NavigationDestination(
              icon: Icon(Icons.receipt_long, color: palette.inkSoft),
              selectedIcon: Icon(Icons.receipt_long, color: palette.hibiscus),
              label: '账目',
            ),
            NavigationDestination(
              icon: Icon(Icons.add_circle_outline, color: palette.inkSoft),
              selectedIcon: Icon(Icons.add_circle, color: palette.hibiscus),
              label: '记一笔',
            ),
          ],
        ),
      );
}

/// The throwaway prototype, kept.
///
/// It is not a screen the app uses any more — the real record sheet is
/// record_sheet.dart. This is what answered the three questions the
/// architecture had to settle on a device before Flutter was chosen: does a
/// Chinese IME compose, does 柔光玻璃 render, do accessibility labels reach
/// Android. It still demonstrates the fourth: every colour on it is computed in
/// Rust. Renamed because two classes called RecordSheet is one too many.
class MaterialProbe extends StatefulWidget {
  const MaterialProbe({super.key});

  @override
  State<MaterialProbe> createState() => _MaterialProbeState();
}

class _MaterialProbeState extends State<MaterialProbe> {
  final _note = TextEditingController();
  String _expr = '';

  @override
  void initState() {
    super.initState();
    _note.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _key(String k) => setState(() => _expr = calc.applyKey(expr: _expr, key: k));

  @override
  Widget build(BuildContext context) {
    // Every one of these is a Rust call.
    final tier = glass.resolveTier(reduceTransparency: false, isWeb: false);
    final spec = glass.glassSpec(isDark: false, level: glass.GlassLevel.card);
    final alpha = glass.readabilityAlpha(
      isDark: false,
      level: glass.GlassLevel.card,
      density: 0.6,
      tier: tier,
    );
    final wash = glass.washColor(
      isDark: false,
      card: card,
      paper: paper,
      level: glass.GlassLevel.card,
      under: paper,
      alpha: alpha,
    );
    final total = calc.evalExpr(expr: _expr);
    final showsTotal = calc.hasOperator(expr: _expr);

    return Scaffold(
      backgroundColor: parseRgba(glass.washColor(
        isDark: false,
        card: paper,
        paper: paper,
        level: glass.GlassLevel.card,
        alpha: 1,
      )),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('记一笔',
                  style: TextStyle(fontSize: 30, fontWeight: FontWeight.w700, color: Color(0xFF2B2622))),
              const SizedBox(height: 16),
              // Detailed content *behind* the glass, so a real backdrop blur is
              // distinguishable from a flat translucent slab.
              _behind(),
              const SizedBox(height: -60 + 60),
              Transform.translate(
                offset: const Offset(0, -46),
                child: _glassCard(spec, wash, showsTotal ? total : null),
              ),
              const Text('备注（在这里用中文输入法打字）',
                  style: TextStyle(fontSize: 14, color: Color(0xFF8A8178))),
              const SizedBox(height: 8),
              Semantics(
                label: '备注',
                textField: true,
                child: TextField(
                  controller: _note,
                  decoration: InputDecoration(
                    hintText: '午饭、打车、房租…',
                    filled: true,
                    fillColor: Colors.white,
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Color(0xFFEADFCF)),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Color(0xFFE0A93C), width: 2),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text('读回：「${_note.text}」 长度 ${_note.text.length}',
                  style: const TextStyle(fontSize: 14, color: Color(0xFFB83A48))),
              const SizedBox(height: 16),
              _keypad(),
              const SizedBox(height: 10),
              Text('tier=${tier.name}  intensity=${spec.intensity}  alpha=$alpha\n$wash',
                  style: const TextStyle(fontSize: 12, color: Color(0xFF8A8178))),
            ],
          ),
        ),
      ),
    );
  }

  /// Busy content the glass sits over, so the blur has something to blur.
  Widget _behind() => Container(
        height: 150,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          gradient: const LinearGradient(
            colors: [Color(0xFFE8AB80), Color(0xFF8DC0E0), Color(0xFF94C494)],
          ),
        ),
        padding: const EdgeInsets.all(14),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('餐饮 · 现金 · -35.00', style: TextStyle(color: Colors.white, fontSize: 17)),
            Text('交通 · 支付宝 · -12.00', style: TextStyle(color: Colors.white, fontSize: 17)),
            Text('工资 · 招行 · +9,000.00', style: TextStyle(color: Colors.white, fontSize: 17)),
            Text('购物 · 微信 · -218.40', style: TextStyle(color: Colors.white, fontSize: 17)),
          ],
        ),
      );

  /// The material itself: a real backdrop blur behind a wash Rust computed.
  Widget _glassCard(glass.GlassSpec spec, String wash, double? total) {
    // `intensity` is an expo-blur 0–100; Flutter's sigma is a radius in
    // logical pixels. The shipping tuning treats them as the same curve.
    final sigma = spec.intensity / 3.5;
    final hairline = spec.edgeWidth < 0 ? 1 / MediaQuery.devicePixelRatioOf(context) : spec.edgeWidth;
    return ClipRRect(
      borderRadius: BorderRadius.circular(26),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
        child: Container(
          height: 132,
          decoration: BoxDecoration(
            color: parseRgba(wash),
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: parseRgba(spec.edge), width: hairline),
          ),
          alignment: Alignment.center,
          child: Semantics(
            label: '金额',
            child: Text(
              total != null ? total.toStringAsFixed(2) : (_expr.isEmpty ? '0' : _expr),
              style: const TextStyle(
                  fontSize: 44, fontWeight: FontWeight.w700, color: Color(0xFF2B2622)),
            ),
          ),
        ),
      ),
    );
  }

  Widget _keypad() {
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 2.1,
      children: [
        for (final k in keys)
          Semantics(
            label: k == '⌫' ? '退格' : k,
            button: true,
            child: Material(
              color: const Color(0xFFF6EEE2),
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () {
                  HapticFeedback.selectionClick();
                  _key(k == '⌫' ? 'back' : k);
                },
                child: Center(
                  child: Text(k, style: const TextStyle(fontSize: 24, color: Color(0xFF2B2622))),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
