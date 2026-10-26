package com.dahonghua.flutter_app.remind

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * What the manifest owes `flutter_local_notifications` before a reminder can fire.
 *
 * The plugin hands AlarmManager an explicit intent for its own receiver, and
 * declares neither that receiver nor the boot one in its manifest: the app has
 * to. This app did not, so every reminder, weekly and monthly report was
 * scheduled, accepted, and then delivered to a class Android had never been
 * told about — which is silence, not an error. `remind_test` faked the
 * notifier, so nothing ever reached the real one.
 *
 * Read from the source manifest because that is what gets edited. The class
 * names are checked against the plugin on the classpath, so an upgrade that
 * moves a receiver fails here rather than on somebody's phone.
 */
class ReminderManifestTest {

  private val android = "http://schemas.android.com/apk/res/android"

  private val manifest: Element by lazy {
    val file = File("src/main/AndroidManifest.xml")
    assertTrue("manifest not found from ${File(".").absolutePath}", file.isFile)
    DocumentBuilderFactory.newInstance()
      .apply { isNamespaceAware = true }
      .newDocumentBuilder()
      .parse(file)
      .documentElement
  }

  private fun Element.children(tag: String): List<Element> {
    val nodes = getElementsByTagName(tag)
    return (0 until nodes.length).map { nodes.item(it) as Element }
  }

  private fun Element.attr(name: String): String = getAttributeNS(android, name)

  private fun receiver(name: String): Element {
    val found = manifest.children("receiver").filter { it.attr("name") == name }
    assertEquals("receivers named $name", 1, found.size)
    return found.single()
  }

  @Test
  fun the_receiver_a_due_reminder_is_delivered_to_is_declared() {
    val r = receiver(SCHEDULED)
    // only the app's own alarm reaches it
    assertEquals("false", r.attr("exported"))
  }

  @Test
  fun reminders_are_put_back_after_a_reboot() {
    // AlarmManager forgets everything at a reboot; the plugin keeps its own
    // list and re-schedules from it, if it is woken
    val r = receiver(BOOT)
    assertEquals("false", r.attr("exported"))
    val actions = r.children("action").map { it.attr("name") }.toSet()
    assertTrue(actions.toString(), "android.intent.action.BOOT_COMPLETED" in actions)
    // an update clears the app's alarms too
    assertTrue(actions.toString(), "android.intent.action.MY_PACKAGE_REPLACED" in actions)

    val permissions = manifest.children("uses-permission").map { it.attr("name") }
    assertTrue(
      permissions.toString(),
      "android.permission.RECEIVE_BOOT_COMPLETED" in permissions,
    )
  }

  @Test
  fun both_names_are_classes_the_plugin_still_has() {
    for (name in listOf(SCHEDULED, BOOT)) {
      // not initialised: loading is the question, and a static initialiser
      // would reach for an Android that a JVM test does not have
      Class.forName(name, false, javaClass.classLoader)
    }
  }

  companion object {
    const val SCHEDULED =
      "com.dexterous.flutterlocalnotifications.ScheduledNotificationReceiver"
    const val BOOT =
      "com.dexterous.flutterlocalnotifications.ScheduledNotificationBootReceiver"
  }
}
