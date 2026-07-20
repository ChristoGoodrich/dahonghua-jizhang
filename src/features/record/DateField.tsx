import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Chip } from '@/components/ui/Chip';
import { Tap } from '@/components/ui/Tap';
import { RAD } from '@/theme/tokens';
import { onDay, sameDay, daysAgo, monthGrid } from '@/domain/dates';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';

interface Props {
  /** Entry timestamp; null means "now" (an un-backdated new entry). */
  ts: number | null;
  onChange: (ts: number) => void;
  lang: Lang;
}

const WEEK = { zh: ['一', '二', '三', '四', '五', '六', '日'], en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] };

/** The record sheet's date row: shows 今天/昨天/前天 or the picked date, and
 *  expands into quick chips + a compact Monday-first month grid for backdating.
 *  Plain wrapped Views (no nested vertical scroll — same rule as EmojiPicker). */
export function DateField({ ts, onChange, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  // null = collapsed; {y,m} = the month shown in the expanded grid
  const [view, setView] = useState<{ y: number; m: number } | null>(null);

  const ago = ts === null ? 0 : daysAgo(ts);
  const label =
    ago === 0 ? s.today
    : ago === 1 ? s.yesterday
    : ago === 2 ? s.dayBefore
    : new Date(ts!).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'short', day: 'numeric', weekday: 'short',
        year: new Date(ts!).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
      });

  function toggle() {
    if (view) return setView(null);
    const d = ts === null ? new Date() : new Date(ts);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }

  function pickAgo(k: number) {
    const d = new Date();
    d.setDate(d.getDate() - k);
    onChange(onDay(ts ?? new Date().getTime(),d.getFullYear(), d.getMonth(), d.getDate()));
    setView(null);
  }

  function pickDay(day: number) {
    if (!view) return;
    onChange(onDay(ts ?? new Date().getTime(),view.y, view.m, day));
    setView(null);
  }

  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const todayStart = new Date(curY, curM, now.getDate()).getTime();
  const atCurrentMonth = view ? view.y === curY && view.m === curM : true;

  function shiftMonth(dir: number) {
    if (!view) return;
    const d = new Date(view.y, view.m + dir, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.chipRow}>
        <Chip
          leading={<Text style={styles.emoji}>📅</Text>}
          label={label}
          on={view !== null || ago !== 0}
          onPress={toggle}
          accessibilityLabel={s.pickDate}
        />
        {view !== null && (
          <>
            <Chip label={s.today} on={ago === 0} onPress={() => pickAgo(0)} />
            <Chip label={s.yesterday} on={ago === 1} onPress={() => pickAgo(1)} />
            <Chip label={s.dayBefore} on={ago === 2} onPress={() => pickAgo(2)} />
          </>
        )}
      </View>

      {view !== null && (
        <View style={[styles.grid, { backgroundColor: t.card, borderColor: t.line }]}>
          <View style={styles.gridHead}>
            <Tap onPress={() => shiftMonth(-1)} hitSlop={8} scaleTo={0.88} accessibilityRole="button" accessibilityLabel={s.a11yMonthPrev} style={styles.nav}>
              <Text style={[styles.navText, { color: t.hibiscus }]}>‹</Text>
            </Tap>
            <Text style={[styles.gridTitle, { color: t.ink }]}>
              {lang === 'zh'
                ? `${view.y}年${view.m + 1}月`
                : new Date(view.y, view.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </Text>
            <Tap onPress={() => shiftMonth(1)} disabled={atCurrentMonth} hitSlop={8} scaleTo={0.88} accessibilityRole="button" accessibilityLabel={s.a11yMonthNext} style={[styles.nav, atCurrentMonth && styles.navOff]}>
              <Text style={[styles.navText, { color: t.hibiscus }]}>›</Text>
            </Tap>
          </View>
          <View style={styles.cells}>
            {WEEK[lang].map((w, i) => (
              <View key={'w' + i} style={styles.cell}>
                <Text style={[styles.weekText, { color: t.inkSoft }]}>{w}</Text>
              </View>
            ))}
            {monthGrid(view.y, view.m).map((day, i) => {
              if (day === null) return <View key={'b' + i} style={styles.cell} />;
              const cellStart = new Date(view.y, view.m, day).getTime();
              const future = cellStart > todayStart;
              const isToday = cellStart === todayStart;
              const selected = ts !== null ? sameDay(cellStart, ts) : isToday;
              return (
                <View key={'d' + day} style={styles.cell}>
                  <Tap
                    onPress={() => pickDay(day)}
                    disabled={future}
                    scaleTo={0.88}
                    accessibilityRole="button"
                    accessibilityLabel={`${view.m + 1}/${day}`}
                    accessibilityState={{ selected, disabled: future }}
                    style={[
                      styles.dayBtn,
                      selected && { backgroundColor: t.hibiscus },
                      !selected && isToday && { borderWidth: 1.2, borderColor: t.hibiscus },
                    ]}
                  >
                    <Text style={[styles.dayText, { color: selected ? '#fff' : future ? t.line : t.ink }]}>{day}</Text>
                  </Tap>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  emoji: { fontSize: 13 },
  grid: { borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.sm, padding: 10, marginTop: 8 },
  gridHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  gridTitle: { fontSize: 13.5, fontWeight: '700' },
  nav: { paddingHorizontal: 12, paddingVertical: 2 },
  navOff: { opacity: 0.3 },
  navText: { fontSize: 20, fontWeight: '700' },
  cells: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  weekText: { fontSize: 10.5, fontWeight: '700' },
  dayBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 12.5, fontWeight: '600' },
});
