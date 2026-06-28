import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { fmtShort } from '@/domain/money';
import { I18N, type Lang } from '@/i18n';

interface Props {
  exp: number;
  budget: number;
  lang: Lang;
}

export function BudgetPot({ exp, budget, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  if (!budget || budget <= 0) return null;

  const pct = Math.min((exp / budget) * 100, 100);
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
    <View style={[styles.box, { backgroundColor: t.card }]}>
      <Flower size={54} petal={petal} stamen={stamen} />
      <View style={styles.mid}>
        <Text style={[styles.title, { color: t.ink }]}>
          {s.budgetTitle} <Text style={{ color: t.inkSoft }}>· {fmtShort(budget, lang)}</Text>
        </Text>
        <View style={[styles.track, { backgroundColor: t.line }]}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fill }]} />
        </View>
        <Text style={[styles.sub, { color: t.inkSoft }]}>
          {left >= 0
            ? s.budgetSpentLeft.replace('%s', fmtShort(exp, lang)).replace('%s', fmtShort(left, lang))
            : s.budgetOver.replace('%s', fmtShort(-left, lang))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 22, marginTop: 12, borderRadius: 16, padding: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  mid: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: '700' },
  track: { height: 8, borderRadius: 8, overflow: 'hidden', marginVertical: 6 },
  fill: { height: '100%', borderRadius: 8 },
  sub: { fontSize: 11 },
});
