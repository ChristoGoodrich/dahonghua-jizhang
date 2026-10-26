package com.dahonghua.flutter_app.remind

import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.util.TimeZone

/**
 * The phone's time zone, by name.
 *
 * Dart has an abbreviation and an offset; a reminder's schedule needs the
 * zone the tz database knows (`Asia/Shanghai`), and only the platform can say
 * which one the phone is in. Without it the schedule was built in UTC, and a
 * reminder for 21:00 was set for 05:00 the next morning in China.
 */
object ZoneChannel {
  const val NAME = "com.dahonghua/zone"

  fun register(messenger: BinaryMessenger) {
    MethodChannel(messenger, NAME).setMethodCallHandler { call, result ->
      when (call.method) {
        "id" -> result.success(TimeZone.getDefault().id)
        else -> result.notImplemented()
      }
    }
  }
}
