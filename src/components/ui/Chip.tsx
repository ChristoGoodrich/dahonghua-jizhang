import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { RAD } from '@/theme/tokens';
import { Tap } from './Tap';

interface Props {
  label: string;
  on?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Dashed outline — used for "secondary group" chips (ledgers, add-new). */
  dashed?: boolean;
  size?: 'sm' | 'md';
  /** Optional leading node (emoji tile, dot…). */
  leading?: React.ReactNode;
  accessibilityLabel?: string;
}

/** The one selectable chip. Selected = accent tint fill + accent text, so the
 *  state reads at a glance instead of hanging on a 1px border change. */
export function Chip({ label, on, onPress, onLongPress, dashed, size = 'sm', leading, accessibilityLabel }: Props) {
  const t = useTheme();
  const md = size === 'md';
  return (
    <Tap
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={onLongPress ? 500 : undefined}
      scaleTo={0.94}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.chip,
        md && styles.chipMd,
        {
          borderColor: on ? t.hibiscus : t.line,
          backgroundColor: on ? t.tint : t.card,
          borderStyle: dashed ? 'dashed' : 'solid',
        },
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <Text
        style={[styles.text, md && styles.textMd, { color: on ? t.hibiscus : t.inkSoft }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Tap>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.2,
    borderRadius: RAD.pill,
    paddingVertical: 6,
    paddingHorizontal: 13,
    gap: 6,
  },
  chipMd: { paddingVertical: 8, paddingHorizontal: 16 },
  leading: { marginLeft: -3 },
  text: { fontSize: 12.5, fontWeight: '600' },
  textMd: { fontSize: 13, fontWeight: '700' },
});
