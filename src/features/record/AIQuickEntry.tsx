import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { I18N, type Lang } from '@/i18n';

interface Props {
  value: string;
  busy: boolean;
  msg: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  lang: Lang;
}

/** Natural-language quick-entry row ("dinner 38") that fills the sheet via AI. */
export function AIQuickEntry({ value, busy, msg, onChangeText, onSubmit, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  return (
    <View style={styles.aiWrap}>
      <View style={styles.aiRow}>
        <TextInput
          style={[styles.aiInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
          placeholder={s.aiPlaceholder}
          placeholderTextColor={t.inkSoft}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
          editable={!busy}
        />
        <Pressable onPress={onSubmit} disabled={busy} style={[styles.aiBtn, { backgroundColor: busy ? t.line : t.hibiscus }]} accessibilityRole="button" accessibilityLabel={s.a11yAI}>
          <Text style={styles.aiBtnText}>{busy ? s.aiParsing : '✨'}</Text>
        </Pressable>
      </View>
      {!!msg && <Text style={[styles.aiMsg, { color: t.hibiscusDeep }]}>{msg}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  aiWrap: { marginBottom: 10 },
  aiRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  aiInput: { flex: 1, borderWidth: 1, borderRadius: 11, paddingVertical: 9, paddingHorizontal: 12, fontSize: 14 },
  aiBtn: { borderRadius: 11, paddingVertical: 9, paddingHorizontal: 14, minWidth: 46, alignItems: 'center', justifyContent: 'center' },
  aiBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  aiMsg: { fontSize: 11.5, fontWeight: '600', marginTop: 6, marginHorizontal: 2 },
});
