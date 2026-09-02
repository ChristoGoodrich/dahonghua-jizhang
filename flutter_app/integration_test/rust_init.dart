// Bringing the Rust core up, exactly once.
//
// `RustLib.init()` throws on a second call — "Should not initialize
// flutter_rust_bridge twice" — which never came up while every test file was
// its own process. Under `all_test.dart` they share one, and the 33rd file's
// `setUpAll` was the 33rd call.
//
// The guard is a library-level flag, so it is per-process: a single file run
// on its own still initialises, and the aggregated run initialises once. That
// is the same guarantee either way, which is the point — a test should not be
// able to tell how it was launched.

import 'package:flutter_app/src/rust/frb_generated.dart';

bool _started = false;

Future<void> ensureRust() async {
  if (_started) return;
  _started = true;
  await RustLib.init();
}
