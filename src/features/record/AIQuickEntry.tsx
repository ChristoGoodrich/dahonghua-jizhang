import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { RAD } from '@/theme/tokens';
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
        <Tap onPress={onSubmit} disabled={busy} scaleTo={0.92} style={[styles.aiBtn, { backgroundColor: busy ? t.line : t.hibiscus }]} accessibilityRole="button" accessibilityLabel={s.a11yAI}>
          {busy ? <Text style={styles.aiBtnText}>{s.aiParsing}</Text> : <Icon name="sparkle" color="#fff" size={18} />}
        </Tap>
      </View>
      {!!msg && <Text style={[styles.aiMsg, { color: t.hibiscusDeep }]}>{msg}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  aiWrap: { marginBottom: 10 },
  aiRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  aiInput: {
    flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.sm,
    height: 40, paddingVertical: 0, paddingHorizontal: 13, fontSize: 14,
  },
  aiBtn: { borderRadius: RAD.sm, height: 40, paddingHorizontal: 14, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  aiBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  aiMsg: { fontSize: 11.5, fontWeight: '600', marginTop: 6, marginHorizontal: 2 },
});
