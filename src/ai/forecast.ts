// Pure expense forecasting with trend detection — no network, fully testable.
import type { Entry } from '@/domain/types';
import { cycleRange, shiftCycle } from '@/domain/cycle';

export type Trend = 'increasing' | 'decreasing' | 'stable';

export interface CategoryForecast {
  cat: string;
  predicted: number;
}

export interface ForecastResult {
  predicted: number;
  confidence: number; // 0..1
  trend: Trend;
  breakdown: CategoryForecast[];
}

/**
 * Forecast next month's expense based on the last 3 cycles of history.
 * Uses simple linear regression over per-cycle totals to predict and detect trend.
 */
export function forecastMonthlyExpense(
  history: Entry[],
  cycleStart = 1,
  anchor = new Date(),
): ForecastResult {
  const empty: ForecastResult = { predicted: 0, confidence: 0, trend: 'stable', breakdown: [] };

  // Collect per-cycle totals (oldest first) for the 3 cycles before the current one.
  const cycleTotals: number[] = [];
  const catTotals = new Map<string, number[]>();

  for (let i = 3; i >= 1; i--) {
    const cycleAnchor = shiftCycle(anchor, -i, cycleStart);
    const { start, end } = cycleRange(cycleAnchor, cycleStart);
    const s = start.getTime();
    const e = end.getTime();

    let total = 0;
    const cycleCatTotals = new Map<string, number>();

    for (const d of history) {
      if (d.io !== 'exp' || d.deletedAt) continue;
      if (d.ts >= s && d.ts < e) {
        total += d.amt;
        cycleCatTotals.set(d.cat, (cycleCatTotals.get(d.cat) ?? 0) + d.amt);
      }
    }

    cycleTotals.push(total);
    for (const [cat, amt] of cycleCatTotals) {
      if (!catTotals.has(cat)) catTotals.set(cat, new Array(3).fill(0));
      catTotals.get(cat)![3 - i] = amt;
    }
  }

  // Need at least one non-zero cycle to predict.
  const hasData = cycleTotals.some((t) => t > 0);
  if (!hasData) return empty;

  // Linear regression: y = a + b*x where x = 0,1,2 for the 3 cycles.
  const n = cycleTotals.length;
  const xs = cycleTotals.map((_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = cycleTotals.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * cycleTotals[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  const b = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;

  // Predict x=3 (next cycle)
  const predicted = Math.max(0, Math.round((a + b * 3) * 100) / 100);

  // Trend detection: slope relative to mean.
  const mean = sumY / n;
  const slopeRatio = mean === 0 ? 0 : Math.abs(b) / mean;
  let trend: Trend = 'stable';
  if (slopeRatio > 0.05) {
    trend = b > 0 ? 'increasing' : 'decreasing';
  }

  // Confidence: based on R² goodness-of-fit.
  const yHat = xs.map((x) => a + b * x);
  const ssRes = cycleTotals.reduce((s, y, i) => s + (y - yHat[i]) ** 2, 0);
  const ssTot = cycleTotals.reduce((s, y) => s + (y - mean) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  const confidence = Math.round(r2 * 100) / 100;

  // Category breakdown: linear regression per category.
  const breakdown: CategoryForecast[] = [];
  for (const [cat, vals] of catTotals) {
    const catSumY = vals.reduce((s, v) => s + v, 0);
    if (catSumY === 0) continue;
    const catSumXY = vals.reduce((s, v, i) => s + i * v, 0);
    const catDenom = n * sumX2 - sumX * sumX;
    const catB = catDenom === 0 ? 0 : (n * catSumXY - sumX * catSumY) / catDenom;
    const catA = (catSumY - catB * sumX) / n;
    const catPredicted = Math.max(0, Math.round((catA + catB * 3) * 100) / 100);
    breakdown.push({ cat, predicted: catPredicted });
  }
  breakdown.sort((a, b) => b.predicted - a.predicted);

  return { predicted, confidence, trend, breakdown };
}
