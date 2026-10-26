package com.dahonghua.flutter_app.power

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel

/**
 * Whether the phone is in battery saver, and every time that changes.
 *
 * The glass reads it: a backdrop blur is the most expensive thing the app
 * draws, and battery saver is the user asking the phone to spend less. What to
 * do about it is `core::glass::resolve_tier`'s; this only says what the phone
 * says.
 *
 * One stream rather than a call and a stream. Listening sends the current
 * state first and then each change, so Dart cannot read a value and miss the
 * change that lands before it starts listening. The receiver is registered
 * only while Dart listens, and dynamically — this broadcast is not delivered
 * to manifest receivers.
 */
object PowerChannel {
  const val NAME = "com.dahonghua/power"

  fun register(messenger: BinaryMessenger, context: Context) {
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    EventChannel(messenger, NAME).setStreamHandler(object : EventChannel.StreamHandler {
      private var receiver: BroadcastReceiver? = null

      override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
        events.success(power.isPowerSaveMode)
        val r = object : BroadcastReceiver() {
          override fun onReceive(c: Context, intent: Intent) {
            events.success(power.isPowerSaveMode)
          }
        }
        val filter = IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
        // Not exported: the system's own broadcast still arrives, and nothing
        // else on the phone can tell the glass the battery is low.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
          context.registerReceiver(r, filter)
        }
        receiver = r
      }

      override fun onCancel(arguments: Any?) {
        receiver?.let { context.unregisterReceiver(it) }
        receiver = null
      }
    })
  }
}
