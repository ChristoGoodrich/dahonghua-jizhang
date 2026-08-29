package com.dahonghua.flutter_app.notif

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/**
 * Dart's surface for the notification listener. Nothing here interprets a
 * payment — it grants access to the permission state, the capture toggle, and
 * the queue. Reading a notification's meaning is the Rust core's job, and it
 * answers to a parity corpus; nothing in this file could.
 *
 * This replaces the shipping build's Expo module one method at a time. The
 * method names are kept, so the two can be read side by side.
 */
object NotifChannel {
  const val NAME = "com.dahonghua/notif"

  fun register(messenger: BinaryMessenger, context: Context) {
    MethodChannel(messenger, NAME).setMethodCallHandler { call, result ->
      when (call.method) {
        // Read from Settings.Secure rather than cached, because the user can
        // revoke access in system settings at any time and the app is never
        // told. Every drain re-checks it, which is how a silently revoked
        // permission surfaces instead of looking like "no payments today".
        "isEnabled" -> result.success(isEnabled(context))

        // Notification access can only be granted by the user in system
        // settings — there is no runtime-permission dialog for it.
        "openSettings" -> {
          context.startActivity(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          result.success(null)
        }

        "isCapturing" -> result.success(NotifStore.isCapturing(context))

        "setCapturing" -> {
          NotifStore.setCapturing(context, call.arguments as? Boolean ?: false)
          result.success(null)
        }

        "getWatchedPackages" ->
          result.success(NotifStore.watchedPackages(context).toList())

        "setWatchedPackages" -> {
          @Suppress("UNCHECKED_CAST")
          val packages = (call.arguments as? List<String>) ?: emptyList()
          NotifStore.setWatchedPackages(context, packages.toSet())
          result.success(null)
        }

        "pendingCount" -> result.success(NotifStore.count(context))

        "getPending" -> {
          val limit = (call.arguments as? Int) ?: 200
          result.success(NotifStore.pending(context, limit).map { it.toMap() })
        }

        // Acknowledged only after Dart has the rows in the ledger, so a crash
        // mid-drain replays instead of losing payments.
        "markConsumed" -> {
          @Suppress("UNCHECKED_CAST")
          val ids = (call.arguments as? List<String>) ?: emptyList()
          NotifStore.delete(context, ids)
          result.success(null)
        }

        "clearPending" -> {
          NotifStore.clear(context)
          result.success(null)
        }

        else -> result.notImplemented()
      }
    }
  }

  private fun isEnabled(context: Context): Boolean {
    // Settings.Secure.ENABLED_NOTIFICATION_LISTENERS is @hide, so the key is
    // spelled out — this is the standard way to read notification access.
    val flat = Settings.Secure.getString(
      context.contentResolver,
      "enabled_notification_listeners",
    )
    val component = ComponentName(context, NotifCaptureService::class.java)
    return flat?.split(':')?.any {
      val parsed = ComponentName.unflattenFromString(it)
      parsed != null && parsed.packageName == component.packageName
    } ?: false
  }
}
