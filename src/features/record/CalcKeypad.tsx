import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { RAD, TABULAR } from '@/theme/tokens';
import { I18N, type Lang } from '@/i18n';

interface Props {
  onKey: (key: string) => void; // digit | '.' | '+' '-' '×' '÷' | 'back' | 'clear' | 'eq'
  lang: Lang;
}

// label shown, key sent. ⌫ = backspace, C = clear, = evaluates.
const ROWS: { label: string; k: string; kind?: 'op' | 'eq' | 'util' }[][] = [
  [
    { label: '7', k: '7' }, { label: '8', k: '8' }, { label: '9', k: '9' },
    { label: '÷', k: '÷', kind: 'op' },
  ],
  [
    { label: '4', k: '4' }, { label: '5', k: '5' }, { label: '6', k: '6' },
    { label: '×', k: '×', kind: 'op' },
  ],
  [
    { label: '1', k: '1' }, { label: '2', k: '2' }, { label: '3', k: '3' },
    { label: '−', k: '-', kind: 'op' },
  ],
  [
    { label: '.', k: '.' }, { label: '0', k: '0' }, { label: '⌫', k: 'back', kind: 'util' },
    { label: '+', k: '+', kind: 'op' },
  ],
  [
    { label: 'C', k: 'clear', kind: 'util' }, { label: '=', k: 'eq', kind: 'eq' },
  ],
];

export function CalcKeypad({ onKey, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const zh = lang === 'zh';
  // Spoken label for keys whose glyph reads poorly to a screen reader.
  const a11y = (k: string, label: string): string => {
    switch (k) {
      case 'back': return s.a11yKeyBack;
      case 'clear': return s.a11yKeyClear;
      case 'eq': return s.a11yKeyEq;
      case '÷': return zh ? '除以' : 'divide';
      case '×': return zh ? '乘以' : 'times';
      case '-': return zh ? '减' : 'minus';
      case '+': return zh ? '加' : 'plus';
      default: return label;
    }
  };
  return (
    <View style={styles.pad}>
      {ROWS.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((key) => {
            const wide = ROWS[ri].length === 2; // last row spans 2 wide buttons
            const bg = key.kind === 'eq' ? t.hibiscus : key.kind === 'op' ? t.tint : t.card;
            const fg = key.kind === 'eq' ? '#fff' : key.kind === 'op' ? t.hibiscus : t.ink;
            return (
              <Tap
                key={key.k}
                onPress={() => onKey(key.k)}
                scaleTo={0.92}
                haptic
                style={[
                  styles.key,
                  wide && styles.keyWide,
                  { backgroundColor: bg, borderColor: key.kind === 'eq' ? t.hibiscus : t.line },
                ]}
                accessibilityRole="button"
                accessibilityLabel={a11y(key.k, key.label)}
              >
                <Text style={[styles.keyText, TABULAR, { color: fg }]}>{key.label}</Text>
              </Tap>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 7, marginTop: 10 },
  row: { flexDirection: 'row', gap: 7 },
  key: {
    flex: 1, height: 46, borderRadius: RAD.sm, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  keyWide: { flex: 1 },
  keyText: { fontSize: 19, fontWeight: '600' },
});
