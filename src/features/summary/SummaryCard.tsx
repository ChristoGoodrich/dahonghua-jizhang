import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { fmt } from '@/domain/money';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';

interface Props {
  exp: number;
  inc: number;
  monthLabel: string;
  lang: Lang;
  onPrev: () => void;
  onNext: () => void;
}

export function SummaryCard({ exp, inc, monthLabel, lang, onPrev, onNext }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  return (
    <View style={styles.wrap}>
      <View style={styles.monthRow}>
        <Text style={[styles.month, { color: t.inkSoft }]}>{monthLabel}</Text>
        <View style={styles.nav}>
          <Pressable onPress={onPrev} hitSlop={10} accessibilityRole="button" accessibilityLabel={s.a11yMonthPrev}>
            <Text style={[styles.navBtn, { color: t.inkSoft }]}>‹</Text>
          </Pressable>
          <Pressable onPress={onNext} hitSlop={10} accessibilityRole="button" accessibilityLabel={s.a11yMonthNext}>
            <Text style={[styles.navBtn, { color: t.inkSoft }]}>›</Text>
          </Pressable>
        </View>
      </View>
      <View style={[styles.card, { backgroundColor: t.ink }]}>
        <View style={styles.bgFlower}>
          <Flower size={108} petal="#ffffff" stamen="#ffffff" />
        </View>
        <Text style={[styles.label, { color: t.paper }]}>{s.net}</Text>
        <Text style={[styles.net, { color: t.paper }]}>{fmt(inc - exp, lang)}</Text>
        <View style={styles.io}>
          <View>
            <Text style={[styles.ioK, { color: t.paper }]}>{s.exp}</Text>
            <Text style={[styles.ioV, { color: t.hibiscusSoft }]}>{fmt(exp, lang)}</Text>
          </View>
          <View>
            <Text style={[styles.ioK, { color: t.paper }]}>{s.inc}</Text>
            <Text style={[styles.ioV, { color: '#9DC4B3' }]}>{fmt(inc, lang)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  month: { fontSize: 13, fontWeight: '600' },
  nav: { marginLeft: 'auto', flexDirection: 'row', gap: 8 },
  navBtn: { fontSize: 20, paddingHorizontal: 6 },
  card: { borderRadius: 18, padding: 20, overflow: 'hidden' },
  bgFlower: { position: 'absolute', right: -14, bottom: -22, opacity: 0.12 },
  label: { fontSize: 11, letterSpacing: 2, opacity: 0.6, textTransform: 'uppercase' },
  net: { fontSize: 34, fontWeight: '700', marginVertical: 4 },
  io: { flexDirection: 'row', gap: 24 },
  ioK: { fontSize: 12, opacity: 0.85 },
  ioV: { fontSize: 16, fontWeight: '600', marginTop: 1 },
});
