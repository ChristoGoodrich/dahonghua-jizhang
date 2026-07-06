import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { tapHaptic } from '@/util/haptics';
import { RAD, shadow } from '@/theme/tokens';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';

interface Props {
  lang: Lang;
  onSubmit: (amount: number, note: string) => void;
}

export function QuickEntry({ lang, onSubmit }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');

  function submit() {
    const value = parseFloat(amt);
    if (!value || value <= 0) return;
    tapHaptic();
    onSubmit(value, note.trim());
    setAmt('');
    setNote('');
  }

  return (
    <View style={[styles.wrap, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
      <TextInput
        style={[styles.amtInput, { color: t.ink, borderColor: t.line }]}
        value={amt}
        onChangeText={setAmt}
        placeholder={s.amountPh}
        placeholderTextColor={t.inkSoft}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />
      <TextInput
        style={[styles.noteInput, { color: t.ink, borderColor: t.line }]}
        value={note}
        onChangeText={setNote}
        placeholder={s.note}
        placeholderTextColor={t.inkSoft}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Tap
        style={[styles.btn, { backgroundColor: t.hibiscus }]}
        scaleTo={0.9}
        onPress={submit}
        accessibilityRole="button"
        accessibilityLabel={s.save}
      >
        <Icon name="check" color="#fff" size={18} />
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 22,
    marginBottom: 8,
    padding: 10,
    borderRadius: RAD.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  amtInput: {
    width: 80,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RAD.xs,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  noteInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RAD.xs,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
  },
  btn: {
    borderRadius: RAD.xs,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
