import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { GradientFill } from '@/components/ui/GradientFill';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
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
  const net = inc - exp;
  const flow = inc + exp;
  const expPct = flow > 0 ? (exp / flow) * 100 : 0;
  // the ink card inverts in dark mode (cream surface), so the soft pastels
  // that read on dark ink need to swap to their deep counterparts there
  const expTone = t.isDark ? t.hibiscusDeep : t.hibiscusSoft;
  const incTone = t.isDark ? t.leafDeep : '#9DC4B3';

  const navBtn = (dir: 'chevL' | 'chevR', onPress: () => void, label: string) => (
    <Tap
      onPress={onPress}
      scaleTo={0.88}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.navBtn, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}
    >
      <Icon name={dir} color={t.inkSoft} size={15} strokeWidth={2.2} />
    </Tap>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.monthRow}>
        <Text style={[styles.month, { color: t.ink }]}>{monthLabel}</Text>
        <View style={styles.nav}>
          {navBtn('chevL', onPrev, s.a11yMonthPrev)}
          {navBtn('chevR', onNext, s.a11yMonthNext)}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: t.ink }, shadow(t, 'md')]}>
        {/* diagonal accent wash gives the ink slab depth without breaking contrast;
            gentler on the cream dark-mode surface where red shows much stronger */}
        <GradientFill from={t.gradFrom} to={t.gradTo} direction="diagonal" opacity={t.isDark ? 0.09 : 0.16} />
        <View style={styles.bgFlower}>
          <Flower size={132} petal={t.paper} stamen={t.paper} />
        </View>

        <Text style={[styles.label, { color: t.paper }]}>{s.net}</Text>
        <Text style={[styles.net, TABULAR, { color: net < 0 ? expTone : t.paper }]} numberOfLines={1} adjustsFontSizeToFit>
          {fmt(net, lang)}
        </Text>

        <View style={styles.io}>
          <View style={styles.ioCol}>
            <View style={styles.ioHead}>
              <View style={[styles.dot, { backgroundColor: expTone }]} />
              <Text style={[styles.ioK, { color: t.paper }]}>{s.exp}</Text>
            </View>
            <Text style={[styles.ioV, TABULAR, { color: expTone }]}>{fmt(exp, lang)}</Text>
          </View>
          <View style={styles.ioCol}>
            <View style={styles.ioHead}>
              <View style={[styles.dot, { backgroundColor: incTone }]} />
              <Text style={[styles.ioK, { color: t.paper }]}>{s.inc}</Text>
            </View>
            <Text style={[styles.ioV, TABULAR, { color: incTone }]}>{fmt(inc, lang)}</Text>
          </View>
        </View>

        {flow > 0 && (
          <View style={[styles.ratio, { backgroundColor: t.paper + '26' }]}>
            <View style={[styles.ratioFill, { width: `${expPct}%`, backgroundColor: expTone }]} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  month: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  nav: { marginLeft: 'auto', flexDirection: 'row', gap: 8 },
  navBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  // zIndex 0 scopes the wash's negative zIndex to this card on the web
  card: { borderRadius: RAD.lg, padding: 22, paddingBottom: 18, overflow: 'hidden', zIndex: 0 },
  bgFlower: { position: 'absolute', right: -22, bottom: -34, opacity: 0.1 },
  label: { fontSize: 11, letterSpacing: 2.5, opacity: 0.62, fontWeight: '600' },
  net: { fontSize: 40, fontWeight: '800', letterSpacing: -0.8, marginTop: 4, marginBottom: 14 },
  io: { flexDirection: 'row', gap: 28 },
  ioCol: { gap: 2 },
  ioHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  ioK: { fontSize: 12, opacity: 0.75, fontWeight: '600' },
  ioV: { fontSize: 16, fontWeight: '700' },
  ratio: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 14 },
  ratioFill: { height: '100%', borderRadius: 2 },
});
