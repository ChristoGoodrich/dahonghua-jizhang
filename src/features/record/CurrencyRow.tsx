import React from 'react';
import { Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { curSymbol } from '@/domain/money';

interface Props {
  cur: string; // currently selected code
  codes: string[]; // selectable codes (base first)
  onPick: (code: string) => void;
  convertedLabel?: string; // e.g. "≈ ¥72.00" when a foreign currency is active
}

/** Horizontal currency picker shown when the user has configured exchange rates. */
export function CurrencyRow({ cur, codes, onPick, convertedLabel }: Props) {
  const t = useTheme();
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.curRow}>
        {codes.map((c) => {
          const on = c === cur;
          return (
            <Pressable key={c} onPress={() => onPick(c)} style={[styles.curChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? t.hibiscus : t.inkSoft }}>{curSymbol(c)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {!!convertedLabel && <Text style={[styles.convLine, { color: t.hibiscus }]}>{convertedLabel}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  curRow: { flexGrow: 0, marginBottom: 8 },
  curChip: { borderWidth: 1.5, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 13, marginRight: 7 },
  convLine: { fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
});
