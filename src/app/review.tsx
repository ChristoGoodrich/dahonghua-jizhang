import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { cycleRange, inCycle } from '@/domain/cycle';
import { monthRecap } from '@/domain/recap';
import { streakDays } from '@/domain/streak';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtShort } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';

export default observer(function ReviewScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const data = store$.data.get();
  const customCats = store$.customCats.get();
  const cycleStart = store$.settings.cycleStart.get() || 1;

  const anchor = new Date();
  const { start } = cycleRange(anchor, cycleStart);
  const entries = data.filter((d) => !d.deletedAt && inCycle(d.ts, anchor, cycleStart));
  const r = monthRecap(entries);
  const streak = streakDays(data.filter((d) => !d.deletedAt).map((d) => d.ts));
  const topCat = r.topCatKey ? catOf('exp', r.topCatKey, customCats) : null;
  const monthLabel = start.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' });

  async function share() {
    const lines = [
      `🌺 ${s.title} · ${monthLabel}`,
      `${s.reviewSaved} ${fmtShort(r.net, lang)}`,
      `${s.exp} ${fmtShort(r.exp, lang)} · ${s.inc} ${fmtShort(r.inc, lang)}`,
      `${s.stCount} ${r.count} · ${s.streakLabel} ${streak}`,
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      /* user cancelled */
    }
  }

  const Line = ({ k, v, color }: { k: string; v: string; color?: string }) => (
    <View style={[styles.line, { borderBottomColor: t.line }]}>
      <Text style={[styles.lk, { color: t.inkSoft }]}>{k}</Text>
      <Text style={[styles.lv, { color: color ?? t.ink }]}>{v}</Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setReview} subtitle={s.setReviewD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { backgroundColor: t.paperWarm }]}>
            <Flower size={54} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
            <Text style={[styles.cardTitle, { color: t.ink }]}>{s.setReview}</Text>
            <Text style={[styles.big, { color: t.ink }]}>{fmtShort(r.net, lang)}</Text>
            <Text style={[styles.cardSub, { color: t.inkSoft }]}>{monthLabel} · {s.reviewSaved}</Text>
          </View>

          <Line k={s.exp} v={fmt(r.exp, lang)} />
          <Line k={s.inc} v={fmt(r.inc, lang)} color={t.leafDeep} />
          <Line k={s.stCount} v={String(r.count)} />
          <Line k={s.reviewActiveDays} v={String(r.activeDays)} />
          {topCat && <Line k={s.byCat} v={`${topCat.e} ${catName(topCat, lang)} ${fmt(r.topCatAmt, lang)}`} />}

          <Pressable style={[styles.share, { backgroundColor: t.hibiscus }]} onPress={share} accessibilityRole="button">
            <Flower size={18} petal="#fff" stamen="#fff" />
            <Text style={styles.shareText}>{s.reviewShare}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 60, paddingTop: 6 },
  card: { borderRadius: 18, padding: 24, alignItems: 'center', marginBottom: 14 },
  cardTitle: { fontSize: 19, fontWeight: '800', marginTop: 8 },
  big: { fontSize: 36, fontWeight: '800', marginTop: 14 },
  cardSub: { fontSize: 12, marginTop: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 2, borderBottomWidth: 1 },
  lk: { fontSize: 13.5 },
  lv: { fontSize: 13.5, fontWeight: '700' },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 13, padding: 14, marginTop: 18 },
  shareText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
