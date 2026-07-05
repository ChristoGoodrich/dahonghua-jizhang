import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
import { fmtShort } from '@/domain/money';
import { I18N, type Lang } from '@/i18n';

interface Props {
  exp: number;
  budget: number;
  lang: Lang;
  dailyBudget?: number;
  dailyUsed?: number;
}

export function BudgetPot({ exp, budget, lang, dailyBudget = 0, dailyUsed = 0 }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const hasMonthly = budget > 0;
  const hasDaily = dailyBudget > 0;
  if (!hasMonthly && !hasDaily) return null;
  const dailyLeft = dailyBudget - dailyUsed;
  const dailyOver = dailyLeft < 0;

  const pct = hasMonthly ? Math.min((exp / budget) * 100, 100) : Math.min((dailyUsed / dailyBudget) * 100, 100);
  const left = budget - exp;

  let petal = t.hibiscus;
  let stamen = t.stamen;
  let fill = t.leaf;
  if (pct >= 100) {
    petal = '#B79A86';
    stamen = '#C8B79C';
    fill = '#B79A86';
  } else if (pct >= 80) {
    petal = t.stamen;
    fill = t.stamen;
  }

  return (
    <View style={[styles.box, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
      <Flower size={54} petal={petal} stamen={stamen} />
      <View style={styles.mid}>
        {hasMonthly && (
          <>
            <Text style={[styles.title, { color: t.ink }]}>
              {s.budgetTitle} <Text style={[TABULAR, { color: t.inkSoft }]}>· {fmtShort(budget, lang)}</Text>
            </Text>
            <View style={[styles.track, { backgroundColor: t.isDark ? t.line : t.paperWarm }]}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fill }]} />
            </View>
            <Text style={[styles.sub, TABULAR, { color: t.inkSoft }]}>
              {left >= 0
                ? s.budgetSpentLeft.replace('%s', fmtShort(exp, lang)).replace('%s', fmtShort(left, lang))
                : s.budgetOver.replace('%s', fmtShort(-left, lang))}
            </Text>
          </>
        )}
        {hasDaily && (
          <Text style={[hasMonthly ? styles.daily : styles.title, TABULAR, { color: dailyOver ? t.hibiscusDeep : hasMonthly ? t.inkSoft : t.ink }]}>
            {s.budgetDailyLabel} · {dailyOver
              ? s.budgetDailyOver.replace('%s', fmtShort(-dailyLeft, lang))
              : s.budgetDailyLeft.replace('%s', fmtShort(dailyLeft, lang))}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: 22, marginTop: 12, borderRadius: RAD.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  mid: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginVertical: 7 },
  fill: { height: '100%', borderRadius: 4 },
  sub: { fontSize: 11 },
  daily: { fontSize: 11, marginTop: 4, fontWeight: '600' },
});
