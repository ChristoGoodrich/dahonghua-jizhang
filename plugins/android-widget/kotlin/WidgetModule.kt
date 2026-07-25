package com.dahonghua.app.widget

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

/**
 * React Native module for updating the Android budget widget.
 * Call WidgetModule.updateBudget(spent, budget, mode) from JS.
 */
class WidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BudgetWidget"

    @ReactMethod
    fun updateBudget(spent: Double, budget: Double, budgetMode: String, promise: Promise) {
        try {
            BudgetWidgetProvider.updateWidgetData(
                reactApplicationContext,
                spent,
                budget,
                budgetMode
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WIDGET_ERROR", e.message, e)
        }
    }
}
