package com.dahonghua.flutter_app.about

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What 关于大红花 is told about the build.
 *
 * The stamp is a string in two files. If build.gradle.kts changed it and this
 * did not, a debug-signed build would be reported as a proper one, and the one
 * warning that saves somebody's ledger would quietly stop appearing.
 */
class AppInfoChannelTest {

  @Test
  fun a_debug_signed_release_says_so_and_keeps_its_number() {
    val m = AppInfoChannel.describe("1.0.0-debugsigned", 2001, debuggable = false)
    assertEquals("1.0.0", m["version"])
    assertEquals(2001L, m["code"])
    assertEquals(true, m["debugSigned"])
    assertEquals(false, m["debuggable"])
  }

  @Test
  fun a_properly_signed_release_does_not() {
    val m = AppInfoChannel.describe("1.2.0", 2003, debuggable = false)
    assertEquals("1.2.0", m["version"])
    assertEquals(false, m["debugSigned"])
  }

  @Test
  fun a_development_build_is_debuggable_and_not_stamped() {
    val m = AppInfoChannel.describe("1.0.0", 1, debuggable = true)
    assertEquals(false, m["debugSigned"])
    assertEquals(true, m["debuggable"])
  }

  @Test
  fun no_name_is_an_empty_one() {
    assertEquals("", AppInfoChannel.describe(null, 0, debuggable = false)["version"])
  }

  @Test
  fun the_stamp_is_the_one_gradle_adds() {
    val gradle = File("build.gradle.kts")
    assertTrue("build.gradle.kts not found from ${File(".").absolutePath}", gradle.isFile)
    assertTrue(
      "build.gradle.kts does not stamp '${AppInfoChannel.DEBUG_SIGNED}'",
      gradle.readText().contains("versionNameSuffix = \"${AppInfoChannel.DEBUG_SIGNED}\""),
    )
  }

  @Test
  fun dart_calls_the_name_kotlin_registers() {
    val dart = File("../../lib/app_info.dart")
    assertTrue("app_info.dart not found from ${File(".").absolutePath}", dart.isFile)
    assertTrue(
      "lib/app_info.dart does not name '${AppInfoChannel.NAME}'",
      dart.readText().contains("'${AppInfoChannel.NAME}'"),
    )
  }
}
