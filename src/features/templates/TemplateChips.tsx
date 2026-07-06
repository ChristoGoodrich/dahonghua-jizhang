import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { observer } from '@legendapp/state/react';
import { store$, logTemplate } from '@/store/ledger';
import { catOf, catName } from '@/domain/cats';
import { fmtShort } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
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
          <Tap
            key={tp.id}
            haptic
            scaleTo={0.93}
            onPress={() => { logTemplate(tp.id); onLogged(); }}
            style={[styles.chip, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}
          >
            <View style={[styles.emo, { backgroundColor: c.c + (t.isDark ? '30' : '1F') }]}>
              <Text style={styles.emoText}>{c.e}</Text>
            </View>
            <Text style={[styles.name, { color: t.ink }]} numberOfLines={1}>{tp.name || catName(c, lang)}</Text>
            <Text style={[styles.amt, TABULAR, { color: t.inkSoft }]}>{tp.io === 'exp' ? '-' : '+'}{fmtShort(tp.amt, lang)}</Text>
          </Tap>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: { maxHeight: 52 },
  content: { paddingHorizontal: 22, paddingVertical: 3 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.pill,
    paddingVertical: 6, paddingHorizontal: 11, marginRight: 8,
  },
  emo: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 14 },
  name: { fontSize: 12.5, fontWeight: '600', maxWidth: 90 },
  amt: { fontSize: 11.5, fontWeight: '600' },
});
