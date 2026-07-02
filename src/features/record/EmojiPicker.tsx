import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { EMOJI_GROUPS } from '@/domain/emoji';
import type { Lang } from '@/i18n';

interface Props {
  value: string;
  onPick: (emoji: string) => void;
  lang: Lang;
}

/**
 * Grouped emoji picker: a horizontal group selector + a wrapped grid of the
 * active group. Uses a wrapped View (not a vertical ScrollView) so it nests
 * cleanly inside the record sheet's scroll without scroll conflicts.
 */
export function EmojiPicker({ value, onPick, lang }: Props) {
  const t = useTheme();
  const [active, setActive] = useState(0);
  const group = EMOJI_GROUPS[active];

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.tabsRow} contentContainerStyle={styles.tabsInner}>
        {EMOJI_GROUPS.map((g, i) => {
          const on = i === active;
          return (
            <Pressable key={g.key} onPress={() => setActive(i)} style={[styles.tab, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: on ? t.hibiscus : t.inkSoft }}>{lang === 'zh' ? g.zh : g.en}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.grid}>
        {group.emojis.map((e) => {
          const on = e === value;
          return (
            <Pressable
              key={e}
              onPress={() => onPick(e)}
              style={[styles.cell, { backgroundColor: on ? t.paperWarm : t.card, borderColor: on ? t.hibiscus : t.line }]}
            >
              <Text style={styles.emoji}>{e}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  tabsRow: { flexGrow: 0 },
  tabsInner: { gap: 6, paddingVertical: 2 },
  tab: { borderWidth: 1.5, borderRadius: 15, paddingVertical: 5, paddingHorizontal: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  cell: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 20 },
});
