import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { observer } from '@legendapp/state/react';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Group, NavRow } from '@/components/ui/Rows';
import { TABULAR } from '@/theme/tokens';
import { I18N, daysUnit, flowersUnit, type Lang } from '@/i18n';

interface Props {
  lang: Lang;
  /** Flowers earned this cycle + current streak — already computed by the screen. */
  count: number;
  streak: number;
}

/** 我的 tab — the home for everything that isn't reading or entering a number.
 *  Tools that shape *how* you record sit on top; data/sync below; true settings
 *  stay one more level down so this list can stay short. */
export const MeView = observer(function MeView({ lang, count, streak }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const router = useRouter();
  // every row wears the same stroke and the same accent — that uniformity is
  // what makes a long options list read as one surface
  const glyph = (name: IconName) => <Icon name={name} color={t.hibiscus} size={19} strokeWidth={1.7} />;

  return (
    <ScrollView testID="garden-view" style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* the habit signal, one line — the flower wall it replaces just restated
          what the calendar view already shows, day by day */}
      <View style={styles.head}>
        <Text style={[styles.screenTitle, { color: t.ink }]}>{s.me}</Text>
        <View style={styles.streak}>
          <Flower size={15} petal={t.hibiscus} stroke={t.hibiscusDeep} />
          <Text style={[styles.streakText, TABULAR, { color: t.inkSoft }]}>
            {s.meStreakLine
              .replace('%f', `${count} ${flowersUnit(lang, count)}`)
              .replace('%d', `${streak} ${daysUnit(lang, streak)}`)}
          </Text>
        </View>
      </View>

      <Group title={s.meGroupTools}>
        <NavRow lead={glyph('sprout')} title={s.setBudgetNav} desc={s.setBudgetNavD} onPress={() => router.push('/budget')} />
        <NavRow lead={glyph('bolt')} title={s.setTemplates} desc={s.setTemplatesD} onPress={() => router.push('/templates')} />
        <NavRow lead={glyph('tag')} title={s.setTags} desc={s.setTagsD} onPress={() => router.push('/tags')} />
        <NavRow lead={glyph('repeat')} title={s.setSubs} desc={s.setSubsD} onPress={() => router.push('/subs')} />
        <NavRow lead={glyph('receipt')} title={s.setReimburse} desc={s.setReimburseD} onPress={() => router.push('/reimburse')} last />
      </Group>

      <Group title={s.meGroupData}>
        <NavRow lead={glyph('download')} title={s.billImportNav} desc={s.billImportNavD} onPress={() => router.push('/import-bills')} />
        <NavRow lead={glyph('bell')} title={s.capNav} desc={s.capNavD} onPress={() => router.push('/auto-capture')} />
        <NavRow lead={glyph('cloud')} title={s.setSync} desc={s.setSyncD} onPress={() => router.push('/account')} />
        <NavRow lead={glyph('archive')} title={s.backupAuto} desc={s.backupAutoD} onPress={() => router.push('/backup')} last />
      </Group>

      {/* 洞察 / 报表 / 月度回顾 live under the 统计 tab, next to the numbers they
          explain — repeating them here would just make this list longer. */}
      <Group title={s.meGroupMore}>
        <NavRow testID="btn-settings" lead={glyph('sliders')} title={s.setTitle} desc={s.setSub} onPress={() => router.push('/settings')} />
        <NavRow
          lead={glyph('mail')}
          title={lang === 'zh' ? '意见反馈' : 'Feedback'}
          desc={lang === 'zh' ? '你的建议让大红花更好' : 'Help us improve Red Blossom'}
          onPress={() => router.push('/feedback')}
          last
        />
      </Group>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 2, paddingBottom: 140 },
  head: { marginBottom: 2 },
  screenTitle: { fontSize: 20, fontWeight: '800', letterSpacing: 0.2 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  streakText: { fontSize: 12 },
});
