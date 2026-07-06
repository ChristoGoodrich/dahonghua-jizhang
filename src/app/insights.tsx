import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { forecastMonthlyExpense, type Trend } from '@/ai/forecast';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtShort } from '@/domain/money';
import { RAD, shadow } from '@/theme/tokens';
import type { Lang } from '@/i18n';

const LABELS: Record<Lang, {
  title: string; sub: string;
  forecastTitle: string; forecastSub: string;
  trendLabel: string; confidenceLabel: string;
  breakdownTitle: string;
  tipsTitle: string;
  trendInc: string; trendDec: string; trendStable: string;
  noData: string;
  tipInc1: string; tipInc2: string;
  tipDec1: string; tipDec2: string;
  tipStable1: string; tipStable2: string;
}> = {
  zh: {
    title: 'AI 智能洞察', sub: '基于历史数据的支出预测',
    forecastTitle: '下月预测支出', forecastSub: '根据近 3 个周期的花销趋势',
    trendLabel: '趋势', confidenceLabel: '置信度',
    breakdownTitle: '分类预测',
    tipsTitle: '智能建议',
    trendInc: '上升 ↑', trendDec: '下降 ↓', trendStable: '持平 →',
    noData: '还没有足够的历史数据，多记几笔吧 🌱',
    tipInc1: '支出有上升趋势，建议检查大额分类是否有压缩空间',
    tipInc2: '试试设置分类预算，控制重点分类的花销',
    tipDec1: '支出在下降，继续保持好习惯 🌺',
    tipDec2: '可以把省下来的部分存入储蓄目标',
    tipStable1: '花销保持稳定，适合设定固定预算',
    tipStable2: '回顾分类明细，看看有没有可以优化的地方',
  },
  en: {
    title: 'AI Insights', sub: 'Expense forecast based on history',
    forecastTitle: 'Next Month Forecast', forecastSub: 'Based on last 3 billing cycles',
    trendLabel: 'Trend', confidenceLabel: 'Confidence',
    breakdownTitle: 'Category Forecast',
    tipsTitle: 'Smart Tips',
    trendInc: 'Increasing ↑', trendDec: 'Decreasing ↓', trendStable: 'Stable →',
    noData: 'Not enough history yet — keep logging 🌱',
    tipInc1: 'Expenses are trending up — review large categories for savings',
    tipInc2: 'Try setting per-category budgets to cap key areas',
    tipDec1: 'Expenses are decreasing — keep up the good habits 🌺',
    tipDec2: 'Consider putting savings toward a goal',
    tipStable1: 'Spending is stable — great time for a fixed budget',
    tipStable2: 'Review category details for optimization opportunities',
  },
};

const TREND_ICON: Record<Trend, string> = { increasing: '↑', decreasing: '↓', stable: '→' };
const TREND_COLOR_KEY: Record<Trend, 'hibiscus' | 'leaf' | 'inkSoft'> = {
  increasing: 'hibiscus',
  decreasing: 'leaf',
  stable: 'inkSoft',
};

function trendLabel(s: typeof LABELS['zh'], trend: Trend): string {
  if (trend === 'increasing') return s.trendInc;
  if (trend === 'decreasing') return s.trendDec;
  return s.trendStable;
}

