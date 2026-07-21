package expo.modules.notifcapture

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS surface for the notification listener. Nothing here interprets a payment —
 * it grants access to the permission state, the capture toggle, and the queue.
 */
class NotifCaptureModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NotifCapture")

    /**
     * Whether the user has granted notification access to *this* app.
     *
     * Read from Settings.Secure rather than cached, because the user can revoke
     * it in system settings at any time and the app is never told. Every drain
     * re-checks it, which is how a silently revoked permission surfaces.
     */
    Function("isEnabled") {
      // Settings.Secure.ENABLED_NOTIFICATION_LISTENERS is @hide, so the key is
      // spelled out — this is the standard way to read notification access.
      val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
      val component = ComponentName(context, NotifCaptureService::class.java)
      flat?.split(':')?.any {
        val parsed = ComponentName.unflattenFromString(it)
        parsed != null && parsed.packageName == component.packageName
      } ?: false
    }

    /** Notification access can only be granted by the user in system settings —
     *  there is no runtime-permission dialog for it. */
    Function("openSettings") {
      context.startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    Function("isCapturing") { NotifStore.isCapturing(context) }

    Function("setCapturing") { on: Boolean -> NotifStore.setCapturing(context, on) }

    Function("getWatchedPackages") { NotifStore.watchedPackages(context).toList() }

    Function("setWatchedPackages") { packages: List<String> ->
      NotifStore.setWatchedPackages(context, packages.toSet())
    }

    AsyncFunction("pendingCount") { NotifStore.count(context) }

    AsyncFunction("getPending") { limit: Int -> NotifStore.pending(context, limit).map { it.toMap() } }

    AsyncFunction("markConsumed") { ids: List<String> -> NotifStore.delete(context, ids) }

    AsyncFunction("clearPending") { NotifStore.clear(context) }
  }
}
