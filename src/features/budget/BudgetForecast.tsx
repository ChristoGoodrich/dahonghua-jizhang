import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { fmt } from '@/domain/money';
import type { Lang } from '@/i18n';

interface Props {
  spent: number;
  budget: number;
  daysElapsed: number;
  daysInCycle: number;
  lang: Lang;
}

export function BudgetForecast({ spent, budget, daysElapsed, daysInCycle, lang }: Props) {
  const t = useTheme();
  if (daysElapsed === 0 || budget === 0) return null;

  const isZh = lang === 'zh';
  const remainingDays = daysInCycle - daysElapsed;
  const dailyRate = spent / daysElapsed;
  const projectedTotal = dailyRate * daysInCycle;
  const projectedOver = projectedTotal - budget;
  const onTrack = projectedOver <= 0;
  const dailyBudgetLeft = remainingDays > 0 ? (budget - spent) / remainingDays : 0;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: t.inkSoft }]}>
          {isZh ? '日均' : 'Daily avg'}
        </Text>
        <Text style={[styles.value, TABULAR, { color: t.ink }]}>
          {fmt(dailyRate, lang)}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: t.inkSoft }]}>
          {isZh ? '月末预计' : 'Month-end'}
        </Text>
        <Text style={[styles.value, TABULAR, { color: onTrack ? t.leaf : t.hibiscusDeep }]}>
          {fmt(projectedTotal, lang)}
        </Text>
      </View>
      {!onTrack && (
        <View style={styles.row}>
          <Text style={[styles.label, { color: t.hibiscusDeep }]}>
            {isZh ? '预计超支' : 'Projected over'}
          </Text>
          <Text style={[styles.value, TABULAR, { color: t.hibiscusDeep }]}>
            {fmt(projectedOver, lang)}
          </Text>
        </View>
      )}
      {remainingDays > 0 && (
        <View style={styles.row}>
          <Text style={[styles.label, { color: t.inkSoft }]}>
            {isZh ? '每天还能花' : 'Daily left'}
          </Text>
          <Text style={[styles.value, TABULAR, { color: dailyBudgetLeft >= 0 ? t.ink : t.hibiscusDeep }]}>
            {dailyBudgetLeft >= 0 ? fmt(dailyBudgetLeft, lang) : fmt(0, lang)}
          </Text>
        </View>
      )}
    </View>
  );
}

const TABULAR = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  container: { marginTop: 8, gap: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 10 },
  value: { fontSize: 10, fontWeight: '600' },
});
