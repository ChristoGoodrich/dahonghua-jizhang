import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { cycleRange } from '@/domain/cycle';
import type { Entry } from '@/domain/types';
import { I18N, type Lang } from '@/i18n';

interface Props {
  all: Entry[];
  anchor: Date;
  cycleStart: number;
  lang: Lang;
}

interface Cell {
  key: string;
  day: number;
  n: number;
  exp: number;
  isToday: boolean;
}

export function CalendarView({ all, anchor, cycleStart, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];

  const { leading, cells } = useMemo(() => {
    const { start, end } = cycleRange(anchor, cycleStart);
    const totalDays = Math.round((end.getTime() - start.getTime()) / 864e5);
    const keyOf = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
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
      out.push({ key: k, day: cur.getDate(), n: info?.n ?? 0, exp: info?.exp ?? 0, isToday: k === todayKey });
    }
    return { leading: start.getDay(), cells: out };
  }, [all, anchor, cycleStart]);

  const dows = lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.wrap, { backgroundColor: t.card }]}>
        <View style={styles.head}>
          {dows.map((d, i) => (
            <Text key={i} style={[styles.dow, { color: t.inkSoft }]}>{d}</Text>
          ))}
        </View>
        <View style={styles.grid}>
          {Array.from({ length: leading }).map((_, i) => (
            <View key={`e${i}`} style={styles.cell} />
          ))}
          {cells.map((c) => (
            <View key={c.key} style={styles.cell}>
              <View style={[styles.inner, { backgroundColor: t.paper }]}>
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
                {c.exp > 0 && <Text style={[styles.sum, { color: t.hibiscusDeep }]}>{Math.round(c.exp)}</Text>}
              </View>
            </View>
          ))}
        </View>
      </View>
      <Text style={[styles.hint, { color: t.inkSoft }]}>{s.calHint}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 140 },
  wrap: { borderRadius: 16, padding: 16 },
  head: { flexDirection: 'row', marginBottom: 6 },
  dow: { flex: 1, textAlign: 'center', fontSize: 10.5, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 0.82, padding: 2 },
  inner: { flex: 1, borderRadius: 9, paddingTop: 4, alignItems: 'center' },
  dayNum: { fontSize: 10, fontWeight: '600' },
  todayDot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  todayNum: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 12 },
  dots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 2, gap: 1 },
  sum: { fontSize: 8.5, fontWeight: '700', marginTop: 'auto', marginBottom: 2 },
  hint: { textAlign: 'center', fontSize: 11.5, marginTop: 12 },
});
