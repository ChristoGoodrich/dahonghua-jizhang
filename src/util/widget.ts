// Android widget bridge — updates the native budget widget via SharedPreferences.
import { NativeModules, Platform } from 'react-native';

const { BudgetWidget } = NativeModules;

/**
 * Update the Android budget widget with current data.
 * Call this after budget changes or entry saves.
 */
export function updateBudgetWidget(spent: number, budget: number, budgetMode: string = 'monthly'): void {
  if (Platform.OS !== 'android' || !BudgetWidget) return;
  BudgetWidget.updateBudget(spent, budget, budgetMode).catch(() => {
    // Silently fail — widget update is non-critical
  });
}
