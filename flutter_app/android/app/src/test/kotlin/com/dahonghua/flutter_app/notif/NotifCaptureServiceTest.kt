package com.dahonghua.flutter_app.notif

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The gate in front of the capture queue.
 *
 * Content rules live in `core::notif` behind a 1,284-case corpus. What is
 * here is only "is this a notification this app was asked to store" — and it
 * is worth pinning because getting it wrong is either a queue full of chat
 * apps or a payment that never arrives.
 */
class NotifCaptureServiceTest {

  private val self = "com.dahonghua.app.debug"
  private val alipay = "com.eg.android.AlipayGphone"
  private val wechat = "com.tencent.mm"
  private val watched = setOf(alipay, wechat)

  private fun keep(
    pkg: String = alipay,
    title: String? = "支付宝",
    body: String? = "付款 35 元",
    bigText: String? = null,
    watch: Set<String> = watched,
    selfPkg: String = self,
  ) = NotifCaptureService.shouldCapture(pkg, selfPkg, watch, title, body, bigText)

  @Test
  fun a_watched_payment_notification_is_kept() {
    assertTrue(keep())
    assertTrue(keep(pkg = wechat, title = null, body = "微信支付", bigText = null))
  }

  @Test
  fun we_never_capture_ourselves() {
    assertFalse(keep(pkg = self))
    assertFalse(keep(pkg = self, watch = watched + self))
  }

  @Test
  fun a_package_nobody_asked_for_is_ignored() {
    assertFalse(keep(pkg = "com.android.launcher"))
    assertFalse(keep(pkg = "com.whatsapp"))
  }

  @Test
  fun something_with_no_text_at_all_is_not_a_payment() {
    assertFalse(keep(title = null, body = null, bigText = null))
    // any one field is enough
    assertTrue(keep(title = "标题", body = null, bigText = null))
    assertTrue(keep(title = null, body = "正文", bigText = null))
    assertTrue(keep(title = null, body = null, bigText = "大段"))
  }

  @Test
  fun empty_strings_count_as_text() {
    // An empty title is still "present" — the content rules in core decide
    // whether it says anything. This gate only asks whether fields arrived.
    assertTrue(keep(title = "", body = null, bigText = null))
  }

  @Test
  fun an_empty_whitelist_keeps_nothing() {
    assertFalse(keep(watch = emptySet()))
  }
}

/**
 * What the queue hands to Flutter. The keys are the contract: a rename here
 * is a silent drop on the Dart side, which reads them by name.
 */
class CapturedMapTest {
  @Test
  fun the_map_uses_the_keys_dart_reads() {
    val row = Captured(
      id = "7",
      pkg = "com.eg.android.AlipayGphone",
      title = "支付宝",
      body = "付款",
      bigText = null,
      postedAt = 1_700_000_000_000,
    )
    val map = row.toMap()
    assertEquals("7", map["id"])
    assertEquals("com.eg.android.AlipayGphone", map["pkg"])
    assertEquals("支付宝", map["title"])
    assertEquals("付款", map["text"])
    assertEquals(null, map["bigText"])
    assertEquals(1_700_000_000_000L, map["postedAt"])
    assertEquals(6, map.size)
  }
}
