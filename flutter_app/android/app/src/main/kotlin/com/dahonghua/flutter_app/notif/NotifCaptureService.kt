package com.dahonghua.flutter_app.notif

import android.app.Notification
import android.content.ComponentName
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Captures payment notifications and parks them in [NotifStore].
 *
 * Deliberately dumb: whitelist check, pull out the three text fields, write the
 * row. No amount parsing, no category guessing, no filtering on content. Those
 * rules need constant tuning against real-world notification wording, and every
 * rule that lives here costs a full rebuild to change and cannot be unit-tested.
 * They live in the Rust core's `notif` module instead, where a
 * 1,284-case parity corpus holds them to the shipping app's behaviour.
 */
class NotifCaptureService : NotificationListenerService() {

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val notification = sbn ?: return
    if (!NotifStore.isCapturing(this)) return
    val extras = notification.notification?.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    if (!shouldCapture(
        pkg = notification.packageName,
        selfPkg = packageName,
        watched = NotifStore.watchedPackages(this),
        title = title,
        body = body,
        bigText = bigText,
      )
    ) {
      return
    }

    NotifStore.insert(this, notification.packageName, title, body, bigText, notification.postTime)
  }

  /**
   * HyperOS/MIUI unbind background services far more aggressively than stock
   * Android, and an unbound listener silently stops capturing — the failure mode
   * users report as "it worked for three days". requestRebind is the documented
   * recovery and is a no-op when the unbind was deliberate (user revoked access).
   */
  override fun onListenerDisconnected() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      requestRebind(ComponentName(this, NotifCaptureService::class.java))
    }
  }

  companion object {
    /**
     * Whether a posted notification is one this app stores.
     *
     * Deliberately narrow: whitelist package, never ourselves, and at least one
     * text field present. Content rules belong in `core::notif`, where the
     * parity corpus can hold them; this is only the gate that keeps the queue
     * from filling with launchers and chat apps the user never asked for.
     */
    fun shouldCapture(
      pkg: String,
      selfPkg: String,
      watched: Set<String>,
      title: String?,
      body: String?,
      bigText: String?,
    ): Boolean {
      if (pkg == selfPkg) return false
      if (pkg !in watched) return false
      return title != null || body != null || bigText != null
    }
  }
}
