import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { Tap } from '@/components/ui/Tap';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Group, NavRow } from '@/components/ui/Rows';
import { GOAL_DEFAULT } from '@/features/garden/GardenView';
import { RAD, TABULAR } from '@/theme/tokens';
import { I18N, type Lang } from '@/i18n';

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
  const goal = store$.settings.gardenGoal.get() ?? GOAL_DEFAULT;
  const pct = Math.min(1, goal > 0 ? count / goal : 0);
  // every row wears the same stroke and the same accent — that uniformity is
  // what makes a long options list read as one surface
  const glyph = (name: IconName) => <Icon name={name} color={t.hibiscus} size={19} strokeWidth={1.7} />;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={[styles.screenTitle, { color: t.ink }]}>{s.me}</Text>

      <Tap
        onPress={() => router.push('/garden')}
        accessibilityRole="button"
        accessibilityLabel={s.wallTitle}
        style={[styles.garden, { backgroundColor: t.card, borderColor: t.line }]}
      >
        <View style={[styles.gardenMark, { backgroundColor: t.tint }]}>
          <Flower size={30} petal={t.hibiscus} stroke={t.hibiscusDeep} />
        </View>
        <View style={styles.gardenMid}>
          <Text style={[styles.gardenTitle, { color: t.ink }]}>{s.wallTitle}</Text>
          <Text style={[styles.gardenSub, TABULAR, { color: t.inkSoft }]}>
            {s.meGardenSub.replace('%d', String(count)).replace('%d', String(streak))}
          </Text>
          <View style={[styles.track, { backgroundColor: t.line }]}>
            <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: t.hibiscus }]} />
          </View>
        </View>
        <Icon name="chevR" color={t.inkSoft} size={16} strokeWidth={2} />
      </Tap>

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
        <NavRow lead={glyph('sliders')} title={s.setTitle} desc={s.setSub} onPress={() => router.push('/settings')} />
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
  screenTitle: { fontSize: 20, fontWeight: '800', letterSpacing: 0.2, marginBottom: 12 },
  garden: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    borderRadius: RAD.md, borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  gardenMark: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  gardenMid: { flex: 1, minWidth: 0, gap: 4 },
  gardenTitle: { fontSize: 14.5, fontWeight: '700' },
  gardenSub: { fontSize: 11.5 },
  track: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 2 },
  fill: { height: '100%', borderRadius: 3 },
});
