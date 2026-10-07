package com.dahonghua.flutter_app.widget

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The two decisions the widget makes on its own.
 *
 * Everything else is a finished string from Dart. These two are worth a test
 * because the colour one was **wrong** when it shipped: over-budget and
 * ordinary were the same red, so the orange warning appeared at 81% and
 * vanished again at 101%.
 */
class BudgetWidgetProviderTest {

  @Test
  fun over_budget_is_the_loudest_colour_however_full_the_bar() {
    // 100 and 140 both draw a full bar; only the colour keeps the difference.
    assertEquals(BudgetWidgetProvider.OVER, BudgetWidgetProvider.accent(over = true, pct = 100))
    assertEquals(BudgetWidgetProvider.OVER, BudgetWidgetProvider.accent(over = true, pct = 140))
    // even when the percentage looks safe — `over` is the source of truth
    assertEquals(BudgetWidgetProvider.OVER, BudgetWidgetProvider.accent(over = true, pct = 10))
  }

  @Test
  fun close_to_the_cap_warns_without_saying_over() {
    assertEquals(BudgetWidgetProvider.CLOSE, BudgetWidgetProvider.accent(over = false, pct = 81))
    assertEquals(BudgetWidgetProvider.CLOSE, BudgetWidgetProvider.accent(over = false, pct = 99))
    assertEquals(BudgetWidgetProvider.CLOSE, BudgetWidgetProvider.accent(over = false, pct = 100))
  }

  @Test
  fun an_ordinary_month_is_the_flower() {
    for (pct in listOf(0, 1, 50, 80)) {
      val got = BudgetWidgetProvider.accent(over = false, pct = pct)
      assertEquals(BudgetWidgetProvider.FINE.toLong(), got.toLong())
    }
  }

  @Test
  fun the_three_states_are_actually_three_colours() {
    val trio = setOf(
      BudgetWidgetProvider.OVER,
      BudgetWidgetProvider.CLOSE,
      BudgetWidgetProvider.FINE,
    )
    // two branches shared a colour once; they must not again
    assertEquals(3, trio.size)
  }

  @Test
  fun no_budget_reads_as_a_dash_not_as_zero() {
    assertEquals("—", BudgetWidgetProvider.percentageLabel(hasBudget = false, pct = 0))
    assertEquals("—", BudgetWidgetProvider.percentageLabel(hasBudget = false, pct = 55))
    assertEquals("0%", BudgetWidgetProvider.percentageLabel(hasBudget = true, pct = 0))
    assertEquals("55%", BudgetWidgetProvider.percentageLabel(hasBudget = true, pct = 55))
  }
}
