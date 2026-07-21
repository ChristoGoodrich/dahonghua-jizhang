package expo.modules.notifcapture

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Durable queue for captured notifications.
 *
 * The JS side is almost never running when a payment notification arrives, so
 * the listener cannot hand it to JavaScript — it writes here, and the app drains
 * the queue the next time it is opened. That is what keeps this design free of
 * headless JS: the process can die at any moment and nothing is lost.
 *
 * Rows are pruned by age and count so an app left unopened for months cannot
 * grow the database without bound. Anything lost to pruning is recoverable by
 * importing the wallet's monthly CSV.
 */
data class Captured(
  val id: String,
  val pkg: String,
  val title: String?,
  val body: String?,
  val bigText: String?,
  val postedAt: Long
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "pkg" to pkg,
    "title" to title,
    "text" to body,
    "bigText" to bigText,
    "postedAt" to postedAt
  )
}

private class NotifDb(context: Context) :
  SQLiteOpenHelper(context.applicationContext, "notif_capture.db", null, 1) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      create table captures (
        id integer primary key autoincrement,
        pkg text not null,
        title text,
        body text,
        big_text text,
        posted_at integer not null
      )
      """.trimIndent()
    )
    db.execSQL("create index captures_posted_at on captures (posted_at)")
  }

  // The queue is a cache, not a record: anything undrained is reconstructable
  // from the wallet's CSV, so a schema change just starts over.
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    db.execSQL("drop table if exists captures")
    onCreate(db)
  }
}

object NotifStore {
  private const val PREFS = "notif_capture_prefs"
  private const val KEY_CAPTURING = "capturing"
  private const val KEY_PACKAGES = "packages"

  private const val MAX_ROWS = 500
  private const val MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000 // 30 days

  /**
   * Only these apps are ever written to disk.
   *
   * This is a privacy boundary, not a parsing rule. WeChat sends chat messages
   * through the same listener as payments; without a whitelist every message the
   * user receives would be persisted. Interpretation still happens entirely in
   * TypeScript (src/domain/notifParse.ts) — this list only decides what is
   * allowed to be stored at all.
   *
   * Package ids drift between app versions and OEM channel builds, so JS can
   * replace this list at runtime via setWatchedPackages().
   */
  val DEFAULT_PACKAGES: Set<String> = setOf(
    "com.eg.android.AlipayGphone", // 支付宝
    "com.alipay.android.app",      // 支付宝 (payment component on some builds)
    "com.tencent.mm",              // 微信
    "com.unionpay",                // 云闪付
    "com.icbc",                    // 工商银行
    "com.chinamworld.main",        // 建设银行
    "com.chinamworld.bocmbci",     // 中国银行
    "com.android.bankabc",         // 农业银行
    "cmb.pb",                      // 招商银行
    "com.bankcomm.Bankcomm",       // 交通银行
    "cn.com.spdb.mobilebank.per",  // 浦发银行
    "com.ecitic.bank.mobile",      // 中信银行
    "cn.com.cmbc.newmbank",        // 民生银行
    "com.cebbank.mobile.cemb",     // 光大银行
    "com.cib.cibmb"                // 兴业银行
  )

  @Volatile private var helper: NotifDb? = null

  @Synchronized
  private fun db(context: Context): SQLiteDatabase {
    val h = helper ?: NotifDb(context.applicationContext).also { helper = it }
    return h.writableDatabase
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ---------- settings ----------

  /** Capture is off until the user turns it on, even once notification access
   *  has been granted — permission and intent are separate decisions. */
  fun isCapturing(context: Context): Boolean =
    prefs(context).getBoolean(KEY_CAPTURING, false)

  fun setCapturing(context: Context, on: Boolean) {
    prefs(context).edit().putBoolean(KEY_CAPTURING, on).apply()
  }

  fun watchedPackages(context: Context): Set<String> =
    prefs(context).getStringSet(KEY_PACKAGES, null) ?: DEFAULT_PACKAGES

  fun setWatchedPackages(context: Context, packages: Set<String>) {
    prefs(context).edit().putStringSet(KEY_PACKAGES, packages).apply()
  }

  // ---------- queue ----------

  fun insert(context: Context, pkg: String, title: String?, body: String?, bigText: String?, postedAt: Long) {
    val values = ContentValues().apply {
      put("pkg", pkg)
      put("title", title)
      put("body", body)
      put("big_text", bigText)
      put("posted_at", postedAt)
    }
    val database = db(context)
    database.insert("captures", null, values)
    prune(database)
  }

  fun pending(context: Context, limit: Int): List<Captured> {
    val out = ArrayList<Captured>()
    db(context).query(
      "captures",
      arrayOf("id", "pkg", "title", "body", "big_text", "posted_at"),
      null, null, null, null,
      "posted_at asc",
      limit.coerceIn(1, MAX_ROWS).toString()
    ).use { c ->
      while (c.moveToNext()) {
        out.add(
          Captured(
            id = c.getLong(0).toString(),
            pkg = c.getString(1),
            title = if (c.isNull(2)) null else c.getString(2),
            body = if (c.isNull(3)) null else c.getString(3),
            bigText = if (c.isNull(4)) null else c.getString(4),
            postedAt = c.getLong(5)
          )
        )
      }
    }
    return out
  }

  fun count(context: Context): Int {
    db(context).rawQuery("select count(*) from captures", null).use { c ->
      return if (c.moveToFirst()) c.getInt(0) else 0
    }
  }

  /** Acknowledge rows the app has taken responsibility for. Ids come straight
   *  back from pending(), so they're parsed rather than interpolated. */
  fun delete(context: Context, ids: List<String>) {
    val numeric = ids.mapNotNull { it.toLongOrNull() }
    if (numeric.isEmpty()) return
    val placeholders = numeric.joinToString(",") { "?" }
    db(context).delete("captures", "id in ($placeholders)", numeric.map { it.toString() }.toTypedArray())
  }

  fun clear(context: Context) {
    db(context).delete("captures", null, null)
  }

  private fun prune(database: SQLiteDatabase) {
    database.delete("captures", "posted_at < ?", arrayOf((System.currentTimeMillis() - MAX_AGE_MS).toString()))
    // MAX_ROWS is a compile-time constant, so it is interpolated rather than
    // bound — LIMIT placeholders are the one spot SQLite binding is fussy about.
    database.execSQL("delete from captures where id not in (select id from captures order by posted_at desc limit $MAX_ROWS)")
  }
}
