import React from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, patchSettings, setCatBudget } from '@/store/ledger';
import { allCats, catName } from '@/domain/cats';
import { curSymbol, fmtShort } from '@/domain/money';
import { inCycle } from '@/domain/cycle';
import { monthlyStatus, dailyStatus, type TierStatus } from '@/domain/budget';
import { byCategory } from '@/domain/stats';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';

const num = (v: string) => parseFloat(v.replace(/[^\d.]/g, '')) || 0;

function ProgressBar({ status }: { status: TierStatus }) {
  const t = useTheme();
  if (status.limit <= 0) return null;
  const pct = Math.min(status.pct, 100);
  const fill = status.over ? t.hibiscus : status.pct >= 80 ? t.stamen : t.leaf;
  return (
    <View style={[styles.track, { backgroundColor: t.line }]}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fill }]} />
    </View>
  );
}

export default observer(function BudgetScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const settings = store$.settings.get();
  const customCats = store$.customCats.get();
  const data = store$.data.get();
  const sym = curSymbol(store$.currencies.base.get() || 'CNY');
  const cats = allCats('exp', customCats);
  const cb = settings.catBudgets ?? {};

  // live spend for the current cycle
  const cycleStart = settings.cycleStart || 1;
  const cycleEntries = data.filter((d) => !d.deletedAt && inCycle(d.ts, new Date(), cycleStart));
  const monthly = monthlyStatus(cycleEntries, settings);
  const daily = dailyStatus(cycleEntries, settings);
  const byCat = byCategory(cycleEntries, 'exp');
  const spentOf = (k: string) => byCat.find((x) => x.cat === k)?.amt ?? 0;

  const usageText = (st: TierStatus) =>
    st.limit <= 0
      ? ''
      : st.over
        ? s.budgetOver.replace('%s', fmtShort(st.used - st.limit, lang))
        : s.budgetSpentLeft.replace('%s', fmtShort(st.used, lang)).replace('%s', fmtShort(st.left, lang));

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.budgetScreenTitle} subtitle={s.budgetScreenSub} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.budgetMonthlySec}</Text>
          <View style={[styles.rowCol, { borderBottomColor: t.line }]}>
            <View style={styles.row}>
              <View style={styles.rowMid}>
                <Text style={[styles.rowTitle, { color: t.ink }]}>{s.setBudget}</Text>
                <Text style={[styles.rowDesc, { color: t.inkSoft }]}>{s.setBudgetD}</Text>
              </View>
              <TextInput
                style={[styles.numInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                keyboardType="numeric"
                placeholder={sym + '0'}
                placeholderTextColor={t.inkSoft}
                defaultValue={settings.budget ? String(settings.budget) : ''}
                onEndEditing={(e) => patchSettings({ budget: num(e.nativeEvent.text) })}
              />
            </View>
            <ProgressBar status={monthly} />
            {monthly.limit > 0 && (
              <Text style={[styles.usage, { color: monthly.over ? t.hibiscusDeep : t.inkSoft }]}>{usageText(monthly)}</Text>
            )}
          </View>

          <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.budgetDailySec}</Text>
          <View style={[styles.rowCol, { borderBottomColor: t.line }]}>
            <View style={styles.row}>
              <View style={styles.rowMid}>
                <Text style={[styles.rowTitle, { color: t.ink }]}>{s.budgetDailySec}</Text>
                <Text style={[styles.rowDesc, { color: t.inkSoft }]}>{s.budgetDailyD}</Text>
              </View>
              <TextInput
                style={[styles.numInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                keyboardType="numeric"
                placeholder={sym + '0'}
                placeholderTextColor={t.inkSoft}
                defaultValue={settings.dailyBudget ? String(settings.dailyBudget) : ''}
                onEndEditing={(e) => patchSettings({ dailyBudget: num(e.nativeEvent.text) })}
              />
            </View>
            <ProgressBar status={daily} />
            {daily.limit > 0 && (
              <Text style={[styles.usage, { color: daily.over ? t.hibiscusDeep : t.inkSoft }]}>
                {s.budgetDailyLabel} · {usageText(daily)}
              </Text>
            )}
          </View>

          <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.budgetCatSec}</Text>
          <Text style={[styles.secDesc, { color: t.inkSoft }]}>{s.budgetCatSecD}</Text>
          {cats.map((c) => {
            const limit = cb[c.k] ?? 0;
            const spent = spentOf(c.k);
            const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
            const over = limit > 0 && spent > limit;
            const fill = over ? t.hibiscus : pct >= 80 ? t.stamen : t.leaf;
            return (
              <View key={c.k} style={[styles.rowCol, { borderBottomColor: t.line }]}>
                <View style={styles.row}>
                  <Text style={styles.catEmoji}>{c.e}</Text>
                  <Text style={[styles.catName, { color: t.ink }]} numberOfLines={1}>{catName(c, lang)}</Text>
                  <TextInput
                    style={[styles.numInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                    keyboardType="numeric"
                    placeholder={s.budgetCatHint}
                    placeholderTextColor={t.inkSoft}
                    defaultValue={limit ? String(limit) : ''}
                    onEndEditing={(e) => setCatBudget(c.k, num(e.nativeEvent.text))}
                  />
                </View>
                {limit > 0 && (
                  <>
                    <View style={[styles.track, { backgroundColor: t.line }]}>
                      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fill }]} />
                    </View>
                    <Text style={[styles.usage, { color: over ? t.hibiscusDeep : t.inkSoft }]}>
                      {fmtShort(spent, lang)} / {fmtShort(limit, lang)}
                    </Text>
                  </>
                )}
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 80, paddingTop: 6 },
  sectionHead: { fontSize: 12, fontWeight: '600', marginTop: 18, marginBottom: 4 },
  secDesc: { fontSize: 11.5, marginBottom: 6 },
  rowCol: { paddingVertical: 11, borderBottomWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowMid: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, marginTop: 2 },
  catEmoji: { fontSize: 19, width: 26, textAlign: 'center' },
  catName: { flex: 1, fontSize: 14, fontWeight: '600' },
  numInput: { width: 110, borderWidth: 1, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 10, fontSize: 14, textAlign: 'right' },
  track: { height: 6, borderRadius: 6, overflow: 'hidden', marginTop: 9 },
  fill: { height: '100%', borderRadius: 6 },
  usage: { fontSize: 11, marginTop: 5 },
});
