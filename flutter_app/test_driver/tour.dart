// The host side of `integration_test/tour.dart`: writes each screenshot the
// tour takes to `build/tour/<name>.png`.
//
// A separate driver from `integration_test.dart` because that one runs the
// suite and has nothing to do with screenshots; giving it an `onScreenshot`
// would make every suite run write a folder of PNGs nobody asked for.

import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final out = Directory('build/tour')..createSync(recursive: true);
  await integrationDriver(
    onScreenshot: (name, bytes, [args]) async {
      File('${out.path}/$name.png').writeAsBytesSync(bytes);
      return true;
    },
  );
}
