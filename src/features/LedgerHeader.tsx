import React from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { useResponsive } from '@/hooks/useResponsive';
import { Flower } from '@/components/Flower';
import { SearchFilter } from '@/features/list/SearchFilter';
import { NavIcon } from '@/features/nav/NavIcon';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { shadow } from '@/theme/tokens';
import type { Lang } from '@/i18n';
import type { ListMode } from '@/features/hooks/useLedgerState';
import type { FilterState } from '@/domain/filter';

export function LedgerHeader(props: {
  title: string;
  sub?: string;
  a11ySearch: string;
  a11yClearSearch: string;
  a11yListToggle: string;
  a11yCalToggle: string;
  searchPh: string;
  lang: Lang;
  customCats: any;
  tab: string;
  listMode: ListMode;
  setListMode: (fn: (m: ListMode) => ListMode) => void;
  searchOpen: boolean;
  searchQ: string;
  setSearchQ: (q: string) => void;
  searchFilter: FilterState;
  setSearchFilter: (f: FilterState) => void;
  onSearchToggle: () => void;
  onClearSearch: () => void;
  searchRef: React.RefObject<TextInput | null>;
}) {
  const {
    title, sub, a11ySearch, a11yClearSearch, a11yListToggle, a11yCalToggle,
    searchPh, lang, customCats, tab, listMode, setListMode,
    searchOpen, searchQ, setSearchQ, searchFilter, setSearchFilter,
    onSearchToggle, onClearSearch, searchRef,
  } = props;
  const t = useTheme();
  const responsive = useResponsive();

  return (
    <>
      <View style={s.top}>
        <View style={s.brand}>
          <Flower size={34} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
          <View>
            <Text style={[s.title, { color: t.ink, fontSize: responsive.fontSize.title }]}>{title}</Text>
            {!!sub && <Text style={[s.sub, { color: t.hibiscus }]}>{sub}</Text>}
          </View>
        </View>
        <View style={s.topBtns}>
          <Tap
            style={[s.iconBtn, { borderColor: t.line, backgroundColor: t.card }]}
            onPress={onSearchToggle}
            accessibilityRole="button"
            accessibilityLabel={a11ySearch}
          >
            <Icon name="search" color={searchOpen ? t.hibiscus : t.inkSoft} size={17} />
          </Tap>
          {tab === 'list' && (
            <Tap
              testID="nav-cal"
              style={[
                s.iconBtn,
                { borderColor: listMode === 'cal' ? t.hibiscus : t.line, backgroundColor: listMode === 'cal' ? t.tint : t.card },
              ]}
              onPress={() => setListMode((m) => (m === 'cal' ? 'list' : 'cal'))}
              accessibilityRole="button"
              accessibilityState={{ selected: listMode === 'cal' }}
              accessibilityLabel={listMode === 'cal' ? a11yListToggle : a11yCalToggle}
            >
              <NavIcon name={listMode === 'cal' ? 'list' : 'cal'} color={listMode === 'cal' ? t.hibiscus : t.inkSoft} size={18} />
            </Tap>
          )}
        </View>
      </View>

      {searchOpen && tab === 'list' && listMode === 'list' && (
        <View style={s.searchWrap}>
          <View style={[s.searchBar, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
            <Icon name="search" color={t.inkSoft} size={17} />
            <TextInput
              ref={searchRef}
              style={[s.searchInput, { color: t.ink }]}
              value={searchQ}
              onChangeText={setSearchQ}
              placeholder={searchPh}
              placeholderTextColor={t.inkSoft}
              autoFocus
              accessibilityLabel={a11ySearch}
            />
            <Pressable onPress={searchQ ? () => setSearchQ('') : onClearSearch} hitSlop={8} accessibilityRole="button" accessibilityLabel={a11yClearSearch}>
              <View style={[s.searchClear, { backgroundColor: t.line }]}>
                <Icon name="close" color={t.inkSoft} size={11} strokeWidth={2.4} />
              </View>
            </Pressable>
          </View>
          <SearchFilter lang={lang} customCats={customCats} filter={searchFilter} onChange={setSearchFilter} />
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  top: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: 0.4 },
  sub: { fontSize: 10, letterSpacing: 3, fontWeight: '700', marginTop: 1 },
  topBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  searchWrap: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 4 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 999,
    paddingVertical: 10, paddingHorizontal: 15,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  searchClear: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
});
