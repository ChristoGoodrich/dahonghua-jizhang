import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtNum } from '@/domain/money';
import { store$ } from '@/store/ledger';
import type { Entry, Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';

interface Props {
  entries: Entry[]; // already filtered to the cycle (and search)
  customCats: Record<IO, Category[]>;
  lang: Lang;
  onPress: (id: string) => void; // open the read-only detail view
  onLongPress?: (id: string) => void; // open the mark menu (reimburse/refund)
  emptyText?: string; // overrides the default empty message (e.g. "no results")
}

interface DayGroup {
  key: string;
  label: string;
  dayExp: number;
  items: Entry[];
}

function dayLabel(key: string, lang: Lang, s: typeof I18N['zh']): string {
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 864e5).toDateString();
  if (key === today) return s.today;
  if (key === yest) return s.yesterday;
  return new Date(key).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

export function EntryList({ entries, customCats, lang, onPress, onLongPress, emptyText }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const accounts = store$.accounts.peek();
  const acctName = (id?: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? (lang === 'zh' ? a.name : a.nameEn || a.name) : s.xferLabel;
  };

  const groups = useMemo<DayGroup[]>(() => {
    const sorted = [...entries].sort((a, b) => b.ts - a.ts);
    const map = new Map<string, Entry[]>();
    for (const d of sorted) {
      const k = new Date(d.ts).toDateString();
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      label: dayLabel(key, lang, s),
      dayExp: items.filter((d) => d.io === 'exp').reduce((sum, d) => sum + d.amt, 0),
      items,
    }));
  }, [entries, lang, s]);

  if (!entries.length) {
    return (
      <View style={styles.empty}>
        <Flower size={64} petal="#E0CDB8" stamen="#D6C3AC" />
        <Text style={[styles.emptyText, { color: t.inkSoft }]}>{emptyText ?? s.empty}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {groups.map((g) => (
        <View key={g.key} style={styles.group}>
          <View style={styles.dayHead}>
            <Text style={[styles.dayLabel, { color: t.inkSoft }]}>{g.label}</Text>
            <Text style={[styles.dayLabel, { color: t.inkSoft }]}>
              {s.exp} {fmt(g.dayExp, lang)}
            </Text>
          </View>
          {g.items.map((d) => {
            if (d.io === 'xfer') {
              return (
                <Pressable
                  key={d.id}
                  onPress={() => onPress(d.id)}
                  style={[styles.row, { backgroundColor: t.card }]}
                >
                  <View style={[styles.emo, { backgroundColor: t.line }]}>
                    <Text style={styles.emoText}>🔄</Text>
                  </View>
                  <View style={styles.mid}>
                    <View style={styles.catRow}>
                      <Text style={[styles.cat, { color: t.ink }]}>{s.xferLabel}</Text>
                    </View>
                    <Text style={[styles.note, { color: t.inkSoft }]} numberOfLines={1}>
                      {acctName(d.acct)} → {acctName(d.acctTo)}
                      {d.note ? ' · ' + d.note : ''}
                    </Text>
                  </View>
                  <Text style={[styles.amt, { color: t.inkSoft }]}>{fmt(d.amt, lang)}</Text>
                </Pressable>
              );
            }
            const c = catOf(d.io, d.cat, customCats);
            return (
              <Pressable
                key={d.id}
                onPress={() => onPress(d.id)}
                onLongPress={() => onLongPress?.(d.id)}
                delayLongPress={400}
                style={[styles.row, { backgroundColor: t.card }]}
              >
                <View style={[styles.emo, { backgroundColor: c.c + '22' }]}>
                  <Text style={styles.emoText}>{c.e}</Text>
                </View>
                <View style={styles.mid}>
                  <View style={styles.catRow}>
                    <Text style={[styles.cat, { color: t.ink }]}>{catName(c, lang)}</Text>
                    {d.rb === 'pending' && (
                      <View style={[styles.badge, { backgroundColor: '#F2DEC8' }]}>
                        <Text style={[styles.badgeText, { color: '#9A7B45' }]}>{s.rbPending}</Text>
                      </View>
                    )}
                    {d.rb === 'done' && (
                      <View style={[styles.badge, { backgroundColor: '#D6E8DD' }]}>
                        <Text style={[styles.badgeText, { color: t.leafDeep }]}>{s.rbDone}</Text>
                      </View>
                    )}
                    {!!d.refund && (
                      <View style={[styles.badge, { backgroundColor: '#F2D8DC' }]}>
                        <Text style={[styles.badgeText, { color: t.hibiscusDeep }]}>{s.markRefund}</Text>
                      </View>
                    )}
                  </View>
                  {!!d.note && (
                    <Text style={[styles.note, { color: t.inkSoft }]} numberOfLines={1}>
                      {d.note}
                    </Text>
                  )}
                </View>
                <Text
                  style={[styles.amt, { color: d.io === 'inc' ? t.leafDeep : t.ink }]}
                >
                  {d.io === 'exp' ? '-' : '+'}
                  {fmtNum(d.amt)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 140 },
  group: { marginTop: 14 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, paddingBottom: 6 },
  dayLabel: { fontSize: 11.5, fontWeight: '600' },
  row: {
    borderRadius: 13,
    padding: 11,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 7,
  },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  emo: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 19 },
  mid: { flex: 1, minWidth: 0 },
  cat: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 11.5, marginTop: 1 },
  amt: { fontWeight: '700', fontSize: 15 },
  empty: { alignItems: 'center', paddingVertical: 54, paddingHorizontal: 20, gap: 12 },
  emptyText: { fontSize: 13, textAlign: 'center' },
});