export default observer(function InsightsScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = LABELS[lang];
  const data = store$.data.get();
  const customCats = store$.customCats.get();
  const cycleStart = store$.settings.cycleStart.get() || 1;

  const forecast = useMemo(
    () => forecastMonthlyExpense(data, cycleStart),
    [data, cycleStart],
  );

  const tips = useMemo(() => {
    const arr: string[] = [];
    if (forecast.trend === 'increasing') { arr.push(s.tipInc1, s.tipInc2); }
    else if (forecast.trend === 'decreasing') { arr.push(s.tipDec1, s.tipDec2); }
    else { arr.push(s.tipStable1, s.tipStable2); }
    return arr;
  }, [forecast.trend, s]);

  const hasData = forecast.confidence > 0;

  const TrendBadge = () => {
    const colorKey = TREND_COLOR_KEY[forecast.trend];
    return (
      <View style={[styles.badge, { backgroundColor: t[colorKey] + '1A', borderColor: t[colorKey] + '33' }]}>
        <Text style={[styles.badgeText, { color: t[colorKey] }]}>
          {TREND_ICON[forecast.trend]} {trendLabel(s, forecast.trend)}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.title} subtitle={s.sub} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {!hasData ? (
            <View style={[styles.emptyCard, { backgroundColor: t.paperWarm }]}>
              <Text style={[styles.emptyText, { color: t.inkSoft }]}>{s.noData}</Text>
            </View>
          ) : (
            <>
              {/* Forecast card */}
              <View style={[styles.forecastCard, { backgroundColor: t.paperWarm }, shadow(t, 'sm')]}>
                <Text style={[styles.forecastLabel, { color: t.inkSoft }]}>{s.forecastTitle}</Text>
                <Text style={[styles.forecastAmount, { color: t.hibiscus }]}>
                  {fmt(forecast.predicted, lang)}
                </Text>
                <Text style={[styles.forecastSub, { color: t.inkSoft }]}>{s.forecastSub}</Text>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: t.inkSoft }]}>{s.trendLabel}</Text>
                    <TrendBadge />
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: t.inkSoft }]}>{s.confidenceLabel}</Text>
                    <View style={[styles.confBar, { backgroundColor: t.line }]}>
                      <View
                        style={[
                          styles.confFill,
                          { width: `${Math.round(forecast.confidence * 100)}%`, backgroundColor: t.hibiscus },
                        ]}
                      />
                    </View>
                    <Text style={[styles.confText, { color: t.ink }]}>
                      {Math.round(forecast.confidence * 100)}%
                    </Text>
                  </View>
                </View>
              </View>

              {/* Category breakdown */}
              {forecast.breakdown.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { color: t.hibiscus }]}>{s.breakdownTitle}</Text>
                  <View style={[styles.section, shadow(t, 'xs')]}>
                    {forecast.breakdown.map((b, i) => {
                      const cat = catOf('exp', b.cat, customCats);
                      const pct = forecast.predicted > 0 ? Math.round((b.predicted / forecast.predicted) * 100) : 0;
                      return (
                        <View key={b.cat} style={[styles.catRow, i < forecast.breakdown.length - 1 && { borderBottomColor: t.line }]}>
                          <View style={styles.catLeft}>
                            <Text style={styles.catEmoji}>{cat.e}</Text>
                            <Text style={[styles.catName, { color: t.ink }]}>{catName(cat, lang)}</Text>
                          </View>
                          <View style={styles.catRight}>
                            <View style={[styles.catBarBg, { backgroundColor: t.line }]}>
                              <View style={[styles.catBarFill, { width: `${pct}%`, backgroundColor: cat.c || t.hibiscus }]} />
                            </View>
                            <Text style={[styles.catAmt, { color: t.ink }]}>{fmtShort(b.predicted, lang)}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Smart tips */}
              <Text style={[styles.sectionTitle, { color: t.hibiscus }]}>{s.tipsTitle}</Text>
              <View style={[styles.tipsCard, { backgroundColor: t.paperWarm }, shadow(t, 'xs')]}>
                {tips.map((tip, i) => (
                  <View key={i} style={styles.tipRow}>
                    <Icon name="sparkle" color={t.hibiscus} size={14} />
                    <Text style={[styles.tipText, { color: t.ink }]}>{tip}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 60, paddingTop: 6 },
  emptyCard: { borderRadius: RAD.lg, padding: 32, alignItems: 'center', marginTop: 40 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  forecastCard: { borderRadius: RAD.lg, padding: 24, marginBottom: 18 },
  forecastLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  forecastAmount: { fontSize: 36, fontWeight: '800', marginTop: 6, fontVariant: ['tabular-nums'] },
  forecastSub: { fontSize: 11, marginTop: 4 },
  metaRow: { flexDirection: 'row', marginTop: 18, gap: 24 },
  metaItem: { flex: 1 },
  metaLabel: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, paddingVertical: 4, paddingHorizontal: 10 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  confBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  confFill: { height: 6, borderRadius: 3 },
  confText: { fontSize: 12, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  sectionTitle: { fontSize: 14, fontWeight: '700', marginTop: 16, marginBottom: 8, letterSpacing: 0.5 },
  section: { borderRadius: RAD.lg, overflow: 'hidden', backgroundColor: 'transparent' },
  catRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  catLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catEmoji: { fontSize: 16 },
  catName: { fontSize: 13.5, fontWeight: '600' },
  catRight: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'flex-end' },
  catBarBg: { width: 60, height: 5, borderRadius: 3, overflow: 'hidden' },
  catBarFill: { height: 5, borderRadius: 3 },
  catAmt: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 60, textAlign: 'right' },
  tipsCard: { borderRadius: RAD.lg, padding: 16, gap: 12 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipText: { fontSize: 13, lineHeight: 19, flex: 1 },
});
