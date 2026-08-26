import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { store$ } from '@/store/ledger';
import { I18N } from '@/i18n';
import { cycleRange, inCycle, shiftCycle } from '@/domain/cycle';
import { sameDay } from '@/domain/dates';
import { streakDays } from '@/domain/streak';
import { computeInsight, creditDueInsight } from '@/domain/insight';
import { monthlyStatus, catBudgetRows } from '@/domain/budget';
import { fmtShort } from '@/domain/money';
import { catName, catOf } from '@/domain/cats';
import { matchesSearch } from '@/domain/search';
import { matchesFilter, parseSearchQuery, type FilterState } from '@/domain/filter';
import { tapHaptic } from '@/util/haptics';
import { trackEvent, AnalyticsEvents } from '@/util/analytics';
import { updateBudgetWidget } from '@/util/widget';
import { useWebKeyboard } from '@/hooks/useWebKeyboard';
import { bootParam } from '@/util/boot';

export type Tab = 'list' | 'stats' | 'assets' | 'me';
export type ListMode = 'list' | 'cal';

// Web deep-link bootstrap (?tab=stats, ?sheet=1)
// ?tab=cal / ?tab=wall predate the 4-tab reshuffle; keep them working.
const BOOT_RAW = bootParam('tab');
const BOOT_TAB: Tab | null =
  BOOT_RAW === 'cal' ? 'list' : BOOT_RAW === 'wall' ? 'me' : (['list', 'stats', 'assets', 'me'] as const).find((k) => k === BOOT_RAW) ?? null;
const BOOT_MODE: ListMode = BOOT_RAW === 'cal' ? 'cal' : 'list';
const BOOT_SHEET = bootParam('sheet') === '1';

