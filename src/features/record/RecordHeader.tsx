import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { shadow, RAD } from '@/theme/tokens';
import type { Theme } from '@/theme/tokens';
import type { IO } from '@/domain/types';
import type { Strings } from '@/i18n';

interface Props {
  io: IO;
  onPickIO: (next: IO) => void;
  t: Theme;
  s: Strings;
}

export function RecordHeader({ io, onPickIO, t, s }: Props) {
  return (
    <>
      <View style={[styles.grip, { backgroundColor: t.line }]} />
      <View style={[styles.toggle, { backgroundColor: t.isDark ? '#151312' : t.paperWarm, borderColor: t.line }]}>
        {(['exp', 'inc', 'xfer'] as IO[]).map((k) => (
          <Pressable
            key={k}
            onPress={() => onPickIO(k)}
            style={[
              styles.toggleBtn,
              io === k && [styles.toggleOn, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')],
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: io === k }}
            accessibilityLabel={k === 'exp' ? s.exp : k === 'inc' ? s.inc : s.xfer}
          >
            <Text
              style={[
                styles.toggleText,
                { color: io === k ? (k === 'inc' ? t.leafDeep : k === 'exp' ? t.hibiscus : t.ink) : t.inkSoft },
              ]}
            >
              {k === 'exp' ? s.exp : k === 'inc' ? s.inc : s.xfer}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  grip: { width: 40, height: 4.5, borderRadius: 4, alignSelf: 'center', marginBottom: 12 },
  toggle: {
    flexDirection: 'row', borderRadius: RAD.sm, padding: 3, marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: RAD.sm - 3, alignItems: 'center' },
  toggleOn: { borderWidth: StyleSheet.hairlineWidth },
  toggleText: { fontSize: 13.5, fontWeight: '700' },
});
