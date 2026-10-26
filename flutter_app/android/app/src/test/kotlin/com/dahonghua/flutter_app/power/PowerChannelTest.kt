package com.dahonghua.flutter_app.power

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Dart listens where this side speaks.
 *
 * The channel is a name in two languages. If they drift, Dart's listen fails
 * with a missing plugin, which it treats as "no platform says" — so battery
 * saver would quietly never be seen and the blur would never drop, with
 * nothing failing anywhere. Read from the source, as the manifest test is.
 */
class PowerChannelTest {

  @Test
  fun dart_listens_on_the_name_kotlin_registers() {
    val dart = File("../../lib/power.dart")
    assertTrue("power.dart not found from ${File(".").absolutePath}", dart.isFile)
    assertTrue(
      "lib/power.dart does not name '${PowerChannel.NAME}'",
      dart.readText().contains("'${PowerChannel.NAME}'"),
    )
  }
}
