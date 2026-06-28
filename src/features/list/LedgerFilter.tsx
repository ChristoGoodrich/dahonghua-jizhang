import React from 'react';
import { Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { observer } from '@legendapp/state/react';
import { store$, setCurLedger } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { I18N } from '@/i18n';
import type { Lang } from '@/i18n';

/** Filter bar to scope the list to a single ledger (home, list tab). */
export const LedgerFilter = observer(function LedgerFilter({ lang }: { lang: Lang }) {
  const t = useTheme();
  const s = I18N[lang];
  const ledgers = store$.tags.ledger.get();
  const cur = store$.curLedger.get();
  if (!ledgers.length) return null;

  const Chip = ({ value, label }: { value: string; label: string }) => {
    const on = cur === value;
    return (
      <Pressable
        onPress={() => setCurLedger(value)}
        style={[styles.chip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}
      >
        <Text style={{ fontSize: 12, fontWeight: '600', color: on ? t.hibiscus : t.inkSoft }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.content}>
      <Chip value="" label={s.ledgerAll} />
      {ledgers.map((g) => (
        <Chip key={g} value={g} label={g} />
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: { maxHeight: 42 },
  content: { paddingHorizontal: 22, paddingTop: 8, gap: 7 },
  chip: { borderWidth: 1, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, marginRight: 7 },
});