export function useLedgerState() {
  const lang = store$.lang.get();
  const s = I18N[lang];
  const data = store$.data.get();
  const customCats = store$.customCats.get();
  const settings = store$.settings.get();
  const curLedger = store$.curLedger.get();
  const accounts = store$.accounts.get();
  const cycleStart = settings.cycleStart || 1;

  // ── core state ──
  const [anchor, setAnchor] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>(BOOT_TAB ?? 'list');
  const [listMode, setListMode] = useState<ListMode>(BOOT_MODE);
  const [sheetOpen, setSheetOpen] = useState(BOOT_SHEET);
  const [editId, setEditId] = useState<string | null>(null);
  const [sheetInitTs, setSheetInitTs] = useState<number | null>(null);
  const [sheetDupeId, setSheetDupeId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; msg: string; undo?: () => void } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchFilter, setSearchFilter] = useState<FilterState>({});
  const [markId, setMarkId] = useState<string | null>(null);
  const [burst, setBurst] = useState<number | null>(null);
  const searchRef = useRef<TextInput>(null);

  // ── derived values ──
  const liveAll = useMemo(() => data.filter((d) => !d.deletedAt), [data]);
  const cycleEntries = useMemo(
    () => liveAll.filter((d) => inCycle(d.ts, anchor, cycleStart) && (!curLedger || d.ledger === curLedger)),
    [liveAll, anchor, cycleStart, curLedger],
  );

  // Debounce search — typing stays instant; filter runs on trailing value
  useEffect(() => {
    const id = setTimeout(() => setSearchTerm(searchQ), 180);
    return () => clearTimeout(id);
  }, [searchQ]);

  const parsedSearch = useMemo(() => parseSearchQuery(searchTerm), [searchTerm]);
  const activeFilter = useMemo<FilterState>(() => ({
    ...parsedSearch.filter,
    ...searchFilter,
    io: searchFilter.io ?? parsedSearch.filter.io,
  }), [parsedSearch.filter, searchFilter]);

  const hasActiveFilters = !!(searchTerm || searchFilter.io || searchFilter.cat || searchFilter.dateFrom);

  const listEntries = useMemo(
    () =>
      hasActiveFilters
        ? liveAll.filter((d) =>
            (!curLedger || d.ledger === curLedger) &&
            matchesFilter(d, activeFilter) &&
            (!parsedSearch.text || matchesSearch(d, parsedSearch.text, customCats, lang))
          )
        : cycleEntries,
    [cycleEntries, liveAll, curLedger, hasActiveFilters, activeFilter, parsedSearch.text, customCats, lang],
  );
  const exp = useMemo(() => cycleEntries.filter((d) => d.io === 'exp').reduce((a, d) => a + d.amt, 0), [cycleEntries]);
  const inc = useMemo(() => cycleEntries.filter((d) => d.io === 'inc').reduce((a, d) => a + d.amt, 0), [cycleEntries]);
  const insight = useMemo(() => computeInsight(cycleEntries, settings, customCats, lang), [cycleEntries, settings, customCats, lang]);
  const dueInsight = useMemo(() => creditDueInsight(accounts, liveAll, lang), [accounts, liveAll, lang]);
  const streak = useMemo(() => streakDays(liveAll.map((d) => d.ts)), [liveAll]);

  // Update Android widget when budget data changes
  useEffect(() => {
    if (settings.budget > 0) {
      updateBudgetWidget(exp, settings.budget, settings.budgetMode || 'monthly');
    }
  }, [exp, settings.budget, settings.budgetMode]);

  const monthLabel = useMemo(
    () =>
      cycleRange(anchor, cycleStart).start.toLocaleDateString(
        lang === 'zh' ? 'zh-CN' : 'en-US',
        { year: 'numeric', month: 'long' },
      ),
    [anchor, cycleStart, lang],
  );

  // ── callbacks ──
  const openNew = useCallback(() => {
    tapHaptic();
    setEditId(null);
    setSheetInitTs(null);
    setSheetDupeId(null);
    setSheetOpen(true);
  }, []);
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

  const checkBudgetWarning = useCallback(() => {
    const st = store$.settings.peek();
    const data = store$.data.peek().filter((d) => !d.deletedAt);
    const entries = data.filter((d) => inCycle(d.ts, new Date(), st.cycleStart || 1));

    const monthly = monthlyStatus(entries, st);
    if (monthly.limit > 0) {
      if (monthly.over) {
        const over = fmtShort(monthly.used - monthly.limit, lang);
        setToast({ key: Date.now(), msg: s.budgetWarn100.replace('%s', over) });
        return;
      }
      if (monthly.pct >= 80) {
        const left = fmtShort(monthly.left, lang);
        setToast({ key: Date.now(), msg: s.budgetWarn80.replace('%p', String(Math.round(monthly.pct))).replace('%s', left) });
        return;
      }
    }

    const catRows = catBudgetRows(entries, st);
    for (const row of catRows) {
      if (row.over) {
        const c = catOf('exp', row.cat, store$.customCats.peek());
        const over = fmtShort(row.used - row.limit, lang);
        setToast({ key: Date.now(), msg: s.budgetWarnCat100.replace('%c', catName(c, lang)).replace('%s', over) });
        return;
      }
      if (row.pct >= 80) {
        const c = catOf('exp', row.cat, store$.customCats.peek());
        setToast({ key: Date.now(), msg: s.budgetWarnCat80.replace('%c', catName(c, lang)).replace('%p', String(Math.round(row.pct))) });
        return;
      }
    }
  }, [lang, s]);

  const onSaved = useCallback((isNew: boolean, keepOpen?: boolean, warn?: string) => {
    // A notice about the entry just saved — a stale exchange rate. Shown here
    // rather than in the sheet because the sheet is closing, and shown INSTEAD
    // of the celebration rather than under it: a warning worth reading should
    // not compete with confetti.
    if (warn) setToast({ key: Date.now(), msg: warn });
    if (!isNew) return;
    trackEvent(AnalyticsEvents.ENTRY_CREATED);
    if (keepOpen) return;
    if (warn) return;
    const sd = streakDays(store$.data.peek().filter((d) => !d.deletedAt).map((d) => d.ts));
    celebrate(sd > 1 ? s.toastStreak.replace('%d', String(sd)) : s.toastBloom);
    setTimeout(() => checkBudgetWarning(), 2000);
    const st = store$.settings.peek();
    if (st.budget > 0) {
      const entries = store$.data.peek().filter((d) => !d.deletedAt && inCycle(d.ts, new Date(), st.cycleStart || 1));
      const spent = entries.filter((d) => d.io === 'exp').reduce((a, d) => a + d.amt, 0);
      updateBudgetWidget(spent, st.budget, st.budgetMode || 'monthly');
    }
  }, [celebrate, s.toastStreak, s.toastBloom, checkBudgetWarning]);

  const openSearch = useCallback(() => {
    setTab('list');
    setSearchOpen(true);
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQ('');
    setSearchTerm('');
    setSearchFilter({});
  }, []);

  // ── web keyboard shortcuts ──
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

  return {
    // store
    lang, s, data, customCats, settings, curLedger, accounts, cycleStart,
    // state
    anchor, setAnchor,
    tab, setTab,
    listMode, setListMode,
    sheetOpen, setSheetOpen,
    editId, setEditId,
    sheetInitTs, setSheetInitTs,
    sheetDupeId, setSheetDupeId,
    detailId, setDetailId,
    toast, setToast,
    searchOpen,
    searchQ, setSearchQ,
    searchTerm,
    searchFilter, setSearchFilter,
    markId, setMarkId,
    burst, setBurst,
    searchRef,
    // derived
    liveAll, cycleEntries, listEntries,
    exp, inc, insight, dueInsight, streak, monthLabel,
    hasActiveFilters,
    // callbacks
    openNew, openNewAt, openEdit, openDuplicate,
    deleteToast, celebrate, onSaved, openSearch, closeSearch,
    shiftAnchor: useCallback((dir: 1 | -1) => setAnchor((a) => shiftCycle(a, dir, cycleStart)), [cycleStart]),
  };
}
