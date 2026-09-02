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
          p.edit()
            .putString(BudgetWidgetProvider.KEY_TITLE, call.argument<String>("title") ?: "")
            .putString(BudgetWidgetProvider.KEY_SPENT, call.argument<String>("spent") ?: "")
            .putString(BudgetWidgetProvider.KEY_LEFT, call.argument<String>("left") ?: "")
            .putInt(BudgetWidgetProvider.KEY_PCT, call.argument<Int>("pct") ?: 0)
            .putBoolean(BudgetWidgetProvider.KEY_OVER, call.argument<Boolean>("over") ?: false)
            .putBoolean(BudgetWidgetProvider.KEY_SET, call.argument<Boolean>("hasBudget") ?: false)
            .apply()
          BudgetWidgetProvider.redrawAll(context)
          result.success(null)
        }

        else -> result.notImplemented()
      }
    }
  }
}
