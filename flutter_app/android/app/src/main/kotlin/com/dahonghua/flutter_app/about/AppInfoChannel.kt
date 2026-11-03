package com.dahonghua.flutter_app.about

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/**
 * Which build this is, as Android installed it — for 设置 › 关于大红花, and for
 * the head of the diagnostic trail, which is where a bug report gets it from.
 *
 * From the package manager rather than Dart, because two of the facts are not
 * anywhere Dart can see. The versionCode a phone holds is Flutter's split
 * offset — 2001 for the arm64 APK, where pubspec says 1 — and `-debugsigned`
 * is stamped onto the name by Gradle, after Flutter has handed it over. That
 * stamp is the one worth showing: a phone holding such a build cannot take a
 * properly signed update without an uninstall, and the uninstall takes the
 * ledger with it.
 */
object AppInfoChannel {
  const val NAME = "com.dahonghua/app_info"

  /**
   * `versionNameSuffix` in build.gradle.kts: a release built with no
   * key.properties, signed with the debug key instead.
   */
  const val DEBUG_SIGNED = "-debugsigned"

  fun register(messenger: BinaryMessenger, context: Context) {
    MethodChannel(messenger, NAME).setMethodCallHandler { call, result ->
      when (call.method) {
        "info" -> result.success(read(context))
        else -> result.notImplemented()
      }
    }
  }

  private fun read(context: Context): Map<String, Any> {
    val pm = context.packageManager
    val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION")
      pm.getPackageInfo(context.packageName, 0)
    }
    val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }
    val debuggable =
      (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    return describe(info.versionName, code, debuggable)
  }

  /**
   * What Dart is told, from what the package manager said. Apart from [read]
   * so a JVM test can reach it without a phone.
   */
  fun describe(versionName: String?, versionCode: Long, debuggable: Boolean): Map<String, Any> {
    val name = versionName.orEmpty()
    return mapOf(
      "version" to name.removeSuffix(DEBUG_SIGNED),
      "code" to versionCode,
      "debugSigned" to name.endsWith(DEBUG_SIGNED),
      "debuggable" to debuggable,
    )
  }
}
