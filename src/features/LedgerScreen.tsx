import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Animated, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useWebKeyboard } from '@/hooks/useWebKeyboard';
import { useResponsive } from '@/hooks/useResponsive';
import { observer } from '@legendapp/state/react';
import { store$, setLang, patchSettings, addEntry } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { I18N } from '@/i18n';
import { cycleRange, inCycle, shiftCycle } from '@/domain/cycle';
import { streakDays } from '@/domain/streak';
import { computeInsight } from '@/domain/insight';
import { todayExpense } from '@/domain/budget';
import { matchesSearch } from '@/domain/search';
import { SummaryCard } from '@/features/summary/SummaryCard';
import { EntryList } from '@/features/list/EntryList';
import { RecordSheet } from '@/features/record/RecordSheet';
import { MarkSheet } from '@/features/record/MarkSheet';
import { DetailSheet } from '@/features/record/DetailSheet';
import { QuickEntry } from '@/features/record/QuickEntry';
import { TemplateChips } from '@/features/templates/TemplateChips';
import { LedgerFilter } from '@/features/list/LedgerFilter';
import { BudgetPot } from '@/features/budget/BudgetPot';
import { InsightBanner } from '@/features/budget/InsightBanner';
import { CalendarView } from '@/features/calendar/CalendarView';
import { StatsView } from '@/features/stats/StatsView';
import { GardenView, GOAL_DEFAULT } from '@/features/garden/GardenView';
import { BottomNav, useNavBottomPad } from '@/features/nav/BottomNav';
import { tapHaptic } from '@/util/haptics';
import { trackEvent, AnalyticsEvents } from '@/util/analytics';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { GradientFill } from '@/components/ui/GradientFill';
import { RAD, shadow } from '@/theme/tokens';
import { Toast } from '@/components/Toast';
import { PetalBurst } from '@/components/PetalBurst';

type Tab = 'list' | 'cal' | 'stats' | 'wall';

