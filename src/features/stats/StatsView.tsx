import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { Chip } from '@/components/ui/Chip';
import { Tap } from '@/components/ui/Tap';
import { RAD, TABULAR, LABEL_TRACKED, shadow } from '@/theme/tokens';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtShort, fmtNum } from '@/domain/money';
import { byCategory, overview, comparison, topEntries, byWeekday } from '@/domain/stats';
import { CategoryDonut } from './CategoryDonut';
import { TrendChart } from './TrendChart';
import { dailyTrend } from '@/domain/trends';
import { PERIODS, periodRange, shiftPeriod, periodLabel, periodTrend, bucketLabel, entriesInPeriod, type Period } from '@/domain/period';
import type { Category, Entry, IO } from '@/domain/types';
import { I18N, type Lang } from '@/i18n';

interface Props {
  all: Entry[];
  anchor: Date;
  cycleStart: number;
  customCats: Record<IO, Category[]>;
  lang: Lang;
  onEntryPress?: (id: string) => void; // open the read-only detail view
}

function Bar({ label, color, pct, value }: { label: React.ReactNode; color: string; pct: number; value: string }) {
  const t = useTheme();
  // springs from zero on mount and follows period/io switches
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(w, { toValue: pct, friction: 8, tension: 140, useNativeDriver: false }).start();
  }, [pct, w]);
  return (
    <View style={styles.bar}>
      <View style={styles.barLab}>{label}</View>
      <View style={[styles.barTrack, { backgroundColor: t.line }]}>
        <Animated.View
          style={[
            styles.barFill,
            {
              width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'], extrapolate: 'clamp' }),
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <Text style={[styles.barVal, { color: t.inkSoft }]}>{value}</Text>
    </View>
  );
}

export function StatsView({ all, anchor, cycleStart, customCats, lang, onEntryPress }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const loc = lang === 'zh' ? 'zh-CN' : 'en-US';
  // short weekday names by locale; 2023-01-01 was a Sunday, so +dow lands on each day
  const wdLabel = (dow: number) => new Date(2023, 0, 1 + dow).toLocaleDateString(loc, { weekday: 'short' });

  const [period, setPeriod] = useState<Period>('month');
  const [pAnchor, setPAnchor] = useState<Date>(anchor);
  const [io, setIo] = useState<IO>('exp');

  const periodLabels: Record<Period, string> = { day: s.pDay, week: s.pWeek, month: s.pMonth, halfyear: s.pHalf, year: s.pYear };
  const label = periodLabel(pAnchor, period, lang, cycleStart);
  const isFuture = useMemo(() => periodRange(pAnchor, period, cycleStart).end.getTime() > Date.now(), [pAnchor, period, cycleStart]);

  const rangeEntries = useMemo(() => entriesInPeriod(all, pAnchor, period, cycleStart), [all, pAnchor, period, cycleStart]);
  const ov = useMemo(() => overview(rangeEntries), [rangeEntries]);
  const cats = useMemo(() => byCategory(rangeEntries, io), [rangeEntries, io]);
  const catTotal = cats.reduce((a, c) => a + c.amt, 0);
  const trend = useMemo(() => periodTrend(all, pAnchor, period, cycleStart, io), [all, pAnchor, period, cycleStart, io]);
  const trendMax = Math.max(...trend.map((m) => m.total), 1);
  const trendColor = io === 'exp' ? t.hibiscus : t.leafDeep;

  const top = useMemo(() => topEntries(rangeEntries, io, 5), [rangeEntries, io]);
  const weekday = useMemo(() => byWeekday(rangeEntries, io), [rangeEntries, io]);
  const wdMax = Math.max(...weekday.map((x) => x.amt), 1);
  const wdHasData = weekday.some((x) => x.count > 0);
  const trendData = useMemo(() => dailyTrend(all, 7), [all]);

  // month-only: cumulative this-vs-last comparison
  const cmp = useMemo(() => (period === 'month' ? comparison(all, pAnchor, cycleStart) : null), [period, all, pAnchor, cycleStart]);
  let head = '';
  if (cmp && cmp.lastTotal > 0) {
    const diff = cmp.thisTotal - cmp.lastTotal;
    if (Math.abs(diff) / cmp.lastTotal < 0.05) head = s.cmpSame;
    else if (diff > 0) head = s.cmpUp.replace('%s', fmtShort(diff, lang));
    else head = s.cmpDown.replace('%s', fmtShort(-diff, lang));
  }
  const W = 300, H = 120, pad = 6;
  const mx = cmp ? Math.max(...cmp.thisCum, ...cmp.lastCum, 1) : 1;
  const pts = (arr: number[]) =>
    arr
      .map((v, i) => {
        const x = pad + (i / Math.max(1, (cmp?.elapsedDays ?? 1) - 1)) * (W - 2 * pad);
        const y = H - pad - (v / mx) * (H - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const tile = (lab: string, value: string, color?: string) => (
    <View style={[styles.stat, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
      <Text style={[styles.statL, { color: t.inkSoft }]}>{lab}</Text>
      <Text style={[styles.statV, TABULAR, { color: color ?? t.ink }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowInner}>
        {PERIODS.map((p) => (
          <Chip key={p} label={periodLabels[p]} on={p === period} size="md" onPress={() => setPeriod(p)} />
        ))}
      </ScrollView>

      <View style={styles.nav}>
        <Tap onPress={() => setPAnchor((a) => shiftPeriod(a, period, -1, cycleStart))} hitSlop={10} scaleTo={0.85} style={styles.navBtn}>
          <Text style={[styles.navArrow, { color: t.hibiscus }]}>‹</Text>
        </Tap>
        <Text style={[styles.navLabel, { color: t.ink }]}>{label}</Text>
        <Tap onPress={() => !isFuture && setPAnchor((a) => shiftPeriod(a, period, 1, cycleStart))} hitSlop={10} scaleTo={0.85} style={styles.navBtn}>
          <Text style={[styles.navArrow, { color: isFuture ? t.line : t.hibiscus }]}>›</Text>
        </Tap>
      </View>

      <View style={styles.statGrid}>
        {tile(s.ovExp, fmt(ov.exp, lang), t.hibiscusDeep)}
        {tile(s.ovInc, fmt(ov.inc, lang), t.leafDeep)}
        {tile(s.ovBalance, fmt(ov.balance, lang))}
        {tile(s.ovCount, String(ov.count))}
      </View>

      <TrendChart data={trendData} lang={lang} type="both" />

      <View style={styles.ioRow}>
        {(['exp', 'inc'] as IO[]).map((k) => (
          <Chip key={k} label={k === 'exp' ? s.ovExp : s.ovInc} on={k === io} onPress={() => setIo(k)} />
        ))}
      </View>

      <Text style={[styles.h3, { color: t.inkSoft }]}>{s.byCat}</Text>
      {cats.length === 0 ? (
        <Text style={[styles.emptyMini, { color: t.inkSoft }]}>{s.empty}</Text>
      ) : (
        <>
        <CategoryDonut cats={cats} total={catTotal} io={io} customCats={customCats} lang={lang} centerLabel={io === 'exp' ? s.ovExp : s.ovInc} />
        {cats.map((c) => {
          const cat = catOf(io, c.cat, customCats);
          return (
            <Bar
              key={c.cat}
              color={cat.c}
              pct={catTotal ? (c.amt / catTotal) * 100 : 0}
              value={fmtNum(c.amt)}
              label={
                <Text style={[styles.barLabText, { color: t.ink }]} numberOfLines={1}>
                  {cat.e} {catName(cat, lang)}
                </Text>
              }
            />
          );
        })}
        </>
      )}

      <Text style={[styles.h3, { color: t.inkSoft }]}>{s.trendGeneric}</Text>
      {trend.map((m, i) => (
        <Bar
          key={i}
          color={trendColor}
          pct={(m.total / trendMax) * 100}
          value={fmtNum(m.total)}
          label={<Text style={[styles.barLabText, { color: t.ink, width: 46 }]}>{bucketLabel(m.start, period, lang)}</Text>}
        />
      ))}

      {io === 'exp' && top.length >= 2 && (
        <>
          <Text style={[styles.h3, { color: t.inkSoft }]}>{s.stTopSpend}</Text>
          {top.map((d) => {
            const cat = catOf(d.io, d.cat, customCats);
            const note = d.note?.trim();
            const row = (
              <>
                <Text style={styles.topEmoji}>{cat.e}</Text>
                <View style={styles.topMid}>
                  <Text style={[styles.topName, { color: t.ink }]} numberOfLines={1}>{note || catName(cat, lang)}</Text>
                  <Text style={[styles.topSub, { color: t.inkSoft }]} numberOfLines={1}>
                    {catName(cat, lang)} · {new Date(d.ts).toLocaleDateString(loc, { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <Text style={[styles.topAmt, { color: t.ink }]}>{fmt(d.amt, lang)}</Text>
              </>
            );
            return onEntryPress ? (
              <Tap key={d.id} onPress={() => onEntryPress(d.id)} scaleTo={0.98} style={styles.topRow}>{row}</Tap>
            ) : (
              <View key={d.id} style={styles.topRow}>{row}</View>
            );
          })}
        </>
      )}

      {wdHasData && (
        <>
          <Text style={[styles.h3, { color: t.inkSoft }]}>{s.stByWeekday}</Text>
          {weekday.map((x) => (
            <Bar
              key={x.dow}
              color={trendColor}
              pct={(x.amt / wdMax) * 100}
              value={fmtNum(x.amt)}
              label={<Text style={[styles.barLabText, { color: t.ink, width: 46 }]}>{wdLabel(x.dow)}</Text>}
            />
          ))}
        </>
      )}

      {cmp && (
        <>
          <Text style={[styles.h3, { color: t.inkSoft }]}>{s.cmpTitle}</Text>
          {!!head && <Text style={[styles.cmpHead, { color: t.hibiscusDeep }]}>{head}</Text>}
          <View style={[styles.chartCard, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
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
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 140 },
  chipRow: { flexGrow: 0, marginBottom: 4 },
  chipRowInner: { gap: 7, paddingVertical: 2 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginVertical: 10 },
  navBtn: { paddingHorizontal: 6 },
  navArrow: { fontSize: 26, fontWeight: '700' },
  navLabel: { fontSize: 15, fontWeight: '700', minWidth: 120, textAlign: 'center' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    width: '47%', flexGrow: 1, borderRadius: RAD.md, borderWidth: StyleSheet.hairlineWidth,
    padding: 13, paddingHorizontal: 15,
  },
  statL: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  statV: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, marginTop: 4 },
  ioRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  h3: { ...LABEL_TRACKED, marginTop: 20, marginBottom: 10, marginHorizontal: 2 },
  emptyMini: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 11 },
  barLab: { width: 74, flexShrink: 0 },
  barLabText: { fontSize: 12.5 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  barVal: { fontSize: 12, width: 64, textAlign: 'right', ...TABULAR },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8 },
  topEmoji: { fontSize: 20, width: 26, textAlign: 'center' },
  topMid: { flex: 1, minWidth: 0 },
  topName: { fontSize: 13.5, fontWeight: '600' },
  topSub: { fontSize: 11, marginTop: 1 },
  topAmt: { fontSize: 13.5, fontWeight: '700', ...TABULAR },
  cmpHead: { fontSize: 12.5, fontWeight: '600', marginHorizontal: 2, marginBottom: 10, marginTop: -2 },
  chartCard: { borderRadius: RAD.md, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDash: { width: 14, height: 3, borderRadius: 3 },
  legendText: { fontSize: 11.5, ...TABULAR },
});
