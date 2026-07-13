import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { RAD } from '@/theme/tokens';
import type { Insight } from '@/domain/insight';

export function InsightBanner({ insight, onPress }: { insight: Insight | null; onPress?: () => void }) {
  const t = useTheme();
  if (!insight) return null;
  const fg = t.isDark ? '#C9BCA8' : '#7A6A55';
  // stamen (marigold) tint — reads as a gentle notice in every theme & mode
  return (
    <Tap
      onPress={onPress}
      disabled={!onPress}
      scaleTo={0.985}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={insight.text}
      style={[styles.box, { backgroundColor: t.stamen + (t.isDark ? '1F' : '17'), borderColor: t.stamen + '3D' }]}
    >
      <Text style={styles.ic}>{insight.ic}</Text>
      <Text style={[styles.tx, { color: fg }]}>{insight.text}</Text>
      {!!onPress && <Icon name="chevR" color={fg} size={14} strokeWidth={2} />}
    </Tap>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: 22, marginTop: 12,
    borderWidth: 1, borderRadius: RAD.sm,
    padding: 12, paddingHorizontal: 14,
    flexDirection: 'row', gap: 10, alignItems: 'center',
  },
  ic: { fontSize: 18, lineHeight: 22 },
  tx: { flex: 1, fontSize: 12.5, lineHeight: 18 },
});
