package com.dahonghua.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.SharedPreferences
import android.widget.RemoteViews
import com.dahonghua.app.R
import java.text.NumberFormat
import java.util.Locale

/**
 * Budget widget for Xiaomi HyperOS.
 * Reads budget data from SharedPreferences (shared via React Native).
 */
class BudgetWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        private const val PREFS_NAME = "dahonghua_widget"
        private const val KEY_SPENT = "spent"
        private const val KEY_BUDGET = "budget"
        private const val KEY_BUDGET_MODE = "budget_mode" // "monthly" or "weekly"

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val spent = prefs.getFloat(KEY_SPENT, 0f).toDouble()
            val budget = prefs.getFloat(KEY_BUDGET, 0f).toDouble()
            val budgetMode = prefs.getString(KEY_BUDGET_MODE, "monthly") ?: "monthly"

            val views = RemoteViews(context.packageName, R.layout.widget_budget)

            // Calculate percentage
            val percentage = if (budget > 0) minOf((spent / budget * 100).toInt(), 100) else 0
            val remaining = maxOf(budget - spent, 0.0)
            val isOverBudget = spent > budget

            // Format currency
            val nf = NumberFormat.getCurrencyInstance(Locale.CHINA)
            nf.maximumFractionDigits = 0

            // Update views
            views.setTextViewText(R.id.widget_percentage, "$percentage%")
            views.setTextViewText(R.id.widget_spent, "已花 ${nf.format(spent)}")
            views.setTextViewText(R.id.widget_remaining, "剩余 ${nf.format(remaining)}")
            views.setTextViewText(
                R.id.widget_month,
                if (budgetMode == "weekly") "本周预算" else "本月预算"
            )
            views.setProgressBar(R.id.widget_progress, 100, percentage, false)

            // Set text color based on budget status
            val color = when {
                isOverBudget -> 0xFFE8384F.toInt() // Red
                percentage > 80 -> 0xFFFF9800.toInt() // Orange
                else -> 0xFFE8384F.toInt() // Default red (大红花 color)
            }
            views.setTextColor(R.id.widget_percentage, color)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        /**
         * Call this from React Native to update widget data.
         */
        fun updateWidgetData(
            context: Context,
            spent: Double,
            budget: Double,
            budgetMode: String = "monthly"
        ) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putFloat(KEY_SPENT, spent.toFloat())
                .putFloat(KEY_BUDGET, budget.toFloat())
                .putString(KEY_BUDGET_MODE, budgetMode)
                .apply()

            // Trigger widget update
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val componentName = android.content.ComponentName(
                context,
                BudgetWidgetProvider::class.java
            )
            val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
            for (appWidgetId in appWidgetIds) {
                updateAppWidget(context, appWidgetManager, appWidgetId)
            }
        }
    }
}
