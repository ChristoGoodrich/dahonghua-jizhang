import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtShort } from '@/domain/money';
import { byCategory, statTotals, sixMonthTrend, comparison } from '@/domain/stats';
import type { Category, Entry, IO } from '@/domain/types';
import { I18N, type Lang } from '@/i18n';

interface Props {
  cycleEntries: Entry[];
  all: Entry[];
  anchor: Date;
  cycleStart: number;
  customCats: Record<IO, Category[]>;
  lang: Lang;
}

function Bar({ label, color, pct, value }: { label: React.ReactNode; color: string; pct: number; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.bar}>
      <View style={styles.barLab}>{label}</View>
      <View style={[styles.barTrack, { backgroundColor: t.line }]}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.barVal, { color: t.inkSoft }]}>{value}</Text>
    </View>
  );
}

export function StatsView({ cycleEntries, all, anchor, cycleStart, customCats, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];

  const totals = useMemo(() => statTotals(cycleEntries, anchor, cycleStart), [cycleEntries, anchor, cycleStart]);
  const cats = useMemo(() => byCategory(cycleEntries), [cycleEntries]);
  const catTotal = cats.reduce((a, c) => a + c.amt, 0);
  const trend = useMemo(() => sixMonthTrend(all, anchor, cycleStart), [all, anchor, cycleStart]);
  const trendMax = Math.max(...trend.map((m) => m.total), 1);
  const cmp = useMemo(() => comparison(all, anchor, cycleStart), [all, anchor, cycleStart]);

  let head = '';
  if (cmp.lastTotal > 0) {
    const diff = cmp.thisTotal - cmp.lastTotal;
    if (Math.abs(diff) / cmp.lastTotal < 0.05) head = s.cmpSame;
    else if (diff > 0) head = s.cmpUp.replace('%s', fmtShort(diff, lang));
    else head = s.cmpDown.replace('%s', fmtShort(-diff, lang));
  }

  // comparison line chart geometry
  const W = 300, H = 120, pad = 6;
  const mx = Math.max(...cmp.thisCum, ...cmp.lastCum, 1);
  const pts = (arr: number[]) =>
    arr
      .map((v, i) => {
        const x = pad + (i / Math.max(1, cmp.elapsedDays - 1)) * (W - 2 * pad);
        const y = H - pad - (v / mx) * (H - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const tile = (label: string, value: string) => (
    <View style={[styles.stat, { backgroundColor: t.card }]}>
      <Text style={[styles.statL, { color: t.inkSoft }]}>{label}</Text>
      <Text style={[styles.statV, { color: t.ink }]}>{value}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.statGrid}>
        {tile(s.stToday, fmt(totals.todayExp, lang))}
        {tile(s.stAvg, fmt(totals.avg, lang))}
        {tile(s.stTop, fmt(totals.top, lang))}
        {tile(s.stCount, String(totals.count))}
      </View>

      <Text style={[styles.h3, { color: t.inkSoft }]}>{s.byCat}</Text>
      {cats.length === 0 ? (
        <Text style={[styles.emptyMini, { color: t.inkSoft }]}>{s.empty}</Text>
      ) : (
        cats.map((c) => {
          const cat = catOf('exp', c.cat, customCats);
          return (
            <Bar
              key={c.cat}
              color={cat.c}
              pct={catTotal ? (c.amt / catTotal) * 100 : 0}
              value={fmt(c.amt, lang).slice(1)}
              label={
                <Text style={[styles.barLabText, { color: t.ink }]} numberOfLines={1}>
                  {cat.e} {catName(cat, lang)}
                </Text>
              }
            />
          );
        })
      )}

      <Text style={[styles.h3, { color: t.inkSoft }]}>{s.trend}</Text>
      {trend.map((m, i) => (
        <Bar
          key={i}
          color={t.hibiscus}
          pct={(m.total / trendMax) * 100}
          value={fmt(m.total, lang).slice(1)}
          label={
            <Text style={[styles.barLabText, { color: t.ink, width: 46 }]}>
              {m.label.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' })}
            </Text>
          }
        />
      ))}

      <Text style={[styles.h3, { color: t.inkSoft }]}>{s.cmpTitle}</Text>
      {!!head && <Text style={[styles.cmpHead, { color: t.hibiscusDeep }]}>{head}</Text>}
      <View style={[styles.chartCard, { backgroundColor: t.card }]}>
        <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
          <Polyline points={pts(cmp.lastCum)} fill="none" stroke={t.line} strokeWidth={2.5} />
          <Polyline points={pts(cmp.thisCum)} fill="none" stroke={t.hibiscus} strokeWidth={2.5} />
        </Svg>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDash, { backgroundColor: t.hibiscus }]} />
            <Text style={[styles.legendText, { color: t.inkSoft }]}>{s.cmpThis} {fmtShort(cmp.thisTotal, lang)}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDash, { backgroundColor: t.line }]} />
            <Text style={[styles.legendText, { color: t.inkSoft }]}>{s.cmpLast} {fmtShort(cmp.lastTotal, lang)}</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 140 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '47%', flexGrow: 1, borderRadius: 13, padding: 13, paddingHorizontal: 14 },
  statL: { fontSize: 11 },
  statV: { fontSize: 21, fontWeight: '700', marginTop: 3 },
  h3: { fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 10, marginHorizontal: 2 },
  emptyMini: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 11 },
  barLab: { width: 74, flexShrink: 0 },
  barLabText: { fontSize: 12.5 },
  barTrack: { flex: 1, height: 9, borderRadius: 9, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 9 },
  barVal: { fontSize: 12, width: 64, textAlign: 'right' },
  cmpHead: { fontSize: 12.5, fontWeight: '600', marginHorizontal: 2, marginBottom: 10, marginTop: -2 },
  chartCard: { borderRadius: 14, padding: 14 },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDash: { width: 14, height: 3, borderRadius: 3 },
  legendText: { fontSize: 11.5 },
});
