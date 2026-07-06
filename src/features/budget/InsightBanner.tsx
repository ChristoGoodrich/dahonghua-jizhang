import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { RAD } from '@/theme/tokens';
import type { Insight } from '@/domain/insight';

export function InsightBanner({ insight }: { insight: Insight | null }) {
  const t = useTheme();
  if (!insight) return null;
  // stamen (marigold) tint — reads as a gentle notice in every theme & mode
  return (
    <View style={[styles.box, { backgroundColor: t.stamen + (t.isDark ? '1F' : '17'), borderColor: t.stamen + '3D' }]}>
      <Text style={styles.ic}>{insight.ic}</Text>
      <Text style={[styles.tx, { color: t.isDark ? '#C9BCA8' : '#7A6A55' }]}>{insight.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: 22, marginTop: 12,
    borderWidth: 1, borderRadius: RAD.sm,
    padding: 12, paddingHorizontal: 14,
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
  },
  ic: { fontSize: 18, lineHeight: 22 },
  tx: { flex: 1, fontSize: 12.5, lineHeight: 18 },
});
