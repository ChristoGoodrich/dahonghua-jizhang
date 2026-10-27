package com.dahonghua.flutter_app.remind

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * The reminder's small icon is a silhouette, because that is all Android
 * draws of one.
 *
 * The status bar paints a notification's small icon from its alpha channel,
 * in a single colour of the system's choosing. The reminders named
 * `@mipmap/ic_launcher` — the full-colour launcher icon, opaque edge to edge —
 * so every pixel had alpha and every reminder arrived as a grey square.
 *
 * Read from `lib/reminders.dart`, because that is where the name is chosen,
 * and resolved against the source resources, because that is what gets
 * edited.
 */
class ReminderIconTest {

  private val android = "http://schemas.android.com/apk/res/android"

  /** The name `AndroidInitializationSettings` is given. */
  private val named: String by lazy {
    val dart = File("../../lib/reminders.dart")
    assertTrue("reminders.dart not found from ${File(".").absolutePath}", dart.isFile)
    val found = Regex("""AndroidInitializationSettings\(\s*'([^']+)'""").find(dart.readText())
    assertTrue("no AndroidInitializationSettings in reminders.dart", found != null)
    found!!.groupValues[1]
  }

  private fun icon(): Element {
    val name = named.removePrefix("@drawable/")
    val file = File("src/main/res/drawable/$name.xml")
    assertTrue("$named is not a vector drawable in res/drawable", file.isFile)
    return DocumentBuilderFactory.newInstance()
      .apply { isNamespaceAware = true }
      .newDocumentBuilder()
      .parse(file)
      .documentElement
  }

  @Test
  fun the_small_icon_is_a_drawable_and_not_the_launcher_icon() {
    assertTrue(
      "the small icon is $named; a launcher icon is opaque and draws as a square",
      named.startsWith("@drawable/"),
    )
  }

  @Test
  fun it_is_one_colour_on_nothing() {
    val root = icon()
    assertEquals("vector", root.tagName)
    val paths = root.getElementsByTagName("path")
    assertTrue("a silhouette has a shape", paths.length > 0)
    for (i in 0 until paths.length) {
      val p = paths.item(i) as Element
      // White, opaque, and nothing else: the system tints it, and any other
      // colour or a partial alpha is a shape the tint cannot see.
      assertEquals("#FFFFFFFF", p.getAttributeNS(android, "fillColor").uppercase())
      assertEquals("", p.getAttributeNS(android, "strokeColor"))
      assertEquals("", p.getAttributeNS(android, "fillAlpha"))
    }
    // A gradient is a colour the tint would flatten.
    assertEquals(0, root.getElementsByTagName("gradient").length)
  }
}
