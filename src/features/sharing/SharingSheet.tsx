import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Btn } from '@/components/ui/Btn';
import { SheetShell } from '@/components/ui/SheetShell';
import { RAD } from '@/theme/tokens';
import type { Lang } from '@/i18n';

const STR: Record<Lang, { title: string; emailPh: string; invite: string; cancel: string; back: string }> = {
  zh: { title: '邀请家人', emailPh: '输入邮箱地址', invite: '发送邀请', cancel: '取消', back: '返回' },
  en: { title: 'Invite Family', emailPh: 'Enter email address', invite: 'Send Invite', cancel: 'Cancel', back: 'Back' },
};

interface Props {
  visible: boolean;
  lang: Lang;
  onClose: () => void;
}

export function SharingSheet({ visible, lang, onClose }: Props) {
  const t = useTheme();
  const s = STR[lang];
  const [email, setEmail] = useState('');

  if (!visible) return null;

  function onInvite() {
    // Foundation stub — actual invite logic will be wired later
    onClose();
  }

  return (
    <SheetShell onClose={onClose} closeLabel={s.back}>
      <Text style={[styles.title, { color: t.ink }]}>{s.title}</Text>

      <TextInput
        style={[styles.input, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
        placeholder={s.emailPh}
        placeholderTextColor={t.inkSoft}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
      />

      <View style={styles.actions}>
        <Btn label={s.cancel} variant="ghost" onPress={onClose} />
        <View style={styles.spacer} />
        <Btn label={s.invite} onPress={onInvite} disabled={!email.trim()} />
      </View>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', marginBottom: 14 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RAD.sm,
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  actions: { flexDirection: 'row', alignItems: 'center' },
  spacer: { flex: 1 },
});
