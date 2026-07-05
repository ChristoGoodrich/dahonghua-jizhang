import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { Tap } from '@/components/ui/Tap';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
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
  dayInc: number;
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
      dayInc: items.filter((d) => d.io === 'inc').reduce((sum, d) => sum + d.amt, 0),
      items,
    }));
  }, [entries, lang, s]);

  // reimburse/refund badges — alpha tints over the card so they hold up in dark mode
  const badgeTones = {
    pending: { bg: t.stamen + '2E', fg: t.isDark ? t.stamen : '#9A7B45' },
    done: { bg: t.leaf + '30', fg: t.leafDeep },
    refund: { bg: t.hibiscus + '26', fg: t.isDark ? t.hibiscusSoft : t.hibiscusDeep },
  };

  const Badge = ({ tone, text }: { tone: keyof typeof badgeTones; text: string }) => (
    <View style={[styles.badge, { backgroundColor: badgeTones[tone].bg }]}>
      <Text style={[styles.badgeText, { color: badgeTones[tone].fg }]}>{text}</Text>
    </View>
  );

  if (!entries.length) {
    return (
      <View style={styles.empty}>
        <View style={[styles.emptyDisc, { backgroundColor: t.paperWarm }]}>
          <Flower size={56} petal="#E0CDB8" stamen="#D6C3AC" />
        </View>
        <Text style={[styles.emptyText, { color: t.inkSoft }]}>{emptyText ?? s.empty}</Text>
      </View>
    );
  }

  const rowStyle = [
    styles.row,
    { backgroundColor: t.card, borderColor: t.line },
    shadow(t, 'xs'),
  ];

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
            <Text style={[styles.dayLabel, TABULAR, { color: t.inkSoft }]}>
              {/* income-only days (payday!) show the inflow instead of a ¥0 outflow */}
              {g.dayExp > 0 || g.dayInc === 0
                ? `${s.exp} ${fmt(g.dayExp, lang)}`
                : `${s.inc} ${fmt(g.dayInc, lang)}`}
            </Text>
          </View>
          {g.items.map((d) => {
            if (d.io === 'xfer') {
              return (
                <Tap key={d.id} onPress={() => onPress(d.id)} scaleTo={0.98} style={rowStyle}>
                  <View style={[styles.emo, { backgroundColor: t.paperWarm }]}>
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
                  <Text style={[styles.amt, TABULAR, { color: t.inkSoft }]}>{fmt(d.amt, lang)}</Text>
                </Tap>
              );
            }
            const c = catOf(d.io, d.cat, customCats);
            return (
              <Tap
                key={d.id}
                onPress={() => onPress(d.id)}
                onLongPress={() => onLongPress?.(d.id)}
                delayLongPress={400}
                scaleTo={0.98}
                style={rowStyle}
              >
                <View style={[styles.emo, { backgroundColor: c.c + (t.isDark ? '30' : '1F') }]}>
                  <Text style={styles.emoText}>{c.e}</Text>
                </View>
                <View style={styles.mid}>
                  <View style={styles.catRow}>
                    <Text style={[styles.cat, { color: t.ink }]}>{catName(c, lang)}</Text>
                    {d.rb === 'pending' && <Badge tone="pending" text={s.rbPending} />}
                    {d.rb === 'done' && <Badge tone="done" text={s.rbDone} />}
                    {!!d.refund && <Badge tone="refund" text={s.markRefund} />}
                  </View>
                  {!!d.note && (
                    <Text style={[styles.note, { color: t.inkSoft }]} numberOfLines={1}>
                      {d.note}
                    </Text>
                  )}
                </View>
                <Text
                  style={[styles.amt, TABULAR, { color: d.io === 'inc' ? t.leafDeep : t.ink }]}
                >
                  {d.io === 'exp' ? '-' : '+'}
                  {fmtNum(d.amt)}
                </Text>
              </Tap>
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
  group: { marginTop: 16 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 7 },
  dayLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  row: {
    borderRadius: RAD.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderRadius: RAD.pill, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  emo: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 19 },
  mid: { flex: 1, minWidth: 0 },
  cat: { fontSize: 14.5, fontWeight: '600' },
  note: { fontSize: 11.5, marginTop: 2 },
  amt: { fontWeight: '700', fontSize: 15.5, letterSpacing: -0.2 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 20, gap: 14 },
  emptyDisc: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { fontSize: 13, textAlign: 'center' },
});
