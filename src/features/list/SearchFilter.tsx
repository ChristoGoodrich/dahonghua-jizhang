import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Chip } from '@/components/ui/Chip';
import { allCats, catName } from '@/domain/cats';
import type { Category, IO } from '@/domain/types';
import type { FilterState } from '@/domain/filter';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';

interface Props {
  lang: Lang;
  customCats: Record<IO, Category[]>;
  filter: FilterState;
  onChange: (filter: FilterState) => void;
}

const IO_OPTIONS: { key: IO; zh: string; en: string }[] = [
  { key: 'exp', zh: '支出', en: 'Expense' },
  { key: 'inc', zh: '收入', en: 'Income' },
  { key: 'xfer', zh: '转账', en: 'Transfer' },
];

const DATE_PRESETS: { key: string; zh: string; en: string }[] = [
  { key: 'today', zh: '今天', en: 'Today' },
  { key: 'yesterday', zh: '昨天', en: 'Yesterday' },
  { key: 'this week', zh: '本周', en: 'This week' },
  { key: 'last week', zh: '上周', en: 'Last week' },
  { key: 'this month', zh: '本月', en: 'This month' },
  { key: 'last month', zh: '上月', en: 'Last month' },
];

export function SearchFilter({ lang, customCats, filter, onChange }: Props) {
  const t = useTheme();
  const s = I18N[lang];

  function toggleIO(io: IO) {
    onChange({ ...filter, io: filter.io === io ? undefined : io });
  }

  function toggleCat(cat: string) {
    onChange({ ...filter, cat: filter.cat === cat ? undefined : cat });
  }

  function setDatePreset(key: string) {
    const now = new Date();
    let from: number, to: number;

    switch (key) {
      case 'today':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
        break;
      case 'yesterday':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59).getTime();
        break;
      case 'this week': {
        const day = now.getDay() || 7;
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1).getTime();
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - day), 23, 59, 59).getTime();
        break;
      }
      case 'last week': {
        const day = now.getDay() || 7;
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - 6).getTime();
        to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 23, 59, 59).getTime();
        break;
      }
      case 'this month':
        from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime();
        break;
      case 'last month':
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
        to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).getTime();
        break;
      default:
        return;
    }

    // Toggle off if same preset
    if (filter.dateFrom === from && filter.dateTo === to) {
      onChange({ ...filter, dateFrom: undefined, dateTo: undefined });
    } else {
      onChange({ ...filter, dateFrom: from, dateTo: to });
    }
  }

  function clearFilters() {
    onChange({});
  }

  const hasFilters = filter.io || filter.cat || filter.dateFrom;

  return (
    <View style={styles.wrap}>
      {/* IO type chips */}
      <View style={styles.section}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {IO_OPTIONS.map((opt) => (
            <Chip
              key={opt.key}
              label={lang === 'zh' ? opt.zh : opt.en}
              on={filter.io === opt.key}
              onPress={() => toggleIO(opt.key)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Date presets */}
      <View style={styles.section}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {DATE_PRESETS.map((preset) => (
            <Chip
              key={preset.key}
              label={lang === 'zh' ? preset.zh : preset.en}
              on={false}
              onPress={() => setDatePreset(preset.key)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Category chips (only show when searching) */}
      {filter.io && (
        <View style={styles.section}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {allCats(filter.io, customCats).map((c) => (
              <Chip
                key={c.k}
                label={`${c.e} ${catName(c, lang)}`}
                on={filter.cat === c.k}
                onPress={() => toggleCat(c.k)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Clear filters */}
      {hasFilters && (
        <Pressable onPress={clearFilters} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel={s.clearFilters}>
          <Text style={[styles.clearText, { color: t.hibiscus }]}>{s.clearFilters || '清除筛选'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 4, paddingBottom: 8 },
  section: { marginBottom: 6 },
  clearBtn: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 8 },
  clearText: { fontSize: 12, fontWeight: '600' },
});