/** Remounts with a `key` per tab — content fades in and settles upward. */
function TabFade({ children }: { children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
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
  const cycleStart = settings.cycleStart || 1;

  const [anchor, setAnchor] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>('list');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; msg: string; undo?: () => void } | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [markId, setMarkId] = useState<string | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const searchRef = useRef<TextInput>(null);

  const liveAll = useMemo(() => data.filter((d) => !d.deletedAt), [data]);
  const cycleEntries = useMemo(
    () => liveAll.filter((d) => inCycle(d.ts, anchor, cycleStart) && (!curLedger || d.ledger === curLedger)),
    [liveAll, anchor, cycleStart, curLedger],
  );
  const listEntries = useMemo(
    () => (searchQ ? cycleEntries.filter((d) => matchesSearch(d, searchQ, customCats, lang)) : cycleEntries),
    [cycleEntries, searchQ, customCats, lang],
  );
  const exp = useMemo(() => cycleEntries.filter((d) => d.io === 'exp').reduce((a, d) => a + d.amt, 0), [cycleEntries]);
  const inc = useMemo(() => cycleEntries.filter((d) => d.io === 'inc').reduce((a, d) => a + d.amt, 0), [cycleEntries]);
  const insight = useMemo(() => computeInsight(cycleEntries, settings, customCats, lang), [cycleEntries, settings, customCats, lang]);
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
    setSheetOpen(true);
  }, []);
  const openEdit = useCallback((id: string) => {
    setDetailId(null);
    setEditId(id);
    setSheetOpen(true);
  }, []);
  const deleteToast = useCallback((restore: () => void) => setToast({ key: Date.now(), msg: s.deleted, undo: restore }), [s.deleted]);
  const celebrate = useCallback((msg: string) => {
    setToast({ key: Date.now(), msg });
    setBurst(Date.now());
  }, []);
  const onSaved = useCallback((isNew: boolean) => {
    if (!isNew) return;
    trackEvent(AnalyticsEvents.ENTRY_CREATED);
    const sd = streakDays(store$.data.peek().filter((d) => !d.deletedAt).map((d) => d.ts));
    celebrate(sd > 1 ? s.toastStreak.replace('%d', String(sd)) : s.toastBloom);
  }, [celebrate, s.toastStreak, s.toastBloom]);
  const quickSubmit = useCallback((amount: number, note: string) => {
    addEntry({ io: 'exp', cat: 'food', amt: amount, note: note || undefined });
    onSaved(true);
  }, [onSaved]);

  useWebKeyboard(
    useMemo(
      () => ({
        n: () => {
          if (!sheetOpen) openNew();
        },
        '/': () => {
          searchRef.current?.focus();
        },
        Escape: () => {
          if (sheetOpen) setSheetOpen(false);
          else if (detailId) setDetailId(null);
          else if (markId) setMarkId(null);
        },
      }),
      [sheetOpen, detailId, markId, openNew],
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
              onPress={() => router.push('/insights')}
              accessibilityRole="button"
              accessibilityLabel={s.insightsTitle}
            >
              <Icon name="sparkle" color={t.hibiscus} size={17} />
            </Tap>
            <Tap
              style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }, shadow(t, 'xs')]}
              scaleTo={0.88}
              onPress={() => router.push('/report')}
              accessibilityRole="button"
              accessibilityLabel={s.setReview}
            >
              <Icon name="receipt" color={t.inkSoft} size={17} />
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
            <Tap
              style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }, shadow(t, 'xs')]}
              scaleTo={0.88}
              onPress={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              accessibilityRole="button"
              accessibilityLabel={s.a11yLang}
            >
              <Text style={[styles.iconBtnText, { color: t.inkSoft }]}>{s.langBtn}</Text>
            </Tap>
          </View>
        </View>

        <SummaryCard
          exp={exp}
          inc={inc}
          monthLabel={monthLabel}
          lang={lang}
          onPrev={() => setAnchor((a) => shiftCycle(a, -1, cycleStart))}
          onNext={() => setAnchor((a) => shiftCycle(a, 1, cycleStart))}
        />

        <TabFade key={tab}>
          {tab === 'list' && (
            <>
              <BudgetPot
                exp={exp}
                budget={settings.budget}
                lang={lang}
                dailyBudget={settings.dailyBudget}
                dailyUsed={todayExpense(cycleEntries)}
              />
              <InsightBanner insight={insight} />
              <LedgerFilter lang={lang} />
              <TemplateChips lang={lang} onLogged={() => celebrate(s.toastBloom)} />
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
                  />
                  {searchQ.length > 0 && (
                    <Pressable onPress={() => setSearchQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={s.a11yClearSearch}>
                      <View style={[styles.searchClear, { backgroundColor: t.line }]}>
                        <Icon name="close" color={t.inkSoft} size={11} strokeWidth={2.4} />
                      </View>
                    </Pressable>
                  )}
                </View>
              </View>
              <EntryList
                entries={listEntries}
                customCats={customCats}
                lang={lang}
                columns={responsive.columns}
                onPress={setDetailId}
                onLongPress={setMarkId}
                emptyText={searchQ ? s.noResult : undefined}
              />
            </>
          )}
          {tab === 'cal' && <CalendarView all={liveAll} anchor={anchor} cycleStart={cycleStart} customCats={customCats} lang={lang} />}
          {tab === 'stats' && (
            <StatsView all={liveAll} anchor={anchor} cycleStart={cycleStart} customCats={customCats} lang={lang} onEntryPress={setDetailId} />
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

      <QuickEntry lang={lang} onSubmit={quickSubmit} />

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
        onDeleted={deleteToast}
      />

      {burst != null && <PetalBurst key={burst} onDone={() => setBurst(null)} />}

      {toast && (
        <Toast
          key={toast.key}
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
  iconBtnText: { fontSize: 12, fontWeight: '700' },
  searchWrap: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 2 },
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
