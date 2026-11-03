// 关于 — which build this is, as the phone installed it.
//
// The bug template asks for a version and says where to find it, and for a
// long time there was nowhere: the app never said which build it was. What
// the phone holds is not quite pubspec's either. The versionCode is Flutter's
// split offset (2001 for arm64), and a release built without the signing key
// has `-debugsigned` stamped onto its name by Gradle. So the Kotlin side reads
// the package manager and says what it found — see AppInfoChannel — and this
// file only carries it.

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class AppInfo {
  const AppInfo({
    required this.version,
    required this.code,
    this.debugSigned = false,
    this.debuggable = false,
  });

  /// `1.0.0` — the name without Gradle's stamp.
  final String version;

  /// The versionCode Android compares an update against.
  final int code;

  /// A release signed with the debug key. A properly signed build cannot be
  /// installed over it; only an uninstall can, and that takes the ledger.
  final bool debugSigned;

  /// A development build, `com.dahonghua.app.debug`, beside the real app.
  final bool debuggable;

  /// One line for a bug report, in the words the template asks for.
  String get line =>
      '$version ($code)'
      '${debuggable ? ' debug' : ''}'
      '${debugSigned ? ' debug-signed' : ''}';
}

/// The build, once the platform has said. Null until then, and null where
/// there is no platform side to say.
final appInfo = ValueNotifier<AppInfo?>(null);

/// Ask the phone. Once is enough — the build does not change while it runs —
/// so a call after an answer does nothing.
Future<void> loadAppInfo() async {
  if (appInfo.value != null) return;
  try {
    final m = await const MethodChannel(
      'com.dahonghua/app_info',
    ).invokeMapMethod<String, Object?>('info');
    if (m == null) return;
    appInfo.value = AppInfo(
      version: m['version'] as String? ?? '',
      code: (m['code'] as num?)?.toInt() ?? 0,
      debugSigned: m['debugSigned'] == true,
      debuggable: m['debuggable'] == true,
    );
  } on MissingPluginException {
    // No platform side: stays null, and 关于 says it does not know.
  } on PlatformException {
    // The package manager refused, which it should not for the app's own
    // package. Same answer.
  }
}
