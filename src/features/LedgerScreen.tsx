import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Animated, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useWebKeyboard } from '@/hooks/useWebKeyboard';
import { useResponsive } from '@/hooks/useResponsive';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { observer } from '@legendapp/state/react';
import { store$, patchSettings } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { I18N } from '@/i18n';
import { cycleRange, inCycle, shiftCycle } from '@/domain/cycle';
import { sameDay } from '@/domain/dates';
import { streakDays } from '@/domain/streak';
import { computeInsight, creditDueInsight } from '@/domain/insight';
import { todayExpense } from '@/domain/budget';
import { matchesSearch } from '@/domain/search';
import { SummaryCard } from '@/features/summary/SummaryCard';
import { EntryList } from '@/features/list/EntryList';
import { RecordSheet } from '@/features/record/RecordSheet';
import { MarkSheet } from '@/features/record/MarkSheet';
import { DetailSheet } from '@/features/record/DetailSheet';
import { TemplateChips } from '@/features/templates/TemplateChips';
import { LedgerFilter } from '@/features/list/LedgerFilter';
import { BudgetPot } from '@/features/budget/BudgetPot';
import { InsightBanner } from '@/features/budget/InsightBanner';
import { CalendarView } from '@/features/calendar/CalendarView';
import { StatsView } from '@/features/stats/StatsView';
import { GardenView, GOAL_DEFAULT } from '@/features/garden/GardenView';
import { BottomNav, useNavBottomPad } from '@/features/nav/BottomNav';
import { tapHaptic } from '@/util/haptics';
import { bootParam, NO_ANIM } from '@/util/boot';
import { trackEvent, AnalyticsEvents } from '@/util/analytics';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { GradientFill } from '@/components/ui/GradientFill';
import { RAD, shadow } from '@/theme/tokens';
import { Toast } from '@/components/Toast';
import { PetalBurst } from '@/components/PetalBurst';

type Tab = 'list' | 'cal' | 'stats' | 'wall';

// Web deep-link bootstrap (?tab=stats, ?sheet=1) — see util/boot.
const BOOT_TAB: Tab | null = (['list', 'cal', 'stats', 'wall'] as const).find((k) => k === bootParam('tab')) ?? null;
const BOOT_SHEET = bootParam('sheet') === '1';

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
      style={[styles.monthNavBtn, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}
    >
      <Icon name={dir} color={t.inkSoft} size={15} strokeWidth={2.2} />
    </Tap>
  );
  return (
    <View style={styles.monthNav}>
      <Text style={[styles.monthNavLabel, { color: t.ink }]}>{label}</Text>
      <View style={styles.monthNavBtns}>
        {btn('chevL', onPrev, prevLabel)}
        {btn('chevR', onNext, nextLabel)}
      </View>
    </View>
  );
}

