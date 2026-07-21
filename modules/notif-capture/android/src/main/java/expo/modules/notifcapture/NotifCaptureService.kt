package expo.modules.notifcapture

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
 * They live in src/domain/notifParse.ts instead.
 */
class NotifCaptureService : NotificationListenerService() {

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val notification = sbn ?: return
    if (!NotifStore.isCapturing(this)) return
    if (notification.packageName == packageName) return // never capture ourselves
    if (notification.packageName !in NotifStore.watchedPackages(this)) return

    val extras = notification.notification?.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    if (title == null && body == null && bigText == null) return

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
}
