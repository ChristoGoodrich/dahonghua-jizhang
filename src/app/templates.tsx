import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, removeTemplate } from '@/store/ledger';
import { catOf, catName } from '@/domain/cats';
import { fmtShort } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';

export default observer(function TemplatesScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const templates = store$.templates.get();
  const customCats = store$.customCats.get();

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setTemplates} subtitle={s.setTemplatesD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {templates.length === 0 ? (
            <Text style={[styles.none, { color: t.inkSoft }]}>{s.tmplEmpty}</Text>
          ) : (
            templates.map((tp) => {
              const c = catOf(tp.io, tp.cat, customCats);
              return (
                <View key={tp.id} style={[styles.row, { backgroundColor: t.card }]}>
                  <View style={[styles.emo, { backgroundColor: c.c + '22' }]}>
                    <Text style={styles.emoText}>{c.e}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: t.ink }]}>{tp.name || catName(c, lang)}</Text>
                    <Text style={[styles.sub, { color: t.inkSoft }]}>
                      {catName(c, lang)}{tp.note ? ' · ' + tp.note : ''}
                    </Text>
                  </View>
                  <Text style={[styles.amt, { color: t.ink }]}>{tp.io === 'exp' ? '-' : '+'}{fmtShort(tp.amt, lang)}</Text>
                  <Pressable onPress={() => Alert.alert(s.delConfirmTitle, s.delConfirmMsg, [
                    { text: s.cancel, style: 'cancel' },
                    { text: s.delConfirmBtn, style: 'destructive', onPress: () => removeTemplate(tp.id) },
                  ])} hitSlop={10} accessibilityRole="button" accessibilityLabel={s.del}>
                    <Text style={[styles.del, { color: t.inkSoft }]}>✕</Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 60, paddingTop: 6 },
  none: { fontSize: 13, textAlign: 'center', paddingVertical: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 13, padding: 12, marginBottom: 8 },
  emo: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 17 },
  name: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 11, marginTop: 1 },
  amt: { fontWeight: '700', fontSize: 14 },
  del: { fontSize: 17, paddingHorizontal: 2, marginLeft: 4 },
});
