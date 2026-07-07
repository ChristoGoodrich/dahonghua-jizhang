import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTheme } from '@/theme/ThemeContext';
import type { TrendPoint } from '@/domain/trends';
import type { Lang } from '@/i18n';
import { RAD, TABULAR, shadow } from '@/theme/tokens';

interface Props {
  data: TrendPoint[];
  lang: Lang;
  type?: 'exp' | 'inc' | 'both';
}

const CHART_WIDTH = Dimensions.get('window').width - 44; // match content padding

export function TrendChart({ data, lang, type = 'both' }: Props) {
  const t = useTheme();

  if (data.length === 0) return null;

  const labels = data.map((p) => {
    const d = new Date(p.date);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const datasets: { data: number[]; color: () => string; strokeWidth: number }[] = [];

  if (type === 'exp' || type === 'both') {
    datasets.push({
      data: data.map((p) => p.exp),
      color: () => t.hibiscus,
      strokeWidth: 2,
    });
  }

  if (type === 'inc' || type === 'both') {
    datasets.push({
      data: data.map((p) => p.inc),
      color: () => t.leafDeep,
      strokeWidth: 2,
    });
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
      <LineChart
        data={{
          labels,
          datasets,
        }}
        width={CHART_WIDTH}
        height={180}
        bezier
        withInnerLines={false}
        withOuterLines={false}
        withVerticalLabels
        withHorizontalLabels
        fromZero
        chartConfig={{
          backgroundColor: t.card,
          backgroundGradientFrom: t.card,
          backgroundGradientTo: t.card,
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(0,0,0,${opacity})`,
          labelColor: () => t.inkSoft,
          propsForLabels: { fontSize: 10 },
          propsForDots: { r: '3' },
        }}
        style={styles.chart}
      />
      {type === 'both' && (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDash, { backgroundColor: t.hibiscus }]} />
            <Text style={[styles.legendText, { color: t.inkSoft }]}>
              {lang === 'zh' ? '支出' : 'Expense'}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDash, { backgroundColor: t.leafDeep }]} />
            <Text style={[styles.legendText, { color: t.inkSoft }]}>
              {lang === 'zh' ? '收入' : 'Income'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RAD.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 4,
  },
  chart: { marginLeft: -14 },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDash: { width: 14, height: 3, borderRadius: 3 },
  legendText: { fontSize: 11.5, ...TABULAR },
});
