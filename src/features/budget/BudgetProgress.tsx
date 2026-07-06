import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { fmt } from '@/domain/money';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';
import { RAD } from '@/theme/tokens';

interface Props {
  label: string;
  spent: number;
  total: number;
  lang: Lang;
}

export function BudgetProgress({ label, spent, total, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];

  if (total <= 0) return null;

  const pct = Math.min((spent / total) * 100, 100);
  const remaining = total - spent;
  const over = remaining < 0;

  let fill = t.leaf;
  if (pct >= 100) fill = t.hibiscusDeep;
  else if (pct >= 80) fill = t.stamen;
  else if (pct >= 50) fill = t.stamen;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
      <View style={[styles.track, { backgroundColor: t.isDark ? t.line : t.paperWarm }]}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fill }]} />
      </View>
      <View style={styles.row}>
        <Text style={[styles.text, { color: t.inkSoft }]}>
          {over
            ? s.budgetOver.replace('%s', fmt(-remaining, lang))
            : s.budgetSpentLeft.replace('%s', fmt(spent, lang)).replace('%s', fmt(remaining, lang))}
        </Text>
        <Text style={[styles.text, { color: t.inkSoft }]}>
          {Math.round(pct)}% · {fmt(total, lang)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  text: { fontSize: 10 },
});
