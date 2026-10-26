package com.dahonghua.flutter_app.widget

import android.content.Context
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/**
 * Dart's surface for the home-screen widget.
 *
 * One method. Everything it is handed is already decided and already
 * formatted — this writes it where a widget process can find it after the app
 * is gone, and asks the launcher to redraw.
 */
object WidgetChannel {
  const val NAME = "com.dahonghua/widget"

  fun register(messenger: BinaryMessenger, context: Context) {
    MethodChannel(messenger, NAME).setMethodCallHandler { call, result ->
      when (call.method) {
        "update" -> {
          val p = context.getSharedPreferences(
            BudgetWidgetProvider.PREFS, Context.MODE_PRIVATE
          )
          val next = BudgetWidgetProvider::nextKey
          p.edit()
            .putString(BudgetWidgetProvider.KEY_TITLE, call.argument<String>("title") ?: "")
            .putString(BudgetWidgetProvider.KEY_SPENT, call.argument<String>("spent") ?: "")
            .putString(BudgetWidgetProvider.KEY_LEFT, call.argument<String>("left") ?: "")
            .putInt(BudgetWidgetProvider.KEY_PCT, call.argument<Int>("pct") ?: 0)
            .putBoolean(BudgetWidgetProvider.KEY_OVER, call.argument<Boolean>("over") ?: false)
            .putBoolean(BudgetWidgetProvider.KEY_SET, call.argument<Boolean>("hasBudget") ?: false)
            // The next cycle: the same six, already worked out and already
            // worded, and when it begins. A Dart int crosses as an Integer or
            // a Long depending on its size, so that is read as a Number.
            .putString(next(BudgetWidgetProvider.KEY_TITLE), call.argument<String>("nextTitle") ?: "")
            .putString(next(BudgetWidgetProvider.KEY_SPENT), call.argument<String>("nextSpent") ?: "")
            .putString(next(BudgetWidgetProvider.KEY_LEFT), call.argument<String>("nextLeft") ?: "")
            .putInt(next(BudgetWidgetProvider.KEY_PCT), call.argument<Int>("nextPct") ?: 0)
            .putBoolean(next(BudgetWidgetProvider.KEY_OVER), call.argument<Boolean>("nextOver") ?: false)
            .putBoolean(next(BudgetWidgetProvider.KEY_SET), call.argument<Boolean>("nextHasBudget") ?: false)
            .putLong(BudgetWidgetProvider.KEY_NEXT_AT, call.argument<Number>("nextAt")?.toLong() ?: 0L)
            .apply()
          BudgetWidgetProvider.redrawAll(context)
          result.success(null)
        }

        else -> result.notImplemented()
      }
    }
  }
}