export const LedgerScreen = observer(function LedgerScreen() {
  const t = useTheme();
  const router = useRouter();
  const navPad = useNavBottomPad();
  const responsive = useResponsive();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const data = store$.data.get();
  const customCats = store$.customCats.get();
  const settings = store$.settings.get();
  const curLedger = store$.curLedger.get();
  const accounts = store$.accounts.get();
  const cycleStart = settings.cycleStart || 1;

  const [anchor, setAnchor] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>(BOOT_TAB ?? 'list');
  const [sheetOpen, setSheetOpen] = useState(BOOT_SHEET);
  const [editId, setEditId] = useState<string | null>(null);
  // pre-picked date for a new entry (calendar "补记这天"); null = now
  const [sheetInitTs, setSheetInitTs] = useState<number | null>(null);
  // source entry to copy into a new entry (再记一笔); null = blank new entry
  const [sheetDupeId, setSheetDupeId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; msg: string; undo?: () => void } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [markId, setMarkId] = useState<string | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const searchRef = useRef<TextInput>(null);

  const liveAll = useMemo(() => data.filter((d) => !d.deletedAt), [data]);
  const cycleEntries = useMemo(
    () => liveAll.filter((d) => inCycle(d.ts, anchor, cycleStart) && (!curLedger || d.ledger === curLedger)),
    [liveAll, anchor, cycleStart, curLedger],
  );
  // searching spans ALL months (you rarely remember which month a thing was
  // in) — only ledger scope is kept; the day groups carry the dates anyway
  const listEntries = useMemo(
    () =>
      searchQ
        ? liveAll.filter((d) => (!curLedger || d.ledger === curLedger) && matchesSearch(d, searchQ, customCats, lang))
        : cycleEntries,
    [cycleEntries, liveAll, curLedger, searchQ, customCats, lang],
  );
  const exp = useMemo(() => cycleEntries.filter((d) => d.io === 'exp').reduce((a, d) => a + d.amt, 0), [cycleEntries]);
  const inc = useMemo(() => cycleEntries.filter((d) => d.io === 'inc').reduce((a, d) => a + d.amt, 0), [cycleEntries]);
  const insight = useMemo(() => computeInsight(cycleEntries, settings, customCats, lang), [cycleEntries, settings, customCats, lang]);
  // a credit-card repayment reminder takes priority over the spending insight
  const dueInsight = useMemo(() => creditDueInsight(accounts, liveAll, lang), [accounts, liveAll, lang]);
  const streak = useMemo(() => streakDays(liveAll.map((d) => d.ts)), [liveAll]);

  const monthLabel = useMemo(
    () =>
      cycleRange(anchor, cycleStart).start.toLocaleDateString(
        lang === 'zh' ? 'zh-CN' : 'en-US',
        { year: 'numeric', month: 'long' },
      ),
    [anchor, cycleStart, lang],
  );

  const openNew = useCallback(() => {
    tapHaptic();
    setEditId(null);
    setSheetInitTs(null);
    setSheetDupeId(null);
    setSheetOpen(true);
  }, []);
  // calendar day panel → new entry pre-dated to that day (today keeps "now")
  const openNewAt = useCallback((ts: number) => {
    tapHaptic();
    setEditId(null);
    setSheetInitTs(sameDay(ts, Date.now()) ? null : ts);
    setSheetDupeId(null);
    setSheetOpen(true);
  }, []);
  const openEdit = useCallback((id: string) => {
    setDetailId(null);
    setEditId(id);
    setSheetDupeId(null);
    setSheetOpen(true);
  }, []);
  // detail sheet → new entry pre-filled from an existing one (再记一笔), dated today
  const openDuplicate = useCallback((id: string) => {
    tapHaptic();
    setDetailId(null);
    setEditId(null);
    setSheetInitTs(null);
    setSheetDupeId(id);
    setSheetOpen(true);
  }, []);
  const deleteToast = useCallback((restore: () => void) => setToast({ key: Date.now(), msg: s.deleted, undo: restore }), [s.deleted]);
  const celebrate = useCallback((msg: string) => {
    setToast({ key: Date.now(), msg });
    setBurst(Date.now());
  }, []);
  const onSaved = useCallback((isNew: boolean, keepOpen?: boolean) => {
    if (!isNew) return;
    trackEvent(AnalyticsEvents.ENTRY_CREATED);
    if (keepOpen) return; // 再记: sheet still covers the screen — it shows its own inline confirmation
    const sd = streakDays(store$.data.peek().filter((d) => !d.deletedAt).map((d) => d.ts));
    celebrate(sd > 1 ? s.toastStreak.replace('%d', String(sd)) : s.toastBloom);
  }, [celebrate, s.toastStreak, s.toastBloom]);
  const openSearch = useCallback(() => {
    setTab('list');
    setSearchOpen(true);
    // autoFocus covers the fresh mount; this covers re-taps while already open
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQ('');
  }, []);

  useWebKeyboard(
    useMemo(
      () => ({
        n: () => {
          if (!sheetOpen) openNew();
        },
        '/': openSearch,
        Escape: () => {
          if (sheetOpen) setSheetOpen(false);
          else if (detailId) setDetailId(null);
          else if (markId) setMarkId(null);
          else if (searchOpen) closeSearch();
        },
      }),
      [sheetOpen, detailId, markId, searchOpen, openNew, openSearch, closeSearch],
    ),
  );

  return (
    <View style={[styles.root, { backgroundColor: t.paper }, Platform.OS === 'web' && styles.rootWeb]}>
      <SafeAreaView edges={['top']} style={[styles.safe, { maxWidth: responsive.maxContentWidth }]}>
        <View style={styles.top}>
          <View style={styles.brand}>
            <Flower size={42} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
            <View>
              <Text style={[styles.title, { color: t.ink, fontSize: responsive.fontSize.title }]}>{s.title}</Text>
              <Text style={[styles.sub, { color: t.hibiscus }]}>{s.sub}</Text>
            </View>
          </View>
          <View style={styles.topBtns}>
            <Tap
              style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }, shadow(t, 'xs')]}
              scaleTo={0.88}
              onPress={searchOpen ? closeSearch : openSearch}
              accessibilityRole="button"
              accessibilityLabel={s.a11ySearch}
            >
              <Icon name="search" color={searchOpen ? t.hibiscus : t.inkSoft} size={17} />
            </Tap>
            <Tap
              style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }, shadow(t, 'xs')]}
              scaleTo={0.88}
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel={s.setTitle}
            >
              <Icon name="sliders" color={t.inkSoft} size={17} />
            </Tap>
          </View>
        </View>

        {searchOpen && tab === 'list' && (
          <View style={styles.searchWrap}>
            <View style={[styles.searchBar, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
              <Icon name="search" color={t.inkSoft} size={17} />
              <TextInput
                ref={searchRef}
                style={[styles.searchInput, { color: t.ink }]}
                value={searchQ}
                onChangeText={setSearchQ}
                placeholder={s.searchPh}
                placeholderTextColor={t.inkSoft}
                autoFocus
                accessibilityLabel={s.a11ySearch}
              />
              <Pressable onPress={searchQ ? () => setSearchQ('') : closeSearch} hitSlop={8} accessibilityRole="button" accessibilityLabel={s.a11yClearSearch}>
                <View style={[styles.searchClear, { backgroundColor: t.line }]}>
                  <Icon name="close" color={t.inkSoft} size={11} strokeWidth={2.4} />
                </View>
              </Pressable>
            </View>
          </View>
        )}

        <TabFade key={tab}>
          {tab === 'list' && (
            <EntryList
              entries={listEntries}
              customCats={customCats}
              lang={lang}
              columns={responsive.columns}
              onPress={setDetailId}
              onLongPress={setMarkId}
              emptyText={searchQ ? s.noResult : undefined}
              header={
                <>
                  {!searchQ && (
                    <>
                      <SummaryCard
                        exp={exp}
                        inc={inc}
                        monthLabel={monthLabel}
                        lang={lang}
                        onPrev={() => setAnchor((a) => shiftCycle(a, -1, cycleStart))}
                        onNext={() => setAnchor((a) => shiftCycle(a, 1, cycleStart))}
                      />
                      <BudgetPot
                        exp={exp}
                        budget={settings.budget}
                        lang={lang}
                        dailyBudget={settings.dailyBudget}
                        dailyUsed={todayExpense(cycleEntries)}
                        onPress={() => router.push('/budget')}
                      />
                      <InsightBanner
                        insight={dueInsight ?? insight}
                        onPress={dueInsight?.acctId ? () => router.push(`/account-detail?id=${dueInsight.acctId}`) : undefined}
                      />
                      <LedgerFilter lang={lang} />
                      <TemplateChips lang={lang} onLogged={() => celebrate(s.toastBloom)} />
                    </>
                  )}
                </>
              }
            />
          )}
          {tab === 'cal' && (
            <>
              <MonthNav
                label={monthLabel}
                onPrev={() => setAnchor((a) => shiftCycle(a, -1, cycleStart))}
                onNext={() => setAnchor((a) => shiftCycle(a, 1, cycleStart))}
                prevLabel={s.a11yMonthPrev}
                nextLabel={s.a11yMonthNext}
              />
              <CalendarView all={liveAll} anchor={anchor} cycleStart={cycleStart} customCats={customCats} lang={lang} onAddDay={openNewAt} />
            </>
          )}
          {tab === 'stats' && (
            <StatsView
              all={liveAll}
              anchor={anchor}
              cycleStart={cycleStart}
              customCats={customCats}
              lang={lang}
              onEntryPress={setDetailId}
              footer={
                <View style={styles.moreWrap}>
                  <Text style={[styles.moreHead, { color: t.inkSoft }]}>{s.statsMore}</Text>
                  {([
                    { lead: <Icon name="sparkle" color={t.hibiscus} size={17} />, title: s.insightsTitle, route: '/insights' as const },
                    { lead: <Icon name="receipt" color={t.hibiscus} size={17} />, title: s.reportTitle, route: '/report' as const },
                    { lead: <Flower size={17} petal={t.hibiscus} stroke={t.hibiscusDeep} />, title: s.setReview, route: '/review' as const },
                  ]).map((r) => (
                    <Tap
                      key={r.route}
                      onPress={() => router.push(r.route)}
                      scaleTo={0.98}
                      accessibilityRole="button"
                      accessibilityLabel={r.title}
                      style={[styles.moreRow, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}
                    >
                      {r.lead}
                      <Text style={[styles.moreTitle, { color: t.ink }]}>{r.title}</Text>
                      <Icon name="chevR" color={t.inkSoft} size={15} strokeWidth={2} />
                    </Tap>
                  ))}
                </View>
              }
            />
          )}
          {tab === 'wall' && (
            <GardenView
              count={cycleEntries.length}
              streak={streak}
              lang={lang}
              goal={settings.gardenGoal ?? GOAL_DEFAULT}
              onGoalChange={(g) => patchSettings({ gardenGoal: g })}
            />
          )}
        </TabFade>
      </SafeAreaView>

      <BottomNav active={tab} onChange={setTab} lang={lang} />

      <Tap
        style={[styles.fab, { bottom: navPad + 30, backgroundColor: t.hibiscus, borderColor: t.card }, shadow(t, 'glow')]}
        scaleTo={0.86}
        onPress={openNew}
        accessibilityRole="button"
        accessibilityLabel={s.a11yAdd}
      >
        <GradientFill from={t.gradFrom} to={t.gradTo} />
        <Icon name="plus" color="#fff" size={28} strokeWidth={2.5} />
      </Tap>

      <RecordSheet
        visible={sheetOpen}
        editId={editId}
        initialTs={sheetInitTs}
        dupeId={sheetDupeId}
        lang={lang}
        customCats={customCats}
        onClose={() => setSheetOpen(false)}
        onSaved={onSaved}
        onTemplateSaved={() => setToast({ key: Date.now(), msg: s.tmplSaved })}
        onDeleted={deleteToast}
      />

      <MarkSheet
        entryId={markId}
        lang={lang}
        customCats={customCats}
        onClose={() => setMarkId(null)}
        onEdit={openEdit}
      />

      <DetailSheet
        entryId={detailId}
        lang={lang}
        customCats={customCats}
        onClose={() => setDetailId(null)}
        onEdit={openEdit}
        onDuplicate={openDuplicate}
        onDeleted={deleteToast}
      />

      {/* prefixed keys: burst + toast are set with Date.now() in the same tick
          (celebrate), so bare numbers collide as sibling keys */}
      {burst != null && <PetalBurst key={`b${burst}`} seed={burst} onDone={() => setBurst(null)} />}

      {toast && (
        <Toast
          key={`t${toast.key}`}
          bottom={navPad + 88}
          message={toast.msg}
          actionLabel={toast.undo ? s.undo : undefined}
          onAction={
            toast.undo
              ? () => {
                  toast.undo!();
                  setToast(null);
                }
              : undefined
          }
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootWeb: { alignItems: 'center' as const },
  safe: { flex: 1, width: '100%', alignSelf: 'center' },
  top: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: 0.4 },
  sub: { fontSize: 10, letterSpacing: 3, fontWeight: '700', marginTop: 1 },
  topBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  monthNav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 8, paddingBottom: 2 },
  monthNavLabel: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  monthNavBtns: { marginLeft: 'auto', flexDirection: 'row', gap: 8 },
  monthNavBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  searchWrap: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 4 },
  moreWrap: { marginTop: 20 },
  moreHead: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1.2, marginBottom: 9, marginHorizontal: 2 },
  moreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderRadius: RAD.md, borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 13, paddingHorizontal: 15, marginBottom: 8,
  },
  moreTitle: { flex: 1, fontSize: 14, fontWeight: '600' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.pill,
    paddingVertical: 10, paddingHorizontal: 15,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  searchClear: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  fab: {
    position: 'absolute', alignSelf: 'center', width: 62, height: 62, borderRadius: 31,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
});
