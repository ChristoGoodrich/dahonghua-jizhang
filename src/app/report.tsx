import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { cycleRange, inCycle } from '@/domain/cycle';
import { generateMonthlyReport, shareReport } from '@/util/pdf';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Btn } from '@/components/ui/Btn';
import { Icon } from '@/components/ui/Icon';
import type { Lang } from '@/i18n';
import { RAD, shadow } from '@/theme/tokens';

const LABELS: Record<Lang, {
  title: string; sub: string;
  summary: string; recording: string;
  genBtn: string; generating: string;
  exp: string; inc: string; balance: string;
  total: string; expCount: string; incCount: string;
}> = {
  zh: {
    title: '月度报表', sub: '生成 PDF 报表并分享',
    summary: '收支汇总', recording: '记账统计',
    genBtn: '生成报表', generating: '正在生成…',
    exp: '花掉', inc: '进账', balance: '结余',
    total: '总笔数', expCount: '支出笔数', incCount: '收入笔数',
  },
  en: {
    title: 'Monthly Report', sub: 'Generate and share a PDF report',
    summary: 'Summary', recording: 'Recording Stats',
    genBtn: 'Generate Report', generating: 'Generating…',
    exp: 'Spent', inc: 'In', balance: 'Balance',
    total: 'Total Entries', expCount: 'Expenses', incCount: 'Income',
  },
};

export default observer(function ReportScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = LABELS[lang];
  const data = store$.data.get();
  const customCats = store$.customCats.get();
  const cycleStart = store$.settings.cycleStart.get() || 1;

  const [generating, setGenerating] = useState(false);

  const anchor = new Date();
  const { start } = cycleRange(anchor, cycleStart);
  const entries = useMemo(
    () => data.filter((d) => !d.deletedAt && inCycle(d.ts, anchor, cycleStart)),
    [data, cycleStart],
  );

  const exp = entries.filter((d) => d.io === 'exp').reduce((a, d) => a + d.amt, 0);
  const inc = entries.filter((d) => d.io === 'inc').reduce((a, d) => a + d.amt, 0);
  const balance = inc - exp;
  const expCount = entries.filter((d) => d.io === 'exp').length;
  const incCount = entries.filter((d) => d.io === 'inc').length;

  const monthLabel = start.toLocaleDateString(
    lang === 'zh' ? 'zh-CN' : 'en-US',
    { year: 'numeric', month: 'long' },
  );

  async function onGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      const report = await generateMonthlyReport(entries, lang, customCats);
      await shareReport(report);
    } catch {
      // silently ignore — user cancelled or platform unsupported
    } finally {
      setGenerating(false);
    }
  }

  const StatRow = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <View style={[styles.row, { borderBottomColor: t.line }]}>
      <Text style={[styles.rowLabel, { color: t.inkSoft }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: color ?? t.ink }]}>{value}</Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.title} subtitle={s.sub} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Month header */}
          <View style={[styles.card, { backgroundColor: t.paperWarm }]}>
            <Text style={[styles.monthTitle, { color: t.ink }]}>{monthLabel}</Text>
            <Text style={[styles.monthSub, { color: t.inkSoft }]}>{s.title}</Text>
          </View>

          {/* Summary stats */}
          <Text style={[styles.sectionTitle, { color: t.hibiscus }]}>{s.summary}</Text>
          <View style={[styles.section, shadow(t, 'xs')]}>
            <StatRow label={s.exp} value={exp.toFixed(2)} color={t.hibiscus} />
            <StatRow label={s.inc} value={inc.toFixed(2)} color={t.leafDeep} />
            <StatRow label={s.balance} value={balance.toFixed(2)} color={balance >= 0 ? t.leafDeep : t.hibiscus} />
          </View>

          {/* Recording stats */}
          <Text style={[styles.sectionTitle, { color: t.hibiscus }]}>{s.recording}</Text>
          <View style={[styles.section, shadow(t, 'xs')]}>
            <StatRow label={s.total} value={String(entries.length)} />
            <StatRow label={s.expCount} value={String(expCount)} />
            <StatRow label={s.incCount} value={String(incCount)} />
          </View>

          {/* Generate button */}
          <Btn
            label={generating ? s.generating : s.genBtn}
            onPress={onGenerate}
            disabled={generating || entries.length === 0}
            leading={generating ? <ActivityIndicator color="#fff" size="small" /> : <Icon name="sparkle" color="#fff" size={17} />}
            style={styles.genBtn}
            accessibilityLabel={s.genBtn}
          />
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
  monthTitle: { fontSize: 22, fontWeight: '800' },
  monthSub: { fontSize: 12, marginTop: 3 },
  sectionTitle: { fontSize: 14, fontWeight: '700', marginTop: 16, marginBottom: 8, letterSpacing: 0.5 },
  section: { borderRadius: RAD.lg, overflow: 'hidden', backgroundColor: 'transparent' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 13.5 },
  rowValue: { fontSize: 13.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  genBtn: { marginTop: 24 },
});
