import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme/ThemeContext';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { Flower } from '@/components/Flower';
import { EntryList } from '@/features/list/EntryList';
import { SummaryCard } from '@/features/summary/SummaryCard';
import { TemplateChips } from '@/features/templates/TemplateChips';
import { LedgerFilter } from '@/features/list/LedgerFilter';
import { BudgetPot } from '@/features/budget/BudgetPot';
import { InsightBanner } from '@/features/budget/InsightBanner';
import { CalendarView } from '@/features/calendar/CalendarView';
import { StatsView } from '@/features/stats/StatsView';
import { AssetsView } from '@/features/assets/AssetsView';
import { MeView } from '@/features/me/MeView';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { RAD, shadow } from '@/theme/tokens';
import { NO_ANIM } from '@/util/boot';
import { todayExpense } from '@/domain/budget';
import type { Lang } from '@/i18n';
import type { Tab, ListMode } from '@/features/hooks/useLedgerState';

/** Remounts with a `key` per tab — content fades in and settles upward. */
function TabFade({ children }: { children: React.ReactNode }) {
  const v = useAnimatedValue(NO_ANIM ? 1 : 0);
  useEffect(() => {
    if (NO_ANIM) return;
    Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [v]);
  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** Compact ‹ month › row for tabs that don't carry the summary card. */
function MonthNav({ label, onPrev, onNext, prevLabel, nextLabel }: {
  label: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string;
}) {
  const t = useTheme();
  const btn = (dir: 'chevL' | 'chevR', onPress: () => void, a11y: string) => (
    <Tap
      onPress={onPress}
      scaleTo={0.88}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[s.monthNavBtn, { backgroundColor: t.card, borderColor: t.line }]}
    >
      <Icon name={dir} color={t.inkSoft} size={15} strokeWidth={2.2} />
    </Tap>
  );
  return (
    <View style={s.monthNav}>
      <Text style={[s.monthNavLabel, { color: t.ink }]}>{label}</Text>
      <View style={s.monthNavBtns}>
        {btn('chevL', onPrev, prevLabel)}
        {btn('chevR', onNext, nextLabel)}
      </View>
    </View>
  );
}

export function LedgerContent(props: {
  tab: Tab;
  listMode: ListMode;
  searchQ: string;
  searchTerm: string;
  lang: Lang;
  customCats: any;
  columns: number;
  listEntries: any[];
  cycleEntries: any[];
  liveAll: any[];
  anchor: Date;
  cycleStart: number;
  monthLabel: string;
  exp: number;
  inc: number;
  insight: any;
  dueInsight: any;
  settings: any;
  streak: number;
  a11yMonthPrev: string;
  a11yMonthNext: string;
  noResult: string;
  noResultHint: string;
  statsMore: string;
  insightsTitle: string;
  reportTitle: string;
  setReview: string;
  setDetailId: (id: string) => void;
  setMarkId: (id: string) => void;
  celebrate: (msg: string) => void;
  toastBloom: string;
  onPrev: () => void;
  onNext: () => void;
  onNewAt: (ts: number) => void;
}) {
  const t = useTheme();
  const router = useRouter();

  return (
    <TabFade key={`${props.tab}${props.listMode}`}>
      {props.tab === 'list' && props.listMode === 'list' && (
        <EntryList
          entries={props.listEntries}
          customCats={props.customCats}
          lang={props.lang}
          columns={props.columns}
          onPress={props.setDetailId}
          onLongPress={props.setMarkId}
          emptyText={props.searchTerm ? props.noResult : undefined}
          emptyHint={props.searchTerm ? props.noResultHint : undefined}
          header={
            <>
              {!props.searchQ && (
                <>
                  <SummaryCard
                    exp={props.exp}
                    inc={props.inc}
                    monthLabel={props.monthLabel}
                    lang={props.lang}
                    onPrev={props.onPrev}
                    onNext={props.onNext}
                  />
                  <BudgetPot
                    exp={props.exp}
                    budget={props.settings.budget}
                    lang={props.lang}
                    dailyBudget={props.settings.dailyBudget}
                    dailyUsed={todayExpense(props.cycleEntries)}
                    onPress={() => router.push('/budget')}
                  />
                  <InsightBanner
                    insight={props.dueInsight ?? props.insight}
                    onPress={props.dueInsight?.acctId ? () => router.push(`/account-detail?id=${props.dueInsight.acctId}`) : undefined}
                  />
                  <LedgerFilter lang={props.lang} />
                  <TemplateChips lang={props.lang} onLogged={() => props.celebrate(props.toastBloom)} />
                </>
              )}
            </>
          }
        />
      )}
      {props.tab === 'list' && props.listMode === 'cal' && (
        <>
          <MonthNav
            label={props.monthLabel}
            onPrev={props.onPrev}
            onNext={props.onNext}
            prevLabel={props.a11yMonthPrev}
            nextLabel={props.a11yMonthNext}
          />
          <CalendarView all={props.liveAll} anchor={props.anchor} cycleStart={props.cycleStart} customCats={props.customCats} lang={props.lang} onAddDay={props.onNewAt} />
        </>
      )}
      {props.tab === 'stats' && (
        <StatsView
          all={props.liveAll}
          anchor={props.anchor}
          cycleStart={props.cycleStart}
          customCats={props.customCats}
          lang={props.lang}
          onEntryPress={props.setDetailId}
          footer={
            <View style={s.moreWrap}>
              <Text style={[s.moreHead, { color: t.inkSoft }]}>{props.statsMore}</Text>
              {([
                { lead: <Icon name="sparkle" color={t.hibiscus} size={17} />, title: props.insightsTitle, route: '/insights' as const },
                { lead: <Icon name="receipt" color={t.hibiscus} size={17} />, title: props.reportTitle, route: '/report' as const },
                { lead: <Flower size={17} petal={t.hibiscus} stroke={t.hibiscusDeep} />, title: props.setReview, route: '/review' as const },
              ]).map((r) => (
                <Tap
                  key={r.route}
                  onPress={() => router.push(r.route)}
                  scaleTo={0.98}
                  accessibilityRole="button"
                  accessibilityLabel={r.title}
                  style={[s.moreRow, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}
                >
                  {r.lead}
                  <Text style={[s.moreTitle, { color: t.ink }]}>{r.title}</Text>
                  <Icon name="chevR" color={t.inkSoft} size={15} strokeWidth={2} />
                </Tap>
              ))}
            </View>
          }
        />
      )}
      {props.tab === 'assets' && <AssetsView lang={props.lang} />}
      {props.tab === 'me' && <MeView lang={props.lang} count={props.cycleEntries.length} streak={props.streak} />}
    </TabFade>
  );
}

const s = StyleSheet.create({
  monthNav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 8, paddingBottom: 2 },
  monthNavLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  monthNavBtns: { marginLeft: 'auto', flexDirection: 'row', gap: 8 },
  monthNavBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  moreWrap: { marginTop: 20 },
  moreHead: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1.2, marginBottom: 9, marginHorizontal: 2 },
  moreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderRadius: RAD.md, borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 13, paddingHorizontal: 15, marginBottom: 8,
  },
  moreTitle: { flex: 1, fontSize: 14, fontWeight: '600' },
});
