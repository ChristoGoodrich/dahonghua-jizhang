// 诊断 — a small local trail, for when somebody says "it did something odd".
//
// No crash reporter, on purpose: this app's privacy story is that nothing
// leaves the phone unless the user sends it, and a telemetry pipeline would
// make that sentence a lie. What is left is the thing a good bug report
// actually needs — *when did storage complain, and about what* — kept on the
// device until the user chooses to put it in an issue.
//
// So: a ring of short lines, no amounts, no notes, no account names. The
// export is a text file handed to the share sheet like every other way this
// app lets data out.

import 'package:flutter/foundation.dart';

class Diagnostics {
  Diagnostics._();

  static final Diagnostics instance = Diagnostics._();

  static const int _cap = 200;

  final ValueNotifier<int> revision = ValueNotifier<int>(0);
  final List<String> _lines = [];

  /// One line. Keep it to what a reader can act on: a stage, a failure, a
  /// number of rows. Not a dump.
  void note(String line) {
    final stamp = DateTime.now().toIso8601String();
    _lines.add('$stamp  $line');
    if (_lines.length > _cap) {
      _lines.removeRange(0, _lines.length - _cap);
    }
    revision.value++;
  }

  /// The trail as plain text, for the share sheet.
  String dump() {
    if (_lines.isEmpty) return 'no diagnostics recorded\n';
    final b = StringBuffer('dahonghua diagnostics\n');
    b.writeln('lines=${_lines.length} (kept last $_cap)');
    b.writeln('---');
    for (final l in _lines) {
      b.writeln(l);
    }
    return b.toString();
  }

  /// Test helper. Not for the app.
  @visibleForTesting
  void clear() {
    _lines.clear();
    revision.value++;
  }
}

/// Shorthand for the one instance.
Diagnostics get diag => Diagnostics.instance;
