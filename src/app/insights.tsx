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
import { I18N, type Strings } from '@/i18n';

const TREND_ICON: Record<Trend, string> = { increasing: '↑', decreasing: '↓', stable: '→' };
const TREND_COLOR_KEY: Record<Trend, 'hibiscus' | 'leaf' | 'inkSoft'> = {
  increasing: 'hibiscus',
  decreasing: 'leaf',
  stable: 'inkSoft',
};

function trendLabel(s: Strings, trend: Trend): string {
  if (trend === 'increasing') return s.insTrendInc;
  if (trend === 'decreasing') return s.insTrendDec;
  return s.insTrendStable;
}

export default observer(function InsightsScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const data = store$.data.get();
  const customCats = store$.customCats.get();
  const cycleStart = store$.settings.cycleStart.get() || 1;

  const forecast = useMemo(
    () => forecastMonthlyExpense(data, cycleStart),
    [data, cycleStart],
  );

  const tips = useMemo(() => {
    const arr: string[] = [];
    if (forecast.trend === 'increasing') { arr.push(s.insTipInc1, s.insTipInc2); }
    else if (forecast.trend === 'decreasing') { arr.push(s.insTipDec1, s.insTipDec2); }
    else { arr.push(s.insTipStable1, s.insTipStable2); }
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
        <ScreenHeader title={s.insightsTitle} subtitle={s.insightsSub} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {!hasData ? (
            <View style={[styles.emptyCard, { backgroundColor: t.paperWarm }]}>
              <Text style={[styles.emptyText, { color: t.inkSoft }]}>{s.insNoData}</Text>
            </View>
          ) : (
            <>
              {/* Forecast card */}
              <View style={[styles.forecastCard, { backgroundColor: t.paperWarm }, shadow(t, 'sm')]}>
                <Text style={[styles.forecastLabel, { color: t.inkSoft }]}>{s.insForecastTitle}</Text>
                <Text style={[styles.forecastAmount, { color: t.hibiscus }]}>
                  {fmt(forecast.predicted, lang)}
                </Text>
                <Text style={[styles.forecastSub, { color: t.inkSoft }]}>{s.insForecastSub}</Text>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: t.inkSoft }]}>{s.insTrendLabel}</Text>
                    <TrendBadge />
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaLabel, { color: t.inkSoft }]}>{s.insConfidence}</Text>
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
                  <Text style={[styles.sectionTitle, { color: t.hibiscus }]}>{s.insBreakdown}</Text>
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
              <Text style={[styles.sectionTitle, { color: t.hibiscus }]}>{s.insTips}</Text>
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
