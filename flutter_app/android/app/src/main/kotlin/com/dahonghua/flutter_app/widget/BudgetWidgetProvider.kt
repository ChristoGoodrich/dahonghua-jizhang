package com.dahonghua.flutter_app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import com.dahonghua.flutter_app.R

/**
 * The home-screen budget widget.
 *
 * Rebound from the React Native build's `plugins/android-widget`, and stripped
 * on the way: that version did arithmetic and formatting here, and this one
 * does neither. It reads finished strings out of SharedPreferences and draws
 * them.
 *
 * The reason is the same one the whole port rests on. A widget that computed
 * its own percentage could disagree with the budget screen — two answers to
 * one question, and the widget's answer is the one nobody would think to test.
 * `core::budget::tier_status` decides, with 4,210 parity cases behind it; Dart
 * renders the text because a currency and a label are locale strings; and this
 * file puts pixels on a home screen.
 *
 * A widget process is not the app's process. It is spun up by the launcher,
 * often after the app has been killed, so it can read only what was left
 * behind for it — which is why the numbers are cached in preferences rather
 * than asked for.
 */
class BudgetWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    for (id in appWidgetIds) draw(context, appWidgetManager, id)
  }

  companion object {
    const val PREFS = "dahonghua_widget"
    const val KEY_TITLE = "title"
    const val KEY_PCT = "pct"
    const val KEY_SPENT = "spent_text"
    const val KEY_LEFT = "left_text"
    const val KEY_OVER = "over"
    const val KEY_SET = "has_budget"

    fun draw(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val views = RemoteViews(context.packageName, R.layout.widget_budget)

      // Clamped for the progress bar only. The colour below is chosen from
      // `over`, which is not derivable from a clamped percentage — 100% and
      // 140% both arrive here as 100.
      val pct = prefs.getInt(KEY_PCT, 0).coerceIn(0, 100)
      val over = prefs.getBoolean(KEY_OVER, false)
      val hasBudget = prefs.getBoolean(KEY_SET, false)

      views.setTextViewText(R.id.widget_month, prefs.getString(KEY_TITLE, "") ?: "")
      views.setTextViewText(R.id.widget_spent, prefs.getString(KEY_SPENT, "") ?: "")
      views.setTextViewText(R.id.widget_remaining, prefs.getString(KEY_LEFT, "") ?: "")
      views.setTextViewText(
        R.id.widget_percentage,
        percentageLabel(hasBudget, pct)
      )
      views.setProgressBar(R.id.widget_progress, 100, pct, false)

      views.setTextColor(R.id.widget_percentage, accent(over, pct))

      manager.updateAppWidget(widgetId, views)
    }

    /**
     * What the percentage cell reads. No budget is a dash, not "0%" — claiming
     * a cap of zero is a different sentence from having none.
     */
    fun percentageLabel(hasBudget: Boolean, pct: Int): String =
      if (hasBudget) "$pct%" else "—"

    /**
     * The shipping build painted over-budget and normal the SAME red, so the
     * orange warning appeared at 81% and vanished again at 101% — the state
     * that matters most looked exactly like the state that matters least.
     * Nothing chose that; it is two branches of a `when` that were never
     * compared. Over budget is now the loudest of the three.
     *
     * `pct` here is the **unclamped** one: 100 and 140 both draw a full bar,
     * and the colour is the only place that difference survives.
     */
    fun accent(over: Boolean, pct: Int): Int = when {
      over -> OVER
      pct > 80 -> CLOSE
      else -> FINE
    }

    /** Redraw every placed instance. Called after the app writes new numbers. */
    fun redrawAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        ComponentName(context, BudgetWidgetProvider::class.java)
      )
      for (id in ids) draw(context, manager, id)
    }

    const val OVER = 0xFFC62828.toInt()  // deep red — over the cap
    const val CLOSE = 0xFFFF9800.toInt() // orange — close to it
    const val FINE = 0xFFE8384F.toInt()  // 大红花, the ordinary state
  }
}
