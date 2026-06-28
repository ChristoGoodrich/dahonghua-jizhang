import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { observer } from '@legendapp/state/react';
import { store$, logTemplate } from '@/store/ledger';
import { catOf, catName } from '@/domain/cats';
import { fmtShort } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import type { Lang } from '@/i18n';

/** Horizontal one-tap quick-log chips for saved templates (home, list tab). */
export const TemplateChips = observer(function TemplateChips({ lang, onLogged }: { lang: Lang; onLogged: () => void }) {
  const t = useTheme();
  const templates = store$.templates.get();
  const customCats = store$.customCats.get();
  if (!templates.length) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.content}>
      {templates.map((tp) => {
        const c = catOf(tp.io, tp.cat, customCats);
        return (
          <Pressable
            key={tp.id}
            onPress={() => { logTemplate(tp.id); onLogged(); }}
            style={[styles.chip, { backgroundColor: t.card, borderColor: t.line }]}
          >
            <View style={[styles.emo, { backgroundColor: c.c + '22' }]}>
              <Text style={styles.emoText}>{c.e}</Text>
            </View>
            <Text style={[styles.name, { color: t.ink }]} numberOfLines={1}>{tp.name || catName(c, lang)}</Text>
            <Text style={[styles.amt, { color: t.inkSoft }]}>{tp.io === 'exp' ? '-' : '+'}{fmtShort(tp.amt, lang)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: { maxHeight: 50 },
  content: { paddingHorizontal: 22, paddingTop: 2, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 22, paddingVertical: 6, paddingHorizontal: 11, marginRight: 8 },
  emo: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 14 },
  name: { fontSize: 12.5, fontWeight: '600', maxWidth: 90 },
  amt: { fontSize: 11.5 },
});
