import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Animated } from 'react-native';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
import { Flower } from '@/components/Flower';

/** Day panel eases in whenever a different day is selected (remount by key). */
function PanelFade({ children }: { children: React.ReactNode }) {
  const v = useAnimatedValue(0);
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [v]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
import { cycleRange } from '@/domain/cycle';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtNum } from '@/domain/money';
import type { Category, Entry, IO } from '@/domain/types';
import { I18N, type Lang } from '@/i18n';

interface Props {
  all: Entry[];
  anchor: Date;
  cycleStart: number;
  customCats: Record<IO, Category[]>;
  lang: Lang;
  /** 补记这天 — open a new entry pre-dated to the tapped day (noon). */
  onAddDay?: (ts: number) => void;
}

interface Cell {
  key: string;
  day: number;
  n: number;
  exp: number;
  isToday: boolean;
  future: boolean;
}

const keyOf = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;

export function CalendarView({ all, anchor, cycleStart, customCats, lang, onAddDay }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const [selected, setSelected] = useState<string | null>(null);

  const { leading, cells } = useMemo(() => {
    const { start, end } = cycleRange(anchor, cycleStart);
    const totalDays = Math.round((end.getTime() - start.getTime()) / 864e5);
    const map = new Map<string, { n: number; exp: number }>();
    for (const d of all) {
      if (d.ts < start.getTime() || d.ts >= end.getTime() || d.deletedAt) continue;
      const k = keyOf(new Date(d.ts));
      const cur = map.get(k) ?? { n: 0, exp: 0 };
      cur.n++;
      if (d.io === 'exp') cur.exp += d.amt;
      map.set(k, cur);
    }
    const todayKey = keyOf(new Date());
    const out: Cell[] = [];
    for (let i = 0; i < totalDays; i++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = keyOf(cur);
      const info = map.get(k);
      out.push({ key: k, day: cur.getDate(), n: info?.n ?? 0, exp: info?.exp ?? 0, isToday: k === todayKey, future: cur.getTime() > new Date().getTime() });
    }
    return { leading: start.getDay(), cells: out };
  }, [all, anchor, cycleStart]);

  const dayEntries = useMemo(
    () =>
      selected
        ? all.filter((d) => !d.deletedAt && keyOf(new Date(d.ts)) === selected).sort((a, b) => b.ts - a.ts)
        : [],
    [all, selected],
  );
  const dayExp = dayEntries.filter((d) => d.io === 'exp').reduce((sum, d) => sum + d.amt, 0);
  const selDate = selected ? selected.split('-').map(Number) : null;
  const selLabel = selDate
    ? new Date(selDate[0], selDate[1], selDate[2]).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      })
    : '';
  // no backfilling into the future (mirrors the record sheet's date grid)
  const selFuture = selDate
    ? new Date(selDate[0], selDate[1], selDate[2]).getTime() >
      new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()
    : false;

  const dows = lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.wrap, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'sm')]}>
        <View style={styles.head}>
          {dows.map((d, i) => (
            <Text key={i} style={[styles.dow, { color: t.inkSoft }]}>{d}</Text>
          ))}
        </View>
        <View style={styles.grid}>
          {Array.from({ length: leading }).map((_, i) => (
            <View key={`e${i}`} style={styles.cell} />
          ))}
          {cells.map((c) => {
            const on = c.key === selected;
            return (
              <Pressable
                key={c.key}
                style={styles.cell}
                onPress={() => setSelected((p) => (p === c.key ? null : c.key))}
                // empty past days stay tappable when 补记这天 is available —
                // backfilling matters most on days with nothing recorded
                disabled={c.n === 0 && !c.isToday && (!onAddDay || c.future)}
              >
                <View style={[styles.inner, { backgroundColor: on ? t.tint : t.paper, borderColor: on ? t.hibiscus : 'transparent' }]}>
                  {c.isToday ? (
                    <View style={[styles.todayDot, { backgroundColor: t.hibiscus }]}>
                      <Text style={styles.todayNum}>{c.day}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.dayNum, { color: t.inkSoft }]}>{c.day}</Text>
                  )}
                  <View style={styles.dots}>
                    {Array.from({ length: Math.min(c.n, 3) }).map((_, i) => (
                      <Flower key={i} size={9} />
                    ))}
                  </View>
                  {c.exp > 0 && <Text style={[styles.sum, TABULAR, { color: t.hibiscusDeep }]}>{Math.round(c.exp)}</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {selected ? (
        <PanelFade key={selected}>
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={[styles.panelDate, { color: t.ink }]}>{selLabel}</Text>
            {dayExp > 0 && <Text style={[styles.panelSum, { color: t.inkSoft }]}>{s.exp} {fmt(dayExp, lang)}</Text>}
          </View>
          {dayEntries.length === 0 ? (
            <Text style={[styles.hint, { color: t.inkSoft }]}>{s.empty}</Text>
          ) : (
            dayEntries.map((d) => {
              const isXfer = d.io === 'xfer';
              const c = isXfer ? null : catOf(d.io, d.cat, customCats);
              return (
                <View key={d.id} style={[styles.row, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
                  <View style={[styles.emo, { backgroundColor: isXfer ? t.line : c!.c + '22' }]}>
                    <Text style={styles.emoText}>{isXfer ? '🔄' : c!.e}</Text>
                  </View>
                  <View style={styles.mid}>
                    <Text style={[styles.cat, { color: t.ink }]} numberOfLines={1}>
                      {isXfer ? s.xferLabel : catName(c!, lang)}
                    </Text>
                    {!!d.note && <Text style={[styles.note, { color: t.inkSoft }]} numberOfLines={1}>{d.note}</Text>}
                  </View>
                  <Text style={[styles.amt, { color: d.io === 'inc' ? t.leafDeep : isXfer ? t.inkSoft : t.ink }]}>
                    {isXfer ? '' : d.io === 'inc' ? '+' : '-'}{fmtNum(d.amt)}
                  </Text>
                </View>
              );
            })
          )}
          {!!onAddDay && !!selDate && !selFuture && (
            <Pressable
              onPress={() => onAddDay(new Date(selDate[0], selDate[1], selDate[2], 12).getTime())}
              accessibilityRole="button"
              accessibilityLabel={s.calAddHere}
              style={[styles.addDay, { borderColor: t.line, backgroundColor: t.paperWarm }]}
            >
              <Text style={[styles.addDayText, { color: t.hibiscus }]}>＋ {s.calAddHere}</Text>
            </Pressable>
          )}
        </View>
        </PanelFade>
      ) : (
        <Text style={[styles.hint, { color: t.inkSoft }]}>{s.calHint}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 140 },
  wrap: { borderRadius: RAD.lg, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  head: { flexDirection: 'row', marginBottom: 6 },
  dow: { flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 0.82, padding: 2 },
  inner: { flex: 1, borderRadius: RAD.xs, paddingTop: 4, alignItems: 'center', borderWidth: 1.2 },
  dayNum: { fontSize: 10, fontWeight: '600' },
  todayDot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  todayNum: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 12 },
  dots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 2, gap: 1 },
  sum: { fontSize: 8.5, fontWeight: '700', marginTop: 'auto', marginBottom: 2 },
  hint: { textAlign: 'center', fontSize: 11.5, marginTop: 12 },
  panel: { marginTop: 14 },
  addDay: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 11, alignItems: 'center', marginTop: 2 },
  addDayText: { fontSize: 12.5, fontWeight: '600' },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 },
  panelDate: { fontSize: 14, fontWeight: '700' },
  panelSum: { fontSize: 12, fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RAD.md, borderWidth: StyleSheet.hairlineWidth,
    padding: 11, paddingHorizontal: 13, marginBottom: 8,
  },
  emo: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 18 },
  mid: { flex: 1, minWidth: 0 },
  cat: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 11.5, marginTop: 2 },
  amt: { fontWeight: '700', fontSize: 15, ...TABULAR },
});
