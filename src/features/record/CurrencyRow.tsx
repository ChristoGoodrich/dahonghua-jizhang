import React from 'react';
import { Text, ScrollView, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Chip } from '@/components/ui/Chip';
import { TABULAR } from '@/theme/tokens';
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
        <View style={styles.inner}>
          {codes.map((c) => (
            <Chip key={c} label={curSymbol(c)} on={c === cur} onPress={() => onPick(c)} />
          ))}
        </View>
      </ScrollView>
      {!!convertedLabel && <Text style={[styles.convLine, TABULAR, { color: t.hibiscus }]}>{convertedLabel}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  curRow: { flexGrow: 0, marginBottom: 8 },
  inner: { flexDirection: 'row', gap: 7, paddingVertical: 2 },
  convLine: { fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
});
