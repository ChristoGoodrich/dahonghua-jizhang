// The host side of `integration_test/perf.dart`: the frame times each screen
// reported, into `build/perf.json`.

import 'dart:convert';
import 'dart:io';

import 'package:integration_test/integration_test_driver.dart';

Future<void> main() => integrationDriver(
  responseDataCallback: (data) async {
    File('build/perf.json')
      ..createSync(recursive: true)
      ..writeAsStringSync(const JsonEncoder.withIndent('  ').convert(data));
  },
);
