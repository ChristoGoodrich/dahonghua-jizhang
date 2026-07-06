import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Chip } from '@/components/ui/Chip';
import { Tap } from '@/components/ui/Tap';
import { RAD } from '@/theme/tokens';
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
        {EMOJI_GROUPS.map((g, i) => (
          <Chip key={g.key} label={lang === 'zh' ? g.zh : g.en} on={i === active} onPress={() => setActive(i)} />
        ))}
      </ScrollView>
      <View style={styles.grid}>
        {group.emojis.map((e) => {
          const on = e === value;
          return (
            <Tap
              key={e}
              onPress={() => onPick(e)}
              scaleTo={0.88}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={e}
              style={[styles.cell, { backgroundColor: on ? t.tint : t.card, borderColor: on ? t.hibiscus : t.line }]}
            >
              <Text style={styles.emoji}>{e}</Text>
            </Tap>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  cell: { width: 40, height: 40, borderRadius: RAD.xs, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 20 },
});
