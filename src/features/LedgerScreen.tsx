import React, { useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { useResponsive } from '@/hooks/useResponsive';
import { useTheme } from '@/theme/ThemeContext';
import { BottomNav, useNavBottomPad } from '@/features/nav/BottomNav';
import { RecordSheet } from '@/features/record/RecordSheet';
import { MarkSheet } from '@/features/record/MarkSheet';
import { DetailSheet } from '@/features/record/DetailSheet';
import { Toast } from '@/components/Toast';
import { PetalBurst } from '@/components/PetalBurst';
import { useLedgerState } from '@/features/hooks/useLedgerState';
import { LedgerHeader } from '@/features/LedgerHeader';
import { LedgerContent } from '@/features/LedgerContent';
import { markStart, markEnd } from '@/util/perf';

export const LedgerScreen = observer(function LedgerScreen() {
  const t = useTheme();
  const renderMarked = useRef(false);
  if (!renderMarked.current) {
    markStart('LedgerScreen');
    renderMarked.current = true;
  }
  const navPad = useNavBottomPad();
  const responsive = useResponsive();
  const state = useLedgerState();
  const { toast } = state;

  React.useEffect(() => {
    const ms = markEnd('LedgerScreen');
    if (__DEV__ && ms > 0) console.log(`[perf] LedgerScreen render: ${ms.toFixed(1)}ms`);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: t.paper }, Platform.OS === 'web' && styles.rootWeb]}>
      <SafeAreaView edges={['top']} style={[styles.safe, { maxWidth: responsive.maxContentWidth }]}>
        <LedgerHeader
          title={state.s.title}
          sub={state.s.sub}
          a11ySearch={state.s.a11ySearch}
          a11yClearSearch={state.s.a11yClearSearch}
          a11yListToggle={state.s.a11yListToggle}
          a11yCalToggle={state.s.a11yCalToggle}
          searchPh={state.s.searchPh}
          lang={state.lang}
          customCats={state.customCats}
          tab={state.tab}
          listMode={state.listMode}
          setListMode={state.setListMode}
          searchOpen={state.searchOpen}
          searchQ={state.searchQ}
          setSearchQ={state.setSearchQ}
          searchFilter={state.searchFilter}
          setSearchFilter={state.setSearchFilter}
          onSearchToggle={state.searchOpen ? state.closeSearch : state.openSearch}
          onClearSearch={state.closeSearch}
          searchRef={state.searchRef}
        />

        <LedgerContent
          tab={state.tab}
          listMode={state.listMode}
          searchQ={state.searchQ}
          searchTerm={state.searchTerm}
          lang={state.lang}
          customCats={state.customCats}
          columns={responsive.columns}
          listEntries={state.listEntries}
          cycleEntries={state.cycleEntries}
          liveAll={state.liveAll}
          anchor={state.anchor}
          cycleStart={state.cycleStart}
          monthLabel={state.monthLabel}
          exp={state.exp}
          inc={state.inc}
          insight={state.insight}
          dueInsight={state.dueInsight}
          settings={state.settings}
          streak={state.streak}
          a11yMonthPrev={state.s.a11yMonthPrev}
          a11yMonthNext={state.s.a11yMonthNext}
          noResult={state.s.noResult}
          noResultHint={state.s.noResultHint}
          statsMore={state.s.statsMore}
          insightsTitle={state.s.insightsTitle}
          reportTitle={state.s.reportTitle}
          setReview={state.s.setReview}
          setDetailId={state.setDetailId}
          setMarkId={state.setMarkId}
          celebrate={state.celebrate}
          toastBloom={state.s.toastBloom}
          onPrev={() => state.shiftAnchor(-1)}
          onNext={() => state.shiftAnchor(1)}
          onNewAt={state.openNewAt}
        />
      </SafeAreaView>

      <BottomNav active={state.tab} onChange={state.setTab} onAdd={state.openNew} lang={state.lang} />

      <RecordSheet
        visible={state.sheetOpen}
        editId={state.editId}
        initialTs={state.sheetInitTs}
        dupeId={state.sheetDupeId}
        lang={state.lang}
        customCats={state.customCats}
        onClose={() => state.setSheetOpen(false)}
        onSaved={state.onSaved}
        onTemplateSaved={() => state.setToast({ key: Date.now(), msg: state.s.tmplSaved })}
        onDeleted={state.deleteToast}
      />

      <MarkSheet
        entryId={state.markId}
        lang={state.lang}
        customCats={state.customCats}
        onClose={() => state.setMarkId(null)}
        onEdit={state.openEdit}
      />

      <DetailSheet
        entryId={state.detailId}
        lang={state.lang}
        customCats={state.customCats}
        onClose={() => state.setDetailId(null)}
        onEdit={state.openEdit}
        onDuplicate={state.openDuplicate}
        onDeleted={state.deleteToast}
      />

      {state.burst != null && <PetalBurst key={`b${state.burst}`} seed={state.burst} onDone={() => state.setBurst(null)} />}

      {toast && (
        <Toast
          key={`t${toast.key}`}
          bottom={navPad + 88}
          message={toast.msg}
          actionLabel={toast.undo ? state.s.undo : undefined}
          onAction={
            toast.undo
              ? () => {
                  toast.undo?.();
                  state.setToast(null);
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
});
