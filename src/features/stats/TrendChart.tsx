import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import type { TrendPoint } from '@/domain/trends';
import type { Lang } from '@/i18n';
import { RAD, TABULAR, shadow } from '@/theme/tokens';

interface Props {
  data: TrendPoint[];
  lang: Lang;
  type?: 'exp' | 'inc' | 'both';
}

// Hand-rolled dual polyline in the app's own chart voice (same pattern as the
// month-comparison chart): viewBox + width:100% keeps it responsive with no
// Dimensions/onLayout measuring, and no chart library.
const W = 300;
const H = 96;
const PAD = 7;

export function TrendChart({ data, lang, type = 'both' }: Props) {
  const t = useTheme();

  if (data.length === 0) return null;

  const showExp = type === 'exp' || type === 'both';
  const showInc = type === 'inc' || type === 'both';
  const exp = data.map((p) => p.exp);
  const inc = data.map((p) => p.inc);
  const max = Math.max(...(showExp ? exp : []), ...(showInc ? inc : []), 1);

  const xOf = (i: number) => PAD + (i / Math.max(1, data.length - 1)) * (W - 2 * PAD);
  const yOf = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const pts = (arr: number[]) => arr.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');

  const labels = data.map((p) => {
    const d = new Date(p.date);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        {showInc && <Polyline points={pts(inc)} fill="none" stroke={t.leafDeep} strokeWidth={2.2} strokeLinejoin="round" />}
        {showExp && <Polyline points={pts(exp)} fill="none" stroke={t.hibiscus} strokeWidth={2.2} strokeLinejoin="round" />}
        {showInc && inc.map((v, i) => <Circle key={`i${i}`} cx={xOf(i)} cy={yOf(v)} r={2.6} fill={t.leafDeep} />)}
        {showExp && exp.map((v, i) => <Circle key={`e${i}`} cx={xOf(i)} cy={yOf(v)} r={2.6} fill={t.hibiscus} />)}
      </Svg>
      <View style={styles.labels}>
        {labels.map((l, i) => (
          <Text key={i} style={[styles.labelText, TABULAR, { color: t.inkSoft }]}>{l}</Text>
        ))}
      </View>
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
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  labelText: { fontSize: 10 },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDash: { width: 14, height: 3, borderRadius: 3 },
  legendText: { fontSize: 11.5, ...TABULAR },
});
