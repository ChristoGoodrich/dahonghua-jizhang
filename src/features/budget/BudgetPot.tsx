import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
import { fmtShort } from '@/domain/money';
import { I18N, type Lang } from '@/i18n';
import { BudgetProgress } from './BudgetProgress';

interface Props {
  exp: number;
  budget: number;
  lang: Lang;
  dailyBudget?: number;
  dailyUsed?: number;
  budgetMode?: 'monthly' | 'weekly';
  weeklyBudget?: number;
  weeklySpent?: number;
  /** Tapping the card opens the budget screen (progress detail + forecast live there). */
  onPress?: () => void;
}

export function BudgetPot({ exp, budget, lang, dailyBudget = 0, dailyUsed = 0, budgetMode, weeklyBudget = 0, weeklySpent = 0, onPress }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const hasWeekly = budgetMode === 'weekly' && weeklyBudget > 0;
  const hasMonthly = !hasWeekly && budget > 0;
  const hasDaily = dailyBudget > 0;
  if (!hasMonthly && !hasDaily && !hasWeekly) return null;
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

  // one line for the month, one for today — the deeper numbers (forecast,
  // per-category) live on the budget screen this card links to
  return (
    <Tap
      onPress={onPress}
      disabled={!onPress}
      scaleTo={0.985}
      style={[styles.box, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={s.budgetTitle}
    >
      <Flower size={44} petal={petal} stamen={stamen} />
      <View style={styles.mid}>
        {hasMonthly && (
          <>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: t.ink }]}>
                {s.budgetTitle} <Text style={[TABULAR, { color: t.inkSoft }]}>· {fmtShort(budget, lang)}</Text>
              </Text>
              <Text style={[styles.sub, TABULAR, { color: left >= 0 ? t.inkSoft : t.hibiscusDeep }]} numberOfLines={1}>
                {left >= 0
                  ? s.budgetSpentLeft.replace('%s', fmtShort(exp, lang)).replace('%s', fmtShort(left, lang))
                  : s.budgetOver.replace('%s', fmtShort(-left, lang))}
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: t.isDark ? t.line : t.paperWarm }]}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fill }]} />
            </View>
          </>
        )}
        {hasWeekly && (
          <BudgetProgress label={s.budgetWeeklyLabel} spent={weeklySpent} total={weeklyBudget} lang={lang} />
        )}
        {hasDaily && (
          <Text style={[hasMonthly || hasWeekly ? styles.daily : styles.title, TABULAR, { color: dailyOver ? t.hibiscusDeep : hasMonthly || hasWeekly ? t.inkSoft : t.ink }]}>
            {s.budgetDailyLabel} · {dailyOver
              ? s.budgetDailyOver.replace('%s', fmtShort(-dailyLeft, lang))
              : s.budgetDailyLeft.replace('%s', fmtShort(dailyLeft, lang))}
          </Text>
        )}
      </View>
      {!!onPress && <Icon name="chevR" color={t.inkSoft} size={15} strokeWidth={2} />}
    </Tap>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: 22, marginTop: 12, borderRadius: RAD.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  mid: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 13, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 7 },
  fill: { height: '100%', borderRadius: 4 },
  sub: { fontSize: 11, flexShrink: 1 },
  daily: { fontSize: 11, marginTop: 5, fontWeight: '600' },
});
