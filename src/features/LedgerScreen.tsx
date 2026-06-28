import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { observer } from '@legendapp/state/react';
import { store$, setLang } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { I18N } from '@/i18n';
import { cycleRange, inCycle, shiftCycle } from '@/domain/cycle';
import { streakDays } from '@/domain/streak';
import { computeInsight } from '@/domain/insight';
import { matchesSearch } from '@/domain/search';
import { SummaryCard } from '@/features/summary/SummaryCard';
import { EntryList } from '@/features/list/EntryList';
import { RecordSheet } from '@/features/record/RecordSheet';
import { MarkSheet } from '@/features/record/MarkSheet';
import { TemplateChips } from '@/features/templates/TemplateChips';
import { LedgerFilter } from '@/features/list/LedgerFilter';
import { BudgetPot } from '@/features/budget/BudgetPot';
import { InsightBanner } from '@/features/budget/InsightBanner';
import { CalendarView } from '@/features/calendar/CalendarView';
import { StatsView } from '@/features/stats/StatsView';
import { GardenView } from '@/features/garden/GardenView';
import { Toast } from '@/components/Toast';

type Tab = 'list' | 'cal' | 'stats' | 'wall';

export const LedgerScreen = observer(function LedgerScreen() {
  const t = useTheme();
  const router = useRouter();
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
  const [toast, setToast] = useState<{ key: number; msg: string } | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [markId, setMarkId] = useState<string | null>(null);

  const liveAll = useMemo(() => data.filter((d) => !d.deletedAt), [data]);
  const cycleEntries = useMemo(
    () => liveAll.filter((d) => inCycle(d.ts, anchor, cycleStart) && (!curLedger || d.ledger === curLedger)),
    [liveAll, anchor, cycleStart, curLedger],
  );
  const listEntries = useMemo(
    () => (searchQ ? cycleEntries.filter((d) => matchesSearch(d, searchQ, customCats, lang)) : cycleEntries),
    [cycleEntries, searchQ, customCats, lang],
  );
  const exp = cycleEntries.filter((d) => d.io === 'exp').reduce((a, d) => a + d.amt, 0);
  const inc = cycleEntries.filter((d) => d.io === 'inc').reduce((a, d) => a + d.amt, 0);
  const insight = useMemo(() => computeInsight(cycleEntries, settings, customCats, lang), [cycleEntries, settings, customCats, lang]);
  const streak = useMemo(() => streakDays(data.filter((d) => !d.deletedAt).map((d) => d.ts)), [data]);

  const monthLabel = cycleRange(anchor, cycleStart).start.toLocaleDateString(
    lang === 'zh' ? 'zh-CN' : 'en-US',
    { year: 'numeric', month: 'long' },
  );

  function openNew() {
    setEditId(null);
    setSheetOpen(true);
  }
  function openEdit(id: string) {
    setEditId(id);
    setSheetOpen(true);
  }
  function onSaved(isNew: boolean) {
    if (!isNew) return;
    const sd = streakDays(store$.data.peek().filter((d) => !d.deletedAt).map((d) => d.ts));
    setToast({ key: Date.now(), msg: sd > 1 ? s.toastStreak.replace('%d', String(sd)) : s.toastBloom });
  }

  const tabs: Tab[] = ['list', 'cal', 'stats', 'wall'];

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.top}>
          <View style={styles.brand}>
            <Flower size={42} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
            <View>
              <Text style={[styles.title, { color: t.ink }]}>{s.title}</Text>
              <Text style={[styles.sub, { color: t.hibiscus }]}>{s.sub}</Text>
            </View>
          </View>
          <View style={styles.topBtns}>
            <Pressable
              style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }]}
              onPress={() => router.push('/settings')}
            >
              <Text style={[styles.iconBtnText, { color: t.inkSoft }]}>⚙︎</Text>
            </Pressable>
            <Pressable
              style={[styles.iconBtn, { borderColor: t.line, backgroundColor: t.card }]}
              onPress={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            >
              <Text style={[styles.iconBtnText, { color: t.inkSoft }]}>{s.langBtn}</Text>
            </Pressable>
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

        {tab === 'list' && <BudgetPot exp={exp} budget={settings.budget} lang={lang} />}
        {tab === 'list' && <InsightBanner insight={insight} />}

        <View style={styles.tabs}>
          {tabs.map((k) => (
            <Pressable key={k} style={styles.tab} onPress={() => setTab(k)}>
              <Text style={[styles.tabText, { color: tab === k ? t.ink : t.inkSoft }]}>{s[k]}</Text>
              {tab === k && <View style={[styles.tabDot, { backgroundColor: t.hibiscus }]} />}
            </Pressable>
          ))}
        </View>

        {tab === 'list' && <LedgerFilter lang={lang} />}
        {tab === 'list' && <TemplateChips lang={lang} onLogged={() => setToast({ key: Date.now(), msg: s.toastBloom })} />}
        {tab === 'list' && (
          <View style={styles.searchWrap}>
            <View style={[styles.searchBar, { backgroundColor: t.card, borderColor: t.line }]}>
              <Text style={{ color: t.inkSoft }}>🔍</Text>
              <TextInput
                style={[styles.searchInput, { color: t.ink }]}
                value={searchQ}
                onChangeText={setSearchQ}
                placeholder={s.searchPh}
                placeholderTextColor={t.inkSoft}
              />
              {searchQ.length > 0 && (
                <Pressable onPress={() => setSearchQ('')} hitSlop={8}>
                  <Text style={{ color: t.inkSoft, fontSize: 16 }}>✕</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
        {tab === 'list' && (
          <EntryList
            entries={listEntries}
            customCats={customCats}
            lang={lang}
            onEdit={openEdit}
            onLongPress={setMarkId}
            emptyText={searchQ ? s.noResult : undefined}
          />
        )}
        {tab === 'cal' && <CalendarView all={liveAll} anchor={anchor} cycleStart={cycleStart} lang={lang} />}
        {tab === 'stats' && (
          <StatsView cycleEntries={cycleEntries} all={liveAll} anchor={anchor} cycleStart={cycleStart} customCats={customCats} lang={lang} />
        )}
        {tab === 'wall' && <GardenView count={cycleEntries.length} streak={streak} lang={lang} />}
      </SafeAreaView>

      <Pressable style={[styles.fab, { backgroundColor: t.hibiscus }]} onPress={openNew}>
        <Text style={styles.fabPlus}>＋</Text>
      </Pressable>

      <RecordSheet
        visible={sheetOpen}
        editId={editId}
        lang={lang}
        customCats={customCats}
        onClose={() => setSheetOpen(false)}
        onSaved={onSaved}
        onTemplateSaved={() => setToast({ key: Date.now(), msg: s.tmplSaved })}
      />

      <MarkSheet
        entryId={markId}
        lang={lang}
        customCats={customCats}
        onClose={() => setMarkId(null)}
        onEdit={openEdit}
      />

      {toast && <Toast key={toast.key} message={toast.msg} />}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  top: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  sub: { fontSize: 10, letterSpacing: 3, fontWeight: '600' },
  topBtns: { flexDirection: 'row', gap: 7 },
  iconBtn: { borderWidth: 1, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 11 },
  iconBtnText: { fontSize: 12, fontWeight: '600' },
  searchWrap: { paddingHorizontal: 22, paddingTop: 2, paddingBottom: 2 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 13, paddingVertical: 9, paddingHorizontal: 13 },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  tabs: { flexDirection: 'row', paddingHorizontal: 22, paddingTop: 12, paddingBottom: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabText: { fontSize: 12.5, fontWeight: '600' },
  tabDot: { width: 20, height: 3, borderRadius: 3, marginTop: 5 },
  fab: {
    position: 'absolute', alignSelf: 'center', bottom: 26, width: 62, height: 62, borderRadius: 31,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#D94E5C', shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  fabPlus: { color: '#fff', fontSize: 30, fontWeight: '300', lineHeight: 34 },
});
